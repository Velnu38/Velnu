import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderReport,
  transitionTask,
  validateRegistry,
} from "../../scripts/assessment/report.mjs";
import { publishReport } from "../../scripts/assessment/publish.mjs";
const registry = JSON.parse(readFileSync("docs/launch-readiness.json", "utf8")),
  commit = "a".repeat(40);
test("canonical registry renders only open work and completion requires dated immutable evidence", () => {
  const done = transitionTask(
    registry,
    "EMAIL-01",
    "done",
    "Controlled live provider and inbox receipt",
    "2026-11-08",
    commit,
  );
  assert.equal(renderReport(done).includes("| EMAIL-01 |"), false);
  assert.ok(done.tasks.find((t) => t.id === "EMAIL-01").evidence.length);
  const reopened = transitionTask(
    done,
    "EMAIL-01",
    "open",
    "Delivery regression receipt",
    "2026-11-08",
    commit,
  );
  assert.ok(renderReport(reopened).includes("| EMAIL-01 |"));
  for (const bad of ["", undefined])
    assert.throws(
      () =>
        transitionTask(registry, "EMAIL-01", "done", bad, "2026-11-08", commit),
      /required/,
    );
  assert.throws(
    () =>
      transitionTask(
        registry,
        "EMAIL-01",
        "done",
        "receipt",
        "2026-02-31",
        commit,
      ),
    /date/,
  );
  assert.throws(
    () =>
      transitionTask(
        registry,
        "EMAIL-01",
        "done",
        "receipt",
        "2026-11-08",
        "moving-branch",
      ),
    /commit/,
  );
  const invalid = structuredClone(registry);
  invalid.tasks[0].status = "done";
  assert.throws(() => validateRegistry(invalid), /Completion needs/);
});
test("report generation is deterministic, current output matches and public gates cannot silently disappear", () => {
  assert.equal(
    renderReport(registry),
    readFileSync("ASSESSMENT_REPORT.md", "utf8"),
  );
  assert.equal(renderReport(registry), renderReport(structuredClone(registry)));
  assert.match(renderReport(registry), /NOT READY/);
  const duplicate = structuredClone(registry);
  duplicate.tasks.push(duplicate.tasks[0]);
  assert.throws(() => renderReport(duplicate), /duplicate/);
  assert.equal(renderReport(registry).includes("CAMPAIGN_STATUS_START"), false);
  assert.equal(renderReport(registry).includes("CARD-01"), false);
});
test("saved pricing policy survives task completion and rejects invalid proposal metadata", () => {
  const proposal = registry.proposals.find((p) => p.title === "Finviant Pricing");
  assert.ok(proposal);
  const completed = transitionTask(
    registry,
    "EMAIL-01",
    "done",
    "Controlled live provider and inbox receipt",
    "2026-11-08",
    commit,
  );
  const report = renderReport(completed);
  assert.ok(report.includes("## Finviant Pricing\n"));
  assert.ok(report.includes(proposal.body));
  assert.ok(report.includes("Implementation pending."));
  assert.ok(report.includes("| PLAN-01 |"));
  assert.ok(report.includes("| RET-01 |"));
  for (const proposals of [
    {},
    [null],
    [{ ...proposal, updatedAt: "2026-02-31" }],
    [{ ...proposal, body: " " }],
    [proposal, proposal],
  ])
    assert.throws(
      () => renderReport({ ...registry, proposals }),
      /Invalid.*proposal/,
    );
  const legacy = structuredClone(registry);
  delete legacy.proposals;
  assert.doesNotThrow(() => renderReport(legacy));
});
test("public launch remains blocked if any public acceptance gate is unverified", () => {
  const d = structuredClone(registry);
  for (const t of d.tasks) {
    if (t.gate === "public") {
      t.status = "done";
      t.completedAt = "2026-11-08";
      t.evidence = [
        { reference: "verified fixture", verifiedAt: "2026-11-08", commit },
      ];
    }
  }
  assert.match(renderReport(d), /Public gates recorded complete/);
  d.tasks.find((t) => t.gate === "public").status = "not_verified";
  assert.match(renderReport(d), /NOT READY/);
});
test("publisher refuses untrusted repository context and never overwrites an advanced branch", async () => {
  await assert.rejects(
    () =>
      publishReport({
        token: "fixture",
        repository: "other/repo",
        branch: registry.branch,
        expectedSha: commit,
        content: "report",
      }),
    /Trusted/,
  );
  let calls = 0;
  const result = await publishReport({
    token: "fixture",
    repository: registry.repository,
    branch: registry.branch,
    expectedSha: commit,
    content: "report",
    fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ object: { sha: "b".repeat(40) } }));
    },
  });
  assert.equal(result.updated, false);
  assert.equal(calls, 1);
});
test("publisher only writes the report with the expected parent and a non-forced update", async () => {
  const calls = [],
    replies = [
      { object: { sha: commit } },
      { content: Buffer.from("old").toString("base64") },
      { tree: { sha: "base-tree" } },
      { sha: "new-tree" },
      { sha: "new-commit" },
      {},
    ];
  const result = await publishReport({
    token: "fixture",
    repository: registry.repository,
    branch: registry.branch,
    expectedSha: commit,
    content: "new",
    fetcher: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        body: init.body ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify(replies.shift()));
    },
  });
  assert.equal(result.updated, true);
  assert.deepEqual(calls[3].body.tree, [
    {
      path: "ASSESSMENT_REPORT.md",
      mode: "100644",
      type: "blob",
      content: "new",
    },
  ]);
  assert.deepEqual(calls[4].body.parents, [commit]);
  assert.deepEqual(calls[5].body, { sha: "new-commit", force: false });
});
test("legacy campaign publication cannot append historical campaign state to the generated launch report", () => {
  const s = readFileSync("scripts/qa/publish-results.mjs", "utf8");
  const guard = s.indexOf(
    "if(report.includes('Generated from [docs/launch-readiness.json]'))",
  );
  assert.ok(guard >= 0);
  assert.ok(
    guard < s.indexOf("const status=['<!-- CAMPAIGN_STATUS_START -->'"),
  );
});
