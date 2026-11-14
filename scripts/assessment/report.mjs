import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
export const registryPath = "docs/launch-readiness.json",
  reportPath = "ASSESSMENT_REPORT.md";
const states = new Set([
  "open",
  "blocked_external",
  "not_verified",
  "deferred",
  "done",
]);
const date = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function validateRegistry(data) {
  if (
    data.schemaVersion !== 1 ||
    !date(data.updatedAt) ||
    !Array.isArray(data.tasks) ||
    !Array.isArray(data.observations) ||
    !Array.isArray(data.recommendations) ||
    !Array.isArray(data.sources)
  )
    throw Error("Invalid readiness registry");
  if (data.proposals !== undefined) {
    if (!Array.isArray(data.proposals)) throw Error("Invalid proposals");
    const titles = new Set();
    for (const p of data.proposals) {
      if (
        !p ||
        !["title", "body"].every(
          (k) => typeof p[k] === "string" && p[k].trim(),
        ) ||
        !date(p.updatedAt) ||
        (p.statusNote !== undefined && (typeof p.statusNote !== 'string' || !p.statusNote.trim())) ||
        titles.has(p.title)
      )
        throw Error("Invalid or duplicate proposal");
      titles.add(p.title);
    }
  }
  const ids = new Set();
  for (const t of data.tasks) {
    if (
      !/^[A-Z]+-\d+$/.test(t.id) ||
      ids.has(t.id) ||
      !["P0", "P1", "P2"].includes(t.priority) ||
      !states.has(t.status) ||
      !["public", "paid", "pro", "advertised", "optional"].includes(t.gate) ||
      !["title", "owner", "why", "acceptance"].every(
        (k) => typeof t[k] === "string" && t[k].trim(),
      )
    )
      throw Error("Invalid or duplicate task " + t.id);
    ids.add(t.id);
    if (
      t.status === "done" &&
      (!date(t.completedAt) ||
        !t.evidence?.length ||
        !t.evidence.every(
          (e) =>
            typeof e.reference === "string" &&
            e.reference.trim() &&
            date(e.verifiedAt) &&
            /^[a-f0-9]{40}$/.test(e.commit),
        ))
    )
      throw Error("Completion needs dated, commit-bound evidence: " + t.id);
  }
  if (!data.workQueue || !Array.isArray(data.currentState) || !data.currentState.length)
    throw Error("Missing focused work queue or current handoff");
  const q = data.workQueue, cardIds = new Set();
  if (!Array.isArray(q.cards) || !Array.isArray(q.crosswalk) || !q.guide || !q.handoff)
    throw Error("Invalid work queue");
  for (const c of q.cards) {
    if (!/^\d{2}$/.test(c.number) || cardIds.has(c.number) || !c.title || !c.boundary ||
        !Array.isArray(c.taskIds) || !c.taskIds.length || c.taskIds.some(id => !ids.has(id)))
      throw Error("Invalid or duplicate task card");
    cardIds.add(c.number);
  }
  for (const id of ids) if (!q.cards.some(c => c.number !== "02" && c.taskIds.includes(id)))
    throw Error("Unmapped readiness record " + id);
  if (q.crosswalk.length !== 28 || new Set(q.crosswalk.map(p => p.package)).size !== 28 ||
      q.crosswalk.some(p => !Number.isInteger(p.package) || p.package < 1 || p.package > 28 ||
        !p.title || !Array.isArray(p.cards) || !p.cards.length || p.cards.some(n => !cardIds.has(n))))
    throw Error("Invalid 28-package crosswalk");
  return data;
}
const cell = (value) =>
  String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const table = (head, rows) =>
  [
    "| " + head.join(" | ") + " |",
    "| " + head.map(() => "---").join(" | ") + " |",
    ...rows.map((r) => "| " + r.map(cell).join(" | ") + " |"),
  ].join("\n");
