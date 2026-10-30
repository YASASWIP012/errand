import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runErrand, repairPage, type AgentIO } from "./agent.js";
import { labelControls } from "./labeler.js";
import { registerFixtures } from "./fixtures.js";
import { findSite } from "./tavily.js";
import { MODELS, type TraceEntry } from "./models.js";
import * as memory from "./memory.js";

try { process.loadEnvFile(); } catch { /* no .env file */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8787);
const SCAN = readFileSync(path.join(ROOT, "extension/scan.js"), "utf8");
const OPEN_WEB = process.env.ERRAND_OPEN_WEB === "1";
const MAX_SESSIONS = Number(process.env.ERRAND_MAX_SESSIONS ?? 8);
const IDLE_MS = 10 * 60_000;

const app = Fastify({ logger: { level: "info" }, bodyLimit: 12 * 1024 * 1024 });
await app.register(websocket);
await app.register(fastifyStatic, { root: path.join(ROOT, "web"), prefix: "/" });
await app.register(fastifyStatic, { root: path.join(ROOT, "bench/sites"), prefix: "/sites/", decorateReply: false });
await app.register(fastifyStatic, { root: path.join(ROOT, "extension"), prefix: "/extension/", decorateReply: false });
registerFixtures(app);

let browser: Browser | undefined;
async function getBrowser() {
  if (!browser?.isConnected()) browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  return browser;
}

const SITES = [
  { id: "northgrid", name: "Northgrid Power", kind: "Electricity bill" },
  { id: "clinic", name: "Riverside Family Clinic", kind: "Doctor appointments" },
  { id: "library", name: "Maple County Library", kind: "Library loans" },
  { id: "grocer", name: "Corner Grocer", kind: "Grocery delivery" },
];

app.get("/api/info", async () => ({ models: MODELS, sites: SITES, openWeb: OPEN_WEB, tavily: !!process.env.TAVILY_API_KEY }));

// Label endpoint for the Chrome extension: one screenshot with numbered boxes
// plus page context in, labels out.
const LabelBody = z.object({
  userId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/),
  origin: z.string().max(200),
  title: z.string().max(300),
  screenshot: z.string().startsWith("data:image/"),
  unnamed: z.array(z.object({
    id: z.string(), tag: z.string(), role: z.string(), name: z.string(), announcedAs: z.string(),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    context: z.object({ heading: z.string(), row: z.string(), hints: z.string() }),
  })).max(60),
});

// The extension calls this from a chrome-extension:// origin.
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (req.url.startsWith("/api/") && origin?.startsWith("chrome-extension://")) {
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") return reply.code(204).send();
  }
});

app.post("/api/label", async (req, reply) => {
  const body = LabelBody.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
  const { userId, origin, title, screenshot, unnamed } = body.data;
  const mem = await memory.load(userId);
  const known = memory.site(mem, origin).labels;
  const cached = [];
  const ask = [];
  for (const u of unnamed) {
    const hit = known[memory.signature(u)];
    if (hit) cached.push({ id: u.id, ...hit, confidence: 1, cached: true });
    else ask.push(u);
  }
  const trace: TraceEntry[] = [];
  const fresh = ask.length
    ? await labelControls(ask, Buffer.from(screenshot.split(",")[1], "base64"), title, (e) => trace.push(e))
    : [];
  for (const l of fresh) {
    const u = ask.find((a) => a.id === l.id);
    if (u && l.confidence >= 0.5) known[memory.signature(u)] = { label: l.label, role: l.role };
  }
  await memory.save(userId, mem);
  return { labels: [...cached, ...fresh], trace };
});

interface Session {
  context: BrowserContext;
  page: Page;
  pending?: { resolve: (v: string) => void; kind: string };
  running?: AbortController;
  lastSeen: number;
}
const sessions = new Map<string, Session>();

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.lastSeen > IDLE_MS) void close(id);
}, 60_000).unref();

async function close(id: string) {
  const s = sessions.get(id);
  sessions.delete(id);
  s?.running?.abort();
  await s?.context.close().catch(() => {});
}

function allowed(url: string): boolean {
  if (OPEN_WEB) return /^https?:\/\//.test(url);
  try {
    const u = new URL(url);
    return u.host === `localhost:${PORT}` || u.host === `127.0.0.1:${PORT}` || u.pathname.startsWith("/sites/");
  } catch { return false; }
}

const Incoming = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), userId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/) }),
  z.object({ type: z.literal("open"), site: z.string().max(40).optional(), url: z.string().max(500).optional() }),
  z.object({ type: z.literal("goal"), text: z.string().min(2).max(500), baseline: z.boolean().optional() }),
  z.object({ type: z.literal("label") }),
  z.object({ type: z.literal("answer"), text: z.string().max(500) }),
  z.object({ type: z.literal("secure"), text: z.string().max(200) }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("remember"), fact: z.string().min(2).max(300) }),
  z.object({ type: z.literal("forget") }),
  z.object({ type: z.literal("controls") }),
]);

