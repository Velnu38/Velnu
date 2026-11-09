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
  const d = validateRegistry(input),
    open = d.tasks.filter((t) => t.status !== "done"),
    publicGates = open.filter((t) => t.gate === "public"),
    paid = open.filter((t) => ["paid", "pro", "advertised"].includes(t.gate)),
    lines = [];
  const add = (...v) => {
    for (const value of v) lines.push(value, "");
  };
  add(
    "# Finviant Assessment Report",
    `**Reviewed: ${d.updatedAt} (${d.timezone}).** Current open-work assessment for hundreds of customer businesses.`,
    "> Generated from [docs/launch-readiness.json](docs/launch-readiness.json). Completed tasks are removed from this report automatically; evidence/history remains in the registry and Git history. Do not edit this generated file directly.",
  );
  add(
    "## Launch decision",
    `**${publicGates.length ? "NOT READY for unrestricted public launch" : "Public gates recorded complete; confirm the release decision"}** — ${publicGates.length} public-launch gates remain; ${paid.length} additional paid/Pro/advertised-feature items remain. ${open.filter((t) => t.gate === "optional").length} optional/deferred enhancements are kept separate.`,
    d.verdict,
    "The application has a substantial working product. The main remaining work is verified provider activation, production operations, multi-tenant security and measured capacity. No claim of support for hundreds of simultaneous customers is established by the current small beta dataset.",
  );
  add(
    "## To-do summary — execution order",
    "1. Approve commercial hosting/production ownership, backup/rollback and ordinary onboarding (REL-01–03, OPS-01).",
    "2. Make the current release gate green; harden Auth, tenant boundaries and burst/cost controls (CI-01, SEC-01–03).",
    "3. Install and test operational alerts, verify background jobs, tune query/connection pressure, then measure isolated multi-tenant load (OPS-02–03, PERF-01–02).",
    "4. Certify general email, subscription purchase, Pro SMS, merchant payments and external calendars before advertising/charging for those capabilities (EMAIL/BILL/SMS/PAY/CAL).",
    "5. Implement and verify the Finviant Pricing proposal, complete owner exports and the disclosed expiry/deletion lifecycle before activating public trials or the 90-day Free offer (PLAN-01, EXPORT-01, RET-01). Finish device/provider acceptance, support/privacy operations and tier unit economics; stage rollout rather than opening registration to everyone at once.",
  );
  add(
    "## Verified current observations",
    table(
      ["Area", "Observed state / evidence limit", "Evidence"],
      d.observations.map((o) => [
        o.title,
        `${o.detail} (checked ${o.verifiedAt})`,
        o.evidence,
      ]),
    ),
    `Audited code baseline: \`${d.auditedCommit}\`. Branch: \`${d.branch}\`. Findings are source/configuration observations, not a penetration-test or load-test certificate.`,
  );
  for (const p of d.proposals || []) {
    add(
      `## ${p.title}`,
      `**Proposal updated: ${p.updatedAt} (${d.timezone}). Implementation pending.**`,
      p.body,
    );
  }
  add(
    "## Public-launch gates",
    table(
      [
        "ID",
        "Priority / status",
        "Work and owner",
        "Acceptance needed to close",
      ],
      publicGates.map((t) => [
        t.id,
        `${t.priority} · ${t.status}`,
        `${t.title} — ${t.owner}. ${t.why}`,
        t.acceptance,
      ]),
    ),
  );
  add(
    "## Paid, Pro and advertised-feature gates",
    "These can be staged separately only if unavailable features and prices are presented accurately. A live landing page, a configured secret or a connected database row is not end-to-end activation evidence.",
    table(
      [
        "ID",
        "Priority / status",
        "Work and owner",
        "Acceptance needed to close",
      ],
      paid.map((t) => [
        t.id,
        `${t.priority} · ${t.status}`,
        `${t.title} — ${t.owner}. ${t.why}`,
        t.acceptance,
      ]),
    ),
  );
  add(
    "## Optional / owner-deferred backlog",
    table(
      ["ID", "Status", "Work", "Acceptance"],
      open
        .filter((t) => t.gate === "optional")
        .map((t) => [t.id, t.status, `${t.title}. ${t.why}`, t.acceptance]),
    ),
  );
  add(
    "## Recommended monitoring and configuration",
    "These are assessed recommendations, not newly purchased accounts or activated monitoring. Prefer this small stack over overlapping plugins. Account capabilities, cost, retention and alert delivery must be confirmed before activation.",
    table(
      [
        "Tool / service",
        "Purpose and current state",
        "Recommended configuration",
        "Cost / decision",
      ],
      d.recommendations.map((r) => [
        r.tool,
        `${r.purpose}. ${r.current}`,
        r.configuration,
        r.cost,
      ]),
    ),
  );
  add(
    "## Capacity plan and acceptance targets",
    "Treat hundreds of registered businesses, simultaneous logged-in people and public customer-link traffic as different loads. Start with an isolated production-like dataset of at least **300 workspaces**, separate authenticated tenant sessions, realistic histories/files and skewed heavy accounts. Ramp **10 → 50 → 100 active users**, record achieved requests/second and transaction mix, run a **60-minute soak**, then test a controlled spike and queue recovery. Increase toward 1,000 workspaces only after measured acceptance. The old 1,000 input-profile campaign is not equivalent to 1,000 customer accounts.",
    "Proposed starting targets, to approve and measure: ordinary read/write API p95 ≤1 second and <1% unexpected failures; no cross-tenant data, duplicate financial mutations or duplicate confirmed sends; p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative mobile journeys; 99.9% monthly service availability as an operational goal, not a current SLA. Report PDF/OCR/voice latency separately from ordinary API calls. Start alerts around 70–80% sustained resource/connection pressure, any dead-letter job, and queue lag beyond two normal schedule intervals.",
    "Proposed recovery goals: RPO ≤15 minutes and RTO ≤4 hours if the selected backup/PITR and storage plan can demonstrably achieve them. Otherwise document achievable numbers and make an explicit business decision. Do not promise those goals before a restore drill.",
    "Bound tests to approved staging infrastructure and provider policies. Stub billable third-party sends/AI/payment capture at scale; run a few separately authorized live-provider checks. Do not load-test the current beta domain or create hundreds of persistent customer accounts during an assessment.",
    "Suggested rollout: 10 real pilot businesses → 50 → 100 → 300, with an owner-reviewed 48–72-hour stability/incident/usage window at each step. Gate expansion on monitored error rates, support load, provider success, queue lag and actual capacity; these windows are recommendations, not measured history.",
  );
  add(
    "## How this report stays current",
    "- Canonical task and evidence state: `docs/launch-readiness.json`. `npm run assessment:sync` deterministically regenerates this report; `npm run assessment:check` rejects stale output and unsupported completion records.",
    '- A verified completion is recorded with `npm run assessment:complete -- ID --evidence "receipt/test/provider verification reference"`. It requires a date and immutable code commit, removes that item from the report, and preserves its evidence in the registry. Source existence or mocked tests alone must not close an external-provider, capacity, restore or real-device gate. Reopen regressions with `npm run assessment:reopen -- ID --reason "failure evidence"`.',
    "- `.github/workflows/assessment-report.yml` validates PRs and regenerates on trusted release-branch pushes. If only the report is stale, the trusted job writes a report-only commit using a non-forced, exact-parent Git update. No credentials or customer data belong in the report.",
    "- A separate daily evidence review checks for newly verified completions, regressions and provider/configuration changes. It updates the registry/report only with adequate evidence. This is a periodic check, not an instantaneous subscription to every external account setting.",
    "- Project `AGENTS.md` requires readiness updates as part of future work. The old campaign publisher cannot overwrite this current launch assessment. Historical campaigns and completed fixes remain in Git history and existing evidence files, rather than recurring as unfinished work.",
    "- A remote CI pass, deployment READY, scheduler dispatch, real-provider success and real-phone acceptance are distinct evidence types. Keep unknown/unavailable checks open and describe unavailable access rather than guessing.",
  );
  add(
    "## Source and audit scope",
    "The entire previous assessment was reviewed and replaced at the owner’s request: duplicate chronological releases, completed interface/card work, old branch-binding/SSO claims and old source-specific pass counts were removed from the active to-do report. Their history remains in Git and `STRESS_TEST_LOGS.json`/existing evidence. No provider activation, data migration, paid purchase, production Auth change or intrusive load/security test was performed by this document refresh.",
    ...d.sources.map(([label, url]) => `- [${label}](${url})`),
  );
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