export function renderReport(input) {
  const d = validateRegistry(input), open = d.tasks.filter(t => t.status !== "done");
  const publicGates = open.filter(t => t.gate === "public");
  const paid = open.filter(t => ["paid", "pro", "advertised"].includes(t.gate));
  const q = d.workQueue, lines = [];
  const add = (...v) => { for (const value of v) lines.push(value, ""); };
  add("# Finviant Assessment Report",
    `**Reviewed: ${d.updatedAt} (${d.timezone}).** Focused work queue; acceptance records are not counts of unbuilt features.`,
    "> Generated from [docs/launch-readiness.json](docs/launch-readiness.json). Completed tasks are removed from this report automatically; evidence/history remains in the registry and Git history. Do not edit this generated file directly.");
  add("## Release boundary",
    `**${publicGates.length ? "NOT READY for unrestricted public launch" : "Public gates recorded complete; confirm the release decision"}** — ${publicGates.length} public gates; ${paid.length} paid/Pro/advertised gates; ${open.filter(t => t.gate === "optional").length} optional/deferred items.`,
    "Owner authorized publication, merge and private-beta deployment after required checks pass. Private beta, existing permissions and backend remain unchanged. Source, CI, merge, migration, deployment, activation and provider/physical-device acceptance are separate.");
  add("## Current state and next action", ...d.currentState.map(s => `- ${s}`),
    `[Current handoff](${q.handoff}) · [Detailed task cards](${q.guide}). Select one card; do not repeat the full audit. Recheck current heads before publication or release.`);
  add("## Focused task cards", "This index summarizes scope and blockers; detailed Task and Done when text lives once in the linked guide.",
    table(["Card", "Selected work", "Boundary / input"], q.cards.map(c => [c.number,
      `[${c.title}](${q.guide}#card-${c.number}-${c.title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")})`, c.boundary])));
  add("## Open acceptance records", "Original acceptance criteria, owner, rationale and evidence remain in the canonical registry. Cards narrow execution; they do not replace or weaken those criteria. Card 02 maintains every record; the table lists implementation/acceptance cards separately.",
    table(["ID", "Priority / status", "Requirement", "Gate", "Cards"], open.map(t => [t.id, `${t.priority} · ${t.status}`, t.title, t.gate,
      q.cards.filter(c => c.number !== "02" && c.taskIds.includes(t.id)).map(c => c.number).join(", ")])));
  add("## Original 28-package crosswalk", "Lookup only; not a completion certificate or instruction to rerun all packages.",
    table(["Package", "Original scope", "Cards"], q.crosswalk.map(p => [p.package, p.title, p.cards.join(", ")])));
  add("## Decisions and supporting evidence", "The canonical registry retains all dated observations, recommendations, proposal bodies and source references. Historical pending actions are superseded by the current handoff; approved document design, reminder rules and worker-profile/login separation are not reopened.");
  for (const p of d.proposals || []) add(`## ${p.title}`, `**${p.statusNote || "Implementation pending."}** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.`);
  add("## Maintenance", "Run `npm run assessment:sync`, `npm run assessment:test`, and `npm run assessment:check` after registry changes. Close tasks only with complete dated, commit-bound acceptance evidence; use assessment:complete or assessment:reopen. Never infer provider, restore, capacity or physical-device acceptance from source, mocks or deployment READY.",
    "No runtime change, migration, provider activation, real send/charge, access expansion, paid commitment or public cutover is authorized by this report.");
  return lines.join("\n").trim() + "\n";
}
export function transitionTask(input, id, status, evidence, day, commit) {
  const d = structuredClone(input);
  const t = d.tasks.find((t) => t.id === id);
  if (!t) throw Error("Unknown task " + id);
  if (!evidence?.trim()) throw Error("Evidence or reopening reason required");
  if (!date(day) || !/^[a-f0-9]{40}$/.test(commit))
    throw Error("Valid date and immutable commit required");
  t.status = status;
  t.evidence = [
    ...(t.evidence || []),
    { reference: evidence, verifiedAt: day, commit },
  ];
  if (status === "done") t.completedAt = day;
  else {
    delete t.completedAt;
    t.reopenedReason = evidence;
  }
  d.updatedAt = day;
  return validateRegistry(d);
}
function write(path, text) {
  const temp = path + ".tmp";
  writeFileSync(temp, text);
  renameSync(temp, path);
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2),
    read = () => JSON.parse(readFileSync(registryPath, "utf8"));
  let data = read();
  if (args.includes("--complete") || args.includes("--reopen")) {
    const complete = args.includes("--complete"),
      index = args.indexOf(complete ? "--complete" : "--reopen"),
      id = args[index + 1],
      flag = complete ? "--evidence" : "--reason",
      e = args[args.indexOf(flag) + 1];
    if (!args.includes(flag)) throw Error(flag + " is required");
    const day = args.includes("--date")
      ? args[args.indexOf("--date") + 1]
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
        }).format(new Date());
    const commit = args.includes("--commit")
      ? args[args.indexOf("--commit") + 1]
      : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (!/^[a-f0-9]{40}$/.test(commit || ""))
      throw Error("Immutable evidence commit required");
    execFileSync("git", ["cat-file", "-e", commit + "^{commit}"]);
    if (!args.includes("--commit")) {
      const dirty = execFileSync("git", ["diff", "HEAD", "--name-only"], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(
          (p) =>
            p &&
            !["ASSESSMENT_REPORT.md", "docs/launch-readiness.json"].includes(p),
        );
      if (dirty.length)
        throw Error(
          "Commit tested implementation first, or pass --commit with its verified immutable commit.",
        );
    }
    data = transitionTask(data, id, complete ? "done" : "open", e, day, commit);
    write(registryPath, JSON.stringify(data, null, 2) + "\n");
  }
  const report = renderReport(data);
  if (args.includes("--check")) {
    if (readFileSync(reportPath, "utf8") !== report) {
      console.error("Assessment report is stale. Run npm run assessment:sync.");
      process.exitCode = 1;
    } else console.log("Assessment registry and report are consistent.");
  } else {
    write(reportPath, report);
    console.log("Updated " + reportPath + " from " + registryPath);
  }
}