app.register(async (scope) => {
  scope.get("/ws", { websocket: true }, (socket, req) => {
    let userId = "";
    let session: Session | undefined;
    const send = (msg: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg)); };
    const say = (text: string) => send({ type: "say", text });

    async function ensure(): Promise<Session> {
      if (session) return session;
      if (sessions.size >= MAX_SESSIONS) throw new Error("All demo browsers are busy right now. Try again in a few minutes.");
      const b = await getBrowser();
      const context = await b.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1, baseURL: `http://localhost:${PORT}` });
      await context.addInitScript(SCAN);
      const page = await context.newPage();
      // Roughly one frame a second, and only when the picture changed.
      let lastFrame = "";
      const stream = setInterval(async () => {
        const shot = await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => undefined);
        if (!shot) return;
        const data = shot.toString("base64");
        if (data !== lastFrame) { lastFrame = data; send({ type: "frame", data }); }
      }, 900);
      context.on("close", () => clearInterval(stream));
      page.on("framenavigated", (f) => { if (f === page.mainFrame()) send({ type: "url", url: f.url() }); });
      session = { context, page, lastSeen: Date.now() };
      sessions.set(userId, session);
      return session;
    }

    const io = (s: Session, signal: AbortSignal): AgentIO => ({
      say,
      event: (e) => send({ type: "event", event: e }),
      trace: (t) => send({ type: "trace", entry: t }),
      signal,
      ask: (kind, prompt) => new Promise<string>((resolve) => {
        s.pending = { resolve, kind };
        send({ type: "ask", kind, prompt });
      }),
    });

    socket.on("message", async (raw: Buffer) => {
      let msg: z.infer<typeof Incoming>;
      try { msg = Incoming.parse(JSON.parse(raw.toString())); } catch { return send({ type: "error", text: "Bad message" }); }
      try {
        if (msg.type === "hello") {
          userId = msg.userId;
          if (sessions.has(userId)) await close(userId);
          const mem = await memory.load(userId);
          return send({ type: "ready", models: MODELS, sites: SITES, facts: mem.facts, history: mem.history.slice(-5) });
        }
        if (!userId) return send({ type: "error", text: "Say hello first" });
        const s = await ensure();
        s.lastSeen = Date.now();

        switch (msg.type) {
          case "open": {
            const url = msg.site ? `http://localhost:${PORT}/sites/${encodeURIComponent(msg.site)}/` : msg.url ?? "";
            if (!allowed(url)) return say("The public demo only opens the four test sites. Run Errand locally to use it on any website.");
            await s.page.goto(url, { waitUntil: "domcontentloaded" });
            const unnamed = await s.page.evaluate(() => (window as any).__errand.findUnnamed());
            return send({ type: "opened", url: s.page.url(), title: await s.page.title(), unnamed: unnamed.length, controls: await s.page.evaluate(() => (window as any).__errand.controls()) });
          }
          case "controls":
            return send({ type: "controls", controls: await s.page.evaluate(() => (window as any).__errand.controls()) });
          case "label": {
            if (s.running) return say("I'm busy with an errand. Say stop first.");
            const ac = new AbortController();
            s.running = ac;
            try {
              const before = await s.page.evaluate(() => (window as any).__errand.controls());
              await repairPage(s.page, userId, io(s, ac.signal));
              const after = await s.page.evaluate(() => (window as any).__errand.controls());
              const named = (cs: any[]) => cs.filter((c) => c.name && !/^(button|link)$/i.test(c.name)).length;
              send({ type: "labelled", before: named(before), after: named(after), total: after.length, controls: after });
              if (named(after) === named(before)) say("Every control on this page already has a name.");
            } finally { s.running = undefined; }
            return;
          }
          case "goal": {
            if (s.running) return say("I'm already working on something. Say stop first.");
            const ac = new AbortController();
            s.running = ac;
            try {
              if (s.page.url() === "about:blank") {
                const found = OPEN_WEB ? await findSite(msg.text, (t) => send({ type: "trace", entry: t })) : undefined;
                if (!found) { say("Which site should I use? Open one of the test sites first."); return; }
                say(`I'll use ${found.title}.`);
                await s.page.goto(found.url, { waitUntil: "domcontentloaded" });
              }
              await runErrand({ page: s.page, goal: msg.text, userId, mode: msg.baseline ? "baseline" : "errand" }, io(s, ac.signal));
            } finally { s.running = undefined; s.pending = undefined; }
            return;
          }
          case "answer":
            if (!s.pending) return;
            s.pending.resolve(msg.text);
            s.pending = undefined;
            return;
          case "secure": {
            // Typed by the person, sent straight to the focused field. Never logged, never sent to a model.
            await s.page.keyboard.type(msg.text, { delay: 20 });
            return send({ type: "secure-ok" });
          }
          case "stop":
            s.running?.abort();
            s.pending?.resolve("no");
            return say("Stopped.");
          case "remember": {
            const mem = await memory.load(userId);
            mem.facts.push(msg.fact);
            await memory.save(userId, mem);
            return say("Got it, I'll remember that.");
          }
          case "forget":
            await memory.forget(userId);
            return say("I've deleted everything I remembered about you and the sites you used.");
        }
      } catch (err) {
        app.log.error(err);
        send({ type: "error", text: (err as Error).message });
      }
    });

    socket.on("close", () => { if (userId) void close(userId); });
  });
});

await app.listen({ port: PORT, host: process.env.HOST ?? "0.0.0.0" });
