import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Each user's memory is one JSON file that only that user's session reads.
// It holds what Errand learned about sites (labels, the route that worked)
// and facts the user asked it to remember. "Forget everything" deletes the file.

export interface Recipe {
  goal: string;
  steps: string[];
  learnedAt: string;
  runs: number;
}

export interface UserMemory {
  facts: string[];
  sites: Record<string, { labels: Record<string, { label: string; role: string }>; recipes: Recipe[] }>;
  history: { goal: string; site: string; success: boolean; at: string; usd: number; ms: number }[];
}

const DIR = path.resolve(process.env.ERRAND_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/users"));

function file(userId: string): string {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(userId)) throw new Error("bad user id");
  return path.join(DIR, `${userId}.json`);
}

function empty(): UserMemory {
  return { facts: [], sites: {}, history: [] };
}

export async function load(userId: string): Promise<UserMemory> {
  try {
    return { ...empty(), ...JSON.parse(await readFile(file(userId), "utf8")) };
  } catch {
    return empty();
  }
}

export async function save(userId: string, mem: UserMemory): Promise<void> {
  await mkdir(DIR, { recursive: true });
  mem.history = mem.history.slice(-200);
  await writeFile(file(userId), JSON.stringify(mem, null, 2));
}

export async function forget(userId: string): Promise<void> {
  await rm(file(userId), { force: true });
}

export function site(mem: UserMemory, origin: string) {
  return (mem.sites[origin] ??= { labels: {}, recipes: [] });
}

// A control's identity that survives reloads: what it is, its code hints and
// the text around it. Not its position, which changes with layout.
// Position is part of the key: identical cards differ only by a picture, so
// without it every product's plus button would share one remembered label.
export function signature(u: { tag: string; rect: { x: number; y: number }; context: { heading: string; row: string; hints: string } }): string {
  const norm = (s: string) => s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const place = `${Math.round(u.rect.x / 24)},${Math.round(u.rect.y / 24)}`;
  return createHash("sha1").update([u.tag, place, norm(u.context.hints), norm(u.context.heading), norm(u.context.row)].join("|")).digest("hex").slice(0, 16);
}

export function findRecipe(mem: UserMemory, origin: string, goal: string): Recipe | undefined {
  const words = new Set(goal.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  let best: Recipe | undefined;
  let bestScore = 0;
  for (const r of mem.sites[origin]?.recipes ?? []) {
    const rw = r.goal.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const overlap = rw.filter((w) => words.has(w)).length / Math.max(rw.length, words.size, 1);
    if (overlap > bestScore) { best = r; bestScore = overlap; }
  }
  return bestScore >= 0.5 ? best : undefined;
}
