// Pure helpers. The Temporal workflow imports this file, so it must stay
// deterministic: no I/O, no Node APIs, no Math.random.

export const VERDICTS = ["act", "fyi", "ignore"];

// Search results we have not seen before, in order, without repeats.
export function freshItems(items, seen) {
  const known = new Set(seen);
  const out = [];
  for (const item of items) {
    if (!item?.link || known.has(item.link)) continue;
    known.add(item.link);
    out.push(item);
  }
  return out;
}

// ponytail: keeps the newest 500 links, enough for months of 4 tools x 10 results.
export function remember(seen, items, max = 500) {
  return [...seen, ...items.map((i) => i.link)].slice(-max);
}

// The model's reply is untrusted text. Keep only well-formed verdicts that
// point at a story we actually gave it. Links never come from the model.
// A "deadline" on or before today is usually the article's own date, so it is dropped.
export function parseVerdicts(text, count, today = "") {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("model reply is not JSON");
  }
  if (!Array.isArray(data?.items)) throw new Error("model reply has no items");
  const out = [];
  for (const v of data.items) {
    if (!Number.isInteger(v?.i) || v.i < 0 || v.i >= count) continue;
    if (!VERDICTS.includes(v.verdict)) continue;
    const deadline =
      /^\d{4}-\d{2}-\d{2}$/.test(v.deadline ?? "") && v.deadline > today
        ? v.deadline
        : null;
    out.push({ i: v.i, verdict: v.verdict, why: cleanWhy(v.why), deadline });
  }
  return out;
}

// "why" is model text built from web pages, so it can carry a planted link or
// markdown. Keep the words, drop every link, escape the rest.
export function cleanWhy(text) {
  return String(text ?? "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, "\\$&")
    .replace(
      /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?/gi,
      "[link removed]",
    );
}

// The only link in a note line: the search result's own, and only https.
export const safeLink = (link) =>
  /^https:\/\/[^\s<>()[\]]+$/.test(link ?? "") ? link : "";

// True when the link is on the tool maker's own site (or a subdomain of it).
export function isOfficial(link, site) {
  const host = (/^https?:\/\/([^/:?#]+)/i.exec(link ?? "") ??
    [])[1]?.toLowerCase();
  return Boolean(site && host && (host === site || host.endsWith(`.${site}`)));
}

// One line per tool that needs the owner. The maker's own page wins, then the
// earliest deadline; the rest of that tool's stories are counted, not listed.
export function groupActions(findings) {
  const byTool = new Map();
  for (const f of findings.filter((f) => f.verdict === "act")) {
    const list = byTool.get(f.tool) ?? [];
    list.push(f);
    byTool.set(f.tool, list);
  }
  return [...byTool.values()].map((list) => {
    const sorted = [...list].sort(
      (a, b) =>
        isOfficial(b.link, b.site) - isOfficial(a.link, a.site) ||
        (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
    );
    return { ...sorted[0], more: list.length - 1 };
  });
}

export function formatNote({ business, date, findings, problems = [] }) {
  const actions = groupActions(findings);
  const fyi = findings.filter((f) => f.verdict === "fyi");
  const noise = findings.filter((f) => f.verdict === "ignore").length;
  const lines = [`Sloth Watch for ${business}, ${date}`];
  lines.push(
    actions.length
      ? `${actions.length} ${actions.length === 1 ? "tool needs" : "tools need"} you. ${fyi.length} FYI, ${noise} noise.`
      : `Nothing needs you. ${fyi.length} FYI, ${noise} noise. Go back to sleep.`,
  );
  if (actions.length) {
    lines.push("", "Needs you:", "");
    for (const a of actions) {
      const by = a.deadline ? ` By ${a.deadline}.` : "";
      const more = a.more ? ` (+${a.more} more on this)` : "";
      lines.push(
        `- ${a.tool} (${a.what}): ${a.why}${by} ${safeLink(a.link)}${more}`,
      );
    }
  }
  if (fyi.length) {
    lines.push("", "FYI:", "");
    for (const f of fyi)
      lines.push(`- ${f.tool}: ${f.why} ${safeLink(f.link)}`);
  }
  if (problems.length) {
    lines.push("", "Could not check:", "");
    for (const p of problems) lines.push(`- ${p}`);
  }
  return lines.join("\n") + "\n";
}
