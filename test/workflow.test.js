// Runs the real workflow on Temporal's time-skipping test server with fake
// activities, so two "nights" 24 hours apart take seconds, not a day.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/activity";

const workflowsPath = fileURLToPath(new URL("../src/workflows.js", import.meta.url));
const business = {
  name: "Test Cafe",
  slug: "test-cafe",
  tools: [
    { name: "Solo", what: "website builder", query: "solo" },
    { name: "Square", what: "card payments", query: "square" },
    { name: "Broken", what: "a tool whose search always fails", query: "broken" },
  ],
};
const stories = [
  { title: "Solo shuts down", link: "https://news.example/solo", source: "x", date: "", snippet: "" },
  { title: "Solo adds a font", link: "https://news.example/font", source: "x", date: "", snippet: "" },
];

let env;
before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
after(async () => {
  await env?.teardown();
});

function fakes({ judgeFailsFirst = false } = {}) {
  const calls = { search: [], judge: 0, notes: [] };
  const activities = {
    async searchWeb(query, window) {
      calls.search.push(`${query}:${window}`);
      if (query === "broken") throw ApplicationFailure.nonRetryable("SerpApi said 401");
      return query === "solo" ? stories : [];
    },
    async judge({ items }) {
      calls.judge++;
      if (judgeFailsFirst && calls.judge === 1) throw new Error("model reply is not JSON");
      assert.equal(items.length, 2);
      return [
        { i: 0, verdict: "act", why: "Export your site.", deadline: "2026-11-30" },
        { i: 1, verdict: "ignore", why: "", deadline: null },
      ];
    },
    async saveNote({ text }) {
      calls.notes.push(text);
    },
  };
  return { calls, activities };
}

async function run(activities, args, taskQueue) {
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities });
  return worker.runUntil(
    env.client.workflow.execute("slothWatch", { taskQueue, workflowId: `wf-${taskQueue}`, args: [args] }),
  );
}

test("two nights, a day apart: news is judged once, a broken tool is reported, not fatal", async () => {
  const { calls, activities } = fakes();
  const t0 = Date.now();
  const result = await run(activities, { business, maxNights: 2, gap: "24 hours" }, "q1");
  assert.ok(Date.now() - t0 < 60_000, "the 24 hour sleep was skipped");
  assert.deepEqual(result, { night: 2, seen: 2 });
  assert.deepEqual(calls.search, ["solo:m", "square:m", "broken:m", "solo:w", "square:w", "broken:w"]);
  assert.equal(calls.judge, 1, "night 2 saw the same links, so the model was not asked again");
  assert.equal(calls.notes.length, 2);
  assert.match(calls.notes[0], /1 tool needs you\. 0 FYI, 1 noise\./);
  assert.match(calls.notes[0], /Export your site\. By 2026-11-30\. https:\/\/news\.example\/solo/);
  assert.match(calls.notes[0], /Could not check:\n- Broken: SerpApi said 401/);
  assert.match(calls.notes[1], /Nothing needs you\./);
});

test("a bad model reply is retried by Temporal, and the note still comes out", async () => {
  const { calls, activities } = fakes({ judgeFailsFirst: true });
  await run(activities, { business, maxNights: 1 }, "q2");
  assert.equal(calls.judge, 2);
  assert.match(calls.notes[0], /1 tool needs you/);
});

test("continue-as-new carries the seen links into the next run", async () => {
  const { calls, activities } = fakes();
  const result = await run(activities, { business, maxNights: 3, perRun: 1, gap: "1 hour" }, "q3");
  assert.deepEqual(result, { night: 3, seen: 2 });
  assert.equal(calls.judge, 1);
  assert.equal(calls.notes.length, 3);
});
