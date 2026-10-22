// The sloth itself: wake up, read the news about each tool, write one note,
// sleep a day, repeat. Temporal keeps this loop alive across crashes and
// restarts, and replays it without repeating finished searches.
import { proxyActivities, sleep, continueAsNew } from "@temporalio/workflow";
import { freshItems, remember, formatNote } from "./lib.js";

const { searchWeb, judge, saveNote } = proxyActivities({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "5 seconds", backoffCoefficient: 2, maximumAttempts: 4 },
});

export async function slothWatch({
  business,
  seen = [],
  night = 0,
  maxNights = 0, // 0 means forever
  gap = "24 hours",
  perRun = 7, // nights per workflow run, then continue-as-new to keep history small
}) {
  for (let n = 0; n < perRun; n++) {
    const date = new Date().toISOString().slice(0, 10); // deterministic in a workflow
    const findings = [];
    const problems = [];
    for (const tool of business.tools) {
      try {
        // First night looks back a month, later nights a week; seen links are skipped.
        const items = freshItems(await searchWeb(tool.query, night === 0 ? "m" : "w"), seen);
        if (!items.length) continue;
        const verdicts = await judge({ business: business.name, tool, items, date });
        seen = remember(seen, items); // only after the judge, so a failed night is retried tomorrow
        for (const v of verdicts) {
          const { title, link, source } = items[v.i];
          findings.push({ ...v, tool: tool.name, what: tool.what, site: tool.site, title, link, source });
        }
      } catch (err) {
        // All retries are spent. Say so in the note and check the other tools.
        problems.push(`${tool.name}: ${err.cause?.message ?? err.message}`);
      }
    }
    await saveNote({ slug: business.slug, date, night: night + 1, text: formatNote({ business: business.name, date, findings, problems }) });
    night++;
    if (maxNights && night >= maxNights) return { night, seen: seen.length };
    await sleep(gap);
  }
  await continueAsNew({ business, seen, night, maxNights, gap, perRun });
}
