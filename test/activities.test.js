import test from "node:test";
import assert from "node:assert/strict";
import { makeActivities } from "../src/activities.js";

test("a 429 asks Temporal to retry after the server's retry-after wait", async () => {
  const { judge } = makeActivities({
    fetch: async () =>
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "7" },
      }),
    env: {},
  });
  const items = [{ title: "t", source: "s", date: "", snippet: "" }];
  await assert.rejects(
    judge({
      business: "Cafe",
      tool: { name: "Solo", what: "x" },
      items,
      date: "2026-10-22",
    }),
    (err) =>
      err.type === "RateLimited" &&
      !err.nonRetryable &&
      err.nextRetryDelay === "7s",
  );
});
