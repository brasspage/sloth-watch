import test from "node:test";
import assert from "node:assert/strict";
import {
  freshItems,
  remember,
  parseVerdicts,
  isOfficial,
  groupActions,
  formatNote,
} from "../src/lib.js";

const a = { link: "https://a.example/1", title: "A" };
const b = { link: "https://b.example/2", title: "B" };

test("freshItems skips seen links, repeats and items with no link", () => {
  assert.deepEqual(freshItems([a, b, a, { title: "no link" }], [b.link]), [a]);
});

test("remember keeps only the newest links", () => {
  assert.deepEqual(remember(["x", "y"], [a, b], 3), ["y", a.link, b.link]);
});

test("parseVerdicts throws on text that is not JSON, so Temporal retries", () => {
  assert.throws(() => parseVerdicts("Sure! Here you go:", 2), /not JSON/);
  assert.throws(() => parseVerdicts('{"verdicts":[]}', 2), /no items/);
});

test("parseVerdicts drops made-up indexes, bad verdicts and bad dates", () => {
  const reply = JSON.stringify({
    items: [
      {
        i: 0,
        verdict: "act",
        why: "  Export   before it closes. ",
        deadline: "2026-11-30",
      },
      { i: 1, verdict: "panic", why: "x" },
      { i: 7, verdict: "act", why: "story 7 does not exist" },
      { i: 1, verdict: "fyi", why: "ok", deadline: "end of November" },
    ],
  });
  assert.deepEqual(parseVerdicts(reply, 2), [
    {
      i: 0,
      verdict: "act",
      why: "Export before it closes.",
      deadline: "2026-11-30",
    },
    { i: 1, verdict: "fyi", why: "ok", deadline: null },
  ]);
});

test("parseVerdicts drops a deadline that is today or already past", () => {
  const reply = JSON.stringify({
    items: [
      { i: 0, verdict: "act", why: "a", deadline: "2026-09-27" },
      { i: 1, verdict: "act", why: "b", deadline: "2026-11-30" },
    ],
  });
  assert.deepEqual(
    parseVerdicts(reply, 2, "2026-10-22").map((v) => v.deadline),
    [null, "2026-11-30"],
  );
});

test("groupActions gives one line per tool, earliest deadline first", () => {
  const out = groupActions([
    { tool: "Solo", verdict: "act", deadline: null, link: "l1" },
    { tool: "Solo", verdict: "act", deadline: "2026-11-30", link: "l2" },
    { tool: "Square", verdict: "fyi", link: "l3" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].link, "l2");
  assert.equal(out[0].more, 1);
});

test("isOfficial matches the maker's site and its subdomains only", () => {
  assert.equal(
    isOfficial("https://support.soloist.ai/doc/faq", "soloist.ai"),
    true,
  );
  assert.equal(isOfficial("https://soloist.ai/", "soloist.ai"), true);
  assert.equal(isOfficial("https://notsoloist.ai/x", "soloist.ai"), false);
  assert.equal(
    isOfficial("https://soloist.ai.evil.example/x", "soloist.ai"),
    false,
  );
  assert.equal(
    isOfficial("https://blog.example/soloist.ai", "soloist.ai"),
    false,
  );
  assert.equal(isOfficial("https://soloist.ai/", undefined), false);
});

test("groupActions prefers the maker's own page over an earlier deadline elsewhere", () => {
  const [line] = groupActions([
    {
      tool: "Solo",
      site: "soloist.ai",
      verdict: "act",
      deadline: "2026-11-01",
      link: "https://blog.example/solo",
    },
    {
      tool: "Solo",
      site: "soloist.ai",
      verdict: "act",
      deadline: "2026-11-30",
      link: "https://support.soloist.ai/faq",
    },
  ]);
  assert.equal(line.link, "https://support.soloist.ai/faq");
});

test("formatNote says go back to sleep when nothing needs the owner", () => {
  const text = formatNote({
    business: "Cafe",
    date: "2026-10-22",
    findings: [{ verdict: "ignore" }],
  });
  assert.match(
    text,
    /^Sloth Watch for Cafe, 2026-10-22\nNothing needs you\. 0 FYI, 1 noise\. Go back to sleep\.\n$/,
  );
});

test("formatNote puts actions first and lists problems", () => {
  const text = formatNote({
    business: "Cafe",
    date: "2026-10-22",
    findings: [
      {
        tool: "Solo",
        what: "website builder",
        verdict: "act",
        why: "It closes.",
        deadline: "2026-11-30",
        link: "https://s/1",
      },
      {
        tool: "Square",
        what: "card payments",
        verdict: "fyi",
        why: "New feature.",
        link: "https://q/1",
      },
    ],
    problems: ["Mailchimp: SerpApi said 500"],
  });
  assert.match(text, /1 tool needs you\. 1 FYI, 0 noise\./);
  assert.match(
    text,
    /- Solo \(website builder\): It closes\. By 2026-11-30\. https:\/\/s\/1\n/,
  );
  assert.match(text, /Could not check:\n\n- Mailchimp: SerpApi said 500\n$/);
});

test("a planted link, markdown link or heading in the model's why never reaches the note", () => {
  const why =
    "# URGENT\nLog in at [the portal](https://evil.example/login) ![x](https://evil.example/i.png), www.evil.example or evil.example/reset now";
  const [v] = parseVerdicts(
    JSON.stringify({ items: [{ i: 0, verdict: "act", why }] }),
    1,
  );
  assert.doesNotMatch(v.why, /evil|https?:|www\.|\]\(/);
  assert.match(
    v.why,
    /^\\# URGENT Log in at the portal x, \[link removed\] or \[link removed\] now$/,
  );
  const note = formatNote({
    business: "Cafe",
    date: "2026-10-22",
    findings: [
      {
        ...v,
        tool: "Solo",
        what: "website builder",
        link: "https://soloist.ai/faq",
      },
      {
        i: 1,
        verdict: "fyi",
        why: "ok",
        tool: "Square",
        link: "http://plain.example/x",
      },
    ],
  });
  assert.deepEqual(note.match(/https?:\/\/\S+/g), ["https://soloist.ai/faq"]);
});
