import { MODELS, tokenFactory } from "./models.js";

// Checks the key and that every model Errand depends on is actually served.
// Run this first: npm run probe
try { process.loadEnvFile(); } catch { /* no .env file */ }

const list = await tokenFactory().models.list();
const ids = list.data.map((m) => m.id);
console.log(`${ids.length} models on Token Factory. NVIDIA ones:`);
for (const id of ids.filter((i) => /nvidia|nemotron/i.test(i))) console.log(`  ${id}`);
for (const [role, id] of Object.entries(MODELS)) {
  const ok = ids.includes(id);
  console.log(`${ok ? "ok     " : "MISSING"} ${role.padEnd(8)} ${id}`);
  if (!ok) continue;
  try {
    const started = performance.now();
    const res = await tokenFactory().chat.completions.create({ model: id, max_tokens: 20, messages: [{ role: "user", content: "Say ok." }] });
    console.log(`        replied in ${Math.round(performance.now() - started)} ms: ${res.choices[0]?.message?.content?.slice(0, 40)}`);
  } catch (err) {
    console.log(`        call failed: ${(err as Error).message}`);
  }
}
