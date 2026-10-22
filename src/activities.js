// Activities do the slow, flaky work: web search, the model call, and the
// file write. Temporal retries them; the workflow never does I/O itself.
import { mkdir, writeFile } from "node:fs/promises";
import { ApplicationFailure } from "@temporalio/activity";
import { parseVerdicts } from "./lib.js";

const SYSTEM = `You read the news for a small business owner who would rather not.
You get numbered web results about one tool the business uses. Most of them are not news.
Pick a verdict for each:
- act: a recent change that makes this owner do something: the tool shuts down, deletes data, forces a move, raises a price they pay, or has a security problem.
- fyi: a recent change to the tool itself (a new feature, a new rule) that this owner would want to know about, with nothing to do.
- ignore: everything else, including how-to guides, reviews, fee explainers, comparisons, ads, old news, rumors, and forum posts about someone else's problem.
If unsure between act and fyi, pick fyi. If unsure between fyi and ignore, pick ignore.
Write "why" as one plain sentence to the owner. Use only facts in the result text.
"deadline" is a date stated in the result text (YYYY-MM-DD), or null. Never guess a date.
Reply with JSON only, one entry per result: {"items":[{"i":0,"verdict":"ignore","why":"...","deadline":null}]}`;

export function makeActivities({ fetch = globalThis.fetch, env = process.env } = {}) {
  const notesDir = env.NOTES_DIR ?? "notes";

  async function searchWeb(query, window = "w") {
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google",
      q: query,
      tbs: `qdr:${window}`, // past day, week or month
      num: "10",
      gl: "us",
      hl: "en",
      api_key: env.SERPAPI_KEY ?? "",
    });
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403)
      throw ApplicationFailure.nonRetryable(`SerpApi said ${res.status}`);
    if (!res.ok) throw new Error(`SerpApi said ${res.status}`); // retried
    const data = await res.json();
    if (data.error) {
      if (/hasn't returned any results/i.test(data.error)) return [];
      throw new Error(`SerpApi: ${data.error}`);
    }
    return (data.organic_results ?? [])
      .filter((r) => /^https?:\/\//.test(r.link ?? ""))
      .map((r) => ({
        title: String(r.title ?? "").slice(0, 200),
        link: r.link,
        source: String(r.source ?? new URL(r.link).hostname).slice(0, 80),
        date: String(r.date ?? "").slice(0, 40),
        snippet: String(r.snippet ?? "").slice(0, 400),
      }));
  }

  async function judge({ business, tool, items, date }) {
    const stories = items
      .map((s, i) => `${i}. ${s.title} (${s.source}, ${s.date || "no date"})\n${s.snippet}`)
      .join("\n\n");
    const res = await fetch(`${env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.LLM_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL ?? "openai/gpt-oss-20b",
        temperature: 0,
        max_tokens: 4000, // gpt-oss thinks first; too small a budget leaves no room for the answer
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Business: ${business}. Today: ${date}.\nTool: ${tool.name} (${tool.what}).\n\nStories:\n${stories}`,
          },
        ],
      }),
    });
    if (res.status === 401 || res.status === 403)
      throw ApplicationFailure.nonRetryable(`model server said ${res.status}`);
    if (res.status === 429) {
      // Free tiers have small per-minute token limits. Wait as long as the server asks.
      const wait = Number(res.headers.get("retry-after")) || 15;
      throw ApplicationFailure.create({
        message: "model server said 429",
        type: "RateLimited",
        nextRetryDelay: `${wait}s`,
      });
    }
    if (!res.ok) throw new Error(`model server said ${res.status}`); // retried
    const data = await res.json();
    const tokens = data.usage?.total_tokens ?? 0;
    console.log(`[judge] ${tool.name}: ${items.length} stories, ${tokens} tokens`);
    // A malformed reply throws here, and Temporal asks the model again.
    return parseVerdicts(data.choices?.[0]?.message?.content ?? "", items.length, date);
  }

  async function saveNote({ slug, date, night, text }) {
    const safe = String(slug).replace(/[^a-z0-9-]/gi, "") || "business";
    await mkdir(notesDir, { recursive: true });
    const file = `${notesDir}/${safe}-${date}-night${night}.md`;
    await writeFile(file, text);
    console.log(`\n${text}\n[saved] ${file}`);
    return file;
  }

  return { searchWeb, judge, saveNote };
}
