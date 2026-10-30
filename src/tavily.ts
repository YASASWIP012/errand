import { call, parseJson, type TraceSink } from "./models.js";

// When the person names an errand but not a website ("renew my passport"),
// Tavily finds candidate pages and Lightning picks the official one.
export async function findSite(goal: string, sink?: TraceSink): Promise<{ url: string; title: string } | undefined> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return undefined;
  const started = performance.now();
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: `official website to ${goal}`, max_results: 6, search_depth: "basic" }),
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { results: { url: string; title: string; content: string }[] };
  sink?.({ role: "actor", model: "tavily/search", purpose: "find the right website", ms: Math.round(performance.now() - started), inputTokens: 0, outputTokens: 0, usd: 0.008, ok: true });
  if (!data.results?.length) return undefined;
  const pick = await call("actor", "pick the official site", {
    temperature: 0,
    max_tokens: 120,
    messages: [{
      role: "user",
      content: `A blind person wants to: ${goal}\nWhich result is the official site where they can do it? Avoid ads, aggregators and look-alike domains. Reply with only JSON {"index": n} or {"index": -1} if none is safe.\n${data.results.map((r, i) => `${i}. ${r.title} | ${r.url} | ${r.content.slice(0, 160)}`).join("\n")}`,
    }],
  }, sink);
  const { index } = parseJson<{ index: number }>(pick.choices[0]?.message?.content);
  return index >= 0 && data.results[index] ? { url: data.results[index].url, title: data.results[index].title } : undefined;
}
