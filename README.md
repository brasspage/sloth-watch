# Sloth Watch

An overnight agent that reads the news about the tools a small business runs on, and wakes the owner only when one of them needs action.

A café runs on a website builder, a card reader, a Google listing and a newsletter tool. Any of them can shut down, change a price or start a deadline, and the owner hears about it last. Sloth Watch checks each tool once a night, asks an open-weight model which results matter, and writes a short note. Most nights the note says "Nothing needs you. Go back to sleep."

An AI agent (Claude, by Anthropic) built this and wrote this README. The human entrant set the goal. Built for the DEV Hacktoberfest 2026 Open-Source AI Challenge, week 3 ("Slow and Steady"), on Oct 22, 2026. Any commit after Oct 25, 2026 will be listed at the end of this file.

The business in the examples, Little Kettle Cafe, is made up. The tools and the news about them are real.

Demo: [brasspage.github.io/sloth-watch](https://brasspage.github.io/sloth-watch/), a real two-night run with a worker crash in the middle.

## How it works

```
Temporal workflow "slothWatch" (one per business)
  every night:
    for each tool:
      searchWeb(tool.query)   SerpApi, Google results from the past week (first night: past month)
      skip links seen before
      judge(results)          open-weight model (gpt-oss-20b) labels each result act / fyi / ignore
    saveNote()                one Markdown note per night
    sleep("24 hours")         a durable Temporal timer
  every 7 nights: continue-as-new, carrying the seen links
```

- **Temporal** makes the loop durable. Kill the worker in the middle of a night and start it again: the searches that finished are not repeated, the step that was running is retried, and the 24-hour sleep survives restarts. Rate limits (HTTP 429) are retried after the wait the server asks for.
- **SerpApi** gives the agent live Google results. Four tools a night is about 120 searches a month, inside the free plan's 250.
- **The model** only reads and labels, and its reply is treated as untrusted, because it is built from web pages. It never writes a link: the only link in a note line is the search result's own (https only). Links and markdown in the model's sentence are removed or escaped, and a verdict that points at a result that does not exist is dropped. A deadline on or before today is dropped, because it is usually the article's own date.
- When a tool has several "act" results, the note shows one line: the tool maker's own page if it is there, then the earliest deadline.

## Run it

You need Node 22, the Temporal CLI (`brew install temporal`), a SerpApi key (free plan), and a key for an OpenAI-compatible chat API (we used Groq's free tier).

```sh
npm install
npm run server                      # Temporal dev server on localhost:7233, UI on localhost:8233
SERPAPI_KEY=... LLM_API_KEY=... npm run worker
npm start -- businesses/little-kettle-cafe.json --nights 1   # one night now
npm start -- businesses/little-kettle-cafe.json             # every night, forever
```

Notes land in `notes/`. A real one from Oct 22, 2026 is in [`examples/`](examples/little-kettle-cafe-2026-10-22-night1.md). Settings, all optional:

| Variable           | Default                          |
| ------------------ | -------------------------------- |
| `LLM_BASE_URL`     | `https://api.groq.com/openai/v1` |
| `LLM_MODEL`        | `openai/gpt-oss-20b`             |
| `TEMPORAL_ADDRESS` | `localhost:7233`                 |
| `NOTES_DIR`        | `notes`                          |

`LLM_BASE_URL` can point at any server that speaks the OpenAI chat API, such as Ollama or LM Studio on your own machine. We only tested Groq.

To watch your own tools, copy `businesses/little-kettle-cafe.json` and change the list. `site` is the tool maker's domain, so its own pages win.

## Tests

```sh
npm test
```

`test/lib.test.js` checks the pure logic. `test/workflow.test.js` runs the real workflow on Temporal's time-skipping test server with fake activities: two nights 24 hours apart, a model reply that fails once, a tool whose search always fails, and continue-as-new. It downloads Temporal's test server the first time.

## Limits

- It reads the top 10 Google results per tool per night, so it can miss news.
- The model can be wrong. Every line has the real link, so check it before you act.
- The 24-hour sleep starts after the night's work, so the run time drifts a few seconds a day.
- It remembers the last 500 links, not what it told you. A big story comes back each night from whatever new page covers it.
- The model still says "act" too often. In the example note, one of the three "act" lines is a false alarm.

## License

MIT
