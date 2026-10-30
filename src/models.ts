import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

// Every model call in Errand goes through Nebius Token Factory. Each role has
// one model, picked for what that role needs: Ultra plans once per errand,
// Super VL reads pixels and makes the step decisions, and the guard screens page
// text before an agent reads it. Super VL won the step role on the benchmark:
// Lightning wandered on longer errands and Ultra cost three times as much.
// Token Factory does not serve a dedicated safety model, so the guard is a
// separate Lightning call that sees only the page and the policy.
export const MODELS = {
  planner: process.env.ERRAND_PLANNER_MODEL ?? "nvidia/Nemotron-3-Ultra-550b-a55b",
  actor: process.env.ERRAND_ACTOR_MODEL ?? "nvidia/Nemotron-3.5-Super-VL",
  vision: process.env.ERRAND_VISION_MODEL ?? "nvidia/Nemotron-3.5-Super-VL",
  guard: process.env.ERRAND_GUARD_MODEL ?? "nvidia/Nemotron-3_5-Lightning",
} as const;

export type Role = keyof typeof MODELS;

// USD per million tokens, [input, output], from the Token Factory models API on
// 2026-10-30. Override with ERRAND_PRICE_<ROLE>=in,out if the catalog changes.
const PRICES: Record<Role, [number, number]> = {
  planner: priceFromEnv("PLANNER", [1.0, 3.0]),
  actor: priceFromEnv("ACTOR", [0.3, 0.9]),
  vision: priceFromEnv("VISION", [0.3, 0.9]),
  guard: priceFromEnv("GUARD", [0.06, 0.24]),
};

function priceFromEnv(key: string, fallback: [number, number]): [number, number] {
  const raw = process.env[`ERRAND_PRICE_${key}`];
  if (!raw) return fallback;
  const [a, b] = raw.split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : fallback;
}

export interface TraceEntry {
  role: Role;
  model: string;
  purpose: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  ok: boolean;
}

export type TraceSink = (entry: TraceEntry) => void;

let client: OpenAI | undefined;

export function tokenFactory(): OpenAI {
  if (!client) {
    const apiKey = process.env.NEBIUS_API_KEY;
    if (!apiKey) throw new Error("NEBIUS_API_KEY is not set. Copy .env.example to .env and add your Token Factory key.");
    client = new OpenAI({
      apiKey,
      baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/",
      timeout: 90_000,
      maxRetries: 2,
    });
  }
  return client;
}

type Params = Omit<ChatCompletionCreateParamsNonStreaming, "model"> & Record<string, unknown>;

export async function call(role: Role, purpose: string, params: Params, sink?: TraceSink) {
  const model = MODELS[role];
  const started = performance.now();
  try {
    // Vision and the guard answer simple questions, so they skip reasoning. Left
    // on, they spend their token budget thinking and can return that as the reply.
    const body = role === "vision" || role === "guard" ? { ...params, chat_template_kwargs: { enable_thinking: false } } : params;
    const res = await tokenFactory().chat.completions.create({ ...body, model } as ChatCompletionCreateParamsNonStreaming);
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    const [pin, pout] = PRICES[role];
    sink?.({
      role, model, purpose, ok: true,
      ms: Math.round(performance.now() - started),
      inputTokens, outputTokens,
      usd: (inputTokens * pin + outputTokens * pout) / 1e6,
    });
    return res;
  } catch (err) {
    sink?.({ role, model, purpose, ok: false, ms: Math.round(performance.now() - started), inputTokens: 0, outputTokens: 0, usd: 0 });
    throw err;
  }
}

// Reasoning models sometimes wrap JSON in prose or a code fence. Take the
// first balanced object or array in the reply.
export function parseJson<T>(text: string | null | undefined): T {
  if (!text) throw new Error("empty model reply");
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.search(/[\[{]/);
  if (start < 0) throw new Error(`no JSON in reply: ${cleaned.slice(0, 200)}`);
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
  }
  throw new Error(`unbalanced JSON in reply: ${cleaned.slice(start, start + 200)}`);
}
