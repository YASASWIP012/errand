import { chromium, type Browser } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runErrand, type AgentEvent, type Mode } from "../src/agent.js";
import { TASKS, type Task } from "./tasks.js";

// Usage: npm run bench -- [--only id,id] [--modes errand,baseline] [--concurrency 3] [--repeat] [--verbose]
// The Errand server must be running: it hosts the test sites.
try { process.loadEnvFile(); } catch { /* no .env file */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.ERRAND_BENCH_URL ?? "http://localhost:8787";
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const only = arg("only")?.split(",");
const modes = (arg("modes")?.split(",") ?? ["errand", "baseline"]) as Mode[];
const concurrency = Number(arg("concurrency") ?? 3);
const repeat = process.argv.includes("--repeat");
const verbose = process.argv.includes("--verbose");
const scan = await readFile(path.join(ROOT, "extension/scan.js"), "utf8");

interface Row {
  task: string; site: string; category: string; mode: string; run: number;
  passed: boolean; claimed: boolean; steps: number; usd: number; ms: number;
  confirms: number; handoffs: number; questions: number; unnamedBefore: number; labelled: number;
  guardFlags: number; summary: string; error?: string; calls: Record<string, number>;
}

async function runTask(browser: Browser, task: Task, mode: Mode, userId: string, run: number): Promise<Row> {
  const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, baseURL: BASE });
  await context.addInitScript(scan);
  const page = await context.newPage();
  const row: Row = {
    task: task.id, site: task.site, category: task.category, mode, run,
    passed: false, claimed: false, steps: 0, usd: 0, ms: 0,
    confirms: 0, handoffs: 0, questions: 0, unnamedBefore: 0, labelled: 0, guardFlags: 0, summary: "", calls: {},
  };
  try {
    await page.goto(`/sites/${task.site}/`, { waitUntil: "networkidle" });
    row.unnamedBefore = await page.evaluate(() => (window as any).__errand.findUnnamed().length);
    const res = await runErrand({ page, goal: task.goal, userId, mode, maxSteps: 20 }, {
      say: () => {},
      event: (e: AgentEvent) => {
        if (verbose) console.log(`  ${task.id} ${JSON.stringify(e).slice(0, 400)}`);
        if (e.type === "repair") row.labelled += e.labelled;
        if (e.type === "guard" && e.flagged) row.guardFlags++;
      },
      trace: (t) => { row.calls[t.role] = (row.calls[t.role] ?? 0) + 1; },
      ask: async (kind) => {
        if (kind === "confirm") { row.confirms++; return task.approve === false ? "no" : "yes"; }
        if (kind === "handoff") { row.handoffs++; return "done"; }
        row.questions++;
        return task.answer ?? "Use your best judgement from what is on the page.";
      },
    });
    Object.assign(row, { claimed: res.success, steps: res.steps, usd: res.usd, ms: res.ms, summary: res.summary });
    const state = await (await context.request.get(`/fx/${task.site}/state`)).json();
    row.passed = task.check(state, res.summary);
  } catch (err) {
    row.error = (err as Error).message.slice(0, 300);
  }
  await context.close();
  return row;
}

async function pool<T>(items: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await items[i]();
      const r = out[i] as any;
      console.log(`${r.passed ? "PASS" : "FAIL"} ${r.mode.padEnd(8)} run${r.run} ${r.task.padEnd(24)} ${r.steps} steps ${(r.ms / 1000).toFixed(1)}s $${r.usd.toFixed(4)}${r.error ? ` ERROR ${r.error}` : ""}`);
    }
  }));
  return out;
}

const browser = await chromium.launch();
const tasks = TASKS.filter((t) => !only || only.includes(t.id));
const stamp = Date.now().toString(36);
const jobs: (() => Promise<Row>)[] = [];
for (const task of tasks) {
  for (const mode of modes) {
    const userId = `bench_${stamp}_${task.id.replace(/\W/g, "")}_${mode}`.slice(0, 60);
    jobs.push(async () => {
      const first = await runTask(browser, task, mode, userId, 1);
      return first;
    });
  }
}
const rows = await pool(jobs, concurrency);

// Memory experiment: same person, same errand, second time. Only on passed Errand runs.
const repeats: Row[] = [];
if (repeat) {
  const passed = rows.filter((r) => r.mode === "errand" && r.passed && r.category === "action");
  repeats.push(...await pool(passed.map((r) => () => {
    const task = TASKS.find((t) => t.id === r.task)!;
    const userId = `bench_${stamp}_${task.id.replace(/\W/g, "")}_errand`.slice(0, 60);
    return runTask(browser, task, "errand", userId, 2);
  }), concurrency));
}
await browser.close();

const rate = (l: Row[]) => (l.length ? `${l.filter((r) => r.passed).length}/${l.length}` : "-");
const avg = (l: Row[], f: (r: Row) => number) => (l.length ? l.reduce((a, r) => a + f(r), 0) / l.length : 0);
const lines = ["# Unlabeled Web benchmark results", "", `Run ${new Date().toISOString()}. ${tasks.length} tasks on 4 fictional test sites.`, "", "| Mode | All | Action | Lookup | Safety | Avg steps | Avg time | Avg cost |", "|---|---|---|---|---|---|---|---|"];
for (const mode of modes) {
  const m = rows.filter((r) => r.mode === mode);
  const by = (c: string) => rate(m.filter((r) => r.category === c));
  lines.push(`| ${mode} | ${rate(m)} | ${by("action")} | ${by("lookup")} | ${by("safety")} | ${avg(m, (r) => r.steps).toFixed(1)} | ${(avg(m, (r) => r.ms) / 1000).toFixed(1)} s | $${avg(m, (r) => r.usd).toFixed(4)} |`);
}
const falseClaims = rows.filter((r) => r.claimed && !r.passed).length;
lines.push("", `False success claims (agent said done, state disagreed): ${falseClaims}.`);
if (repeats.length) {
  const firsts = repeats.map((r) => rows.find((x) => x.task === r.task && x.mode === "errand")!);
  lines.push("", "## Second run with memory", "", `${repeats.length} errands repeated by the same user: ${rate(repeats)} passed. Average time ${(avg(firsts, (r) => r.ms) / 1000).toFixed(1)} s to ${(avg(repeats, (r) => r.ms) / 1000).toFixed(1)} s. Average cost $${avg(firsts, (r) => r.usd).toFixed(4)} to $${avg(repeats, (r) => r.usd).toFixed(4)}.`);
}
lines.push("", "## Failures", "");
for (const r of [...rows, ...repeats].filter((x) => !x.passed)) lines.push(`- ${r.mode} ${r.task}: ${r.error ?? r.summary}`);

await mkdir(path.join(ROOT, "bench/results"), { recursive: true });
await writeFile(path.join(ROOT, "bench/results/latest.md"), lines.join("\n") + "\n");
await writeFile(path.join(ROOT, "bench/results/latest.json"), JSON.stringify({ rows, repeats }, null, 2));
console.log(lines.join("\n"));
