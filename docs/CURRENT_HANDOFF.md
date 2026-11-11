# Current repository handoff

Checked November 11, 2026. Point-in-time evidence; recheck the relevant head before acting.

- Authorized beta source: 36fb3254a347381c581ff8f247f2ea1df97af976 on ux/private-testing-20261029. This documentation branch starts there; PR93 runtime changes are not imported.

- PR92 merged as eff790e589f276e8f7acd5a26c21d7853c4b25a7. Its additive Square lookup and two Edge v2 packages have a recorded beta rollout. Do not repeat integration or rollout; merchant/provider/device acceptance remains open.

- PR93 remains draft and unmerged at 852a11b7fd8ff903d3fbc247fd85869c40be64d9. The stale Settings/completion selectors are repaired. Run 43116095293: all six browser shards, four WebKit shards and four DOM shards passed; node-tests and desktop-and-scheduling / checks were still running. This is not a complete-suite pass.

- Last recorded live frontend: 36fb325 / dpl_9FNK5BTXgwpe5qxpcmPG2mWEgFSb. This task did not independently probe deployment or change frontend, schema, Edge functions or providers. Beta backend remains xvybcmyoblfgzokaifsx.

- Owner authorized publication, merge and private-beta deployment after required checks pass. Next: publish this documentation candidate, verify required CI, then merge and verify beta deployment. PR93 remains a separate candidate requiring its own final checks. Keep all unmet provider, physical-device and public-launch gates open.

## Documentation reconciliation

All 50 original task records, acceptance criteria, statuses and evidence are unchanged. AI-03 is the only added readiness record and remains open. Existing dated observations, recommendations, proposals and sources remain in the canonical registry; current-state statements supersede historical next actions. PR93 adds no task-record changes; its additional observation is preserved with its original date and evidence.

The unpublished c941e9e object was unavailable in local repositories and GitHub (422: no commit found). No old snapshot was applied or publication retried. The maintained owner guide supplies the task cards and exact 28-package mapping. Direct comparison with the old patch remains unavailable; do not claim byte-for-byte reconciliation.

Owner has now authorized publication, merge and private-beta deployment after required checks pass. Before publishing, fetch and compare the authorized beta and PR93 heads again; retain any newer evidence with a normal merge/reconciliation, never a forced update.

[Focused cards](FOCUSED_TASK_CARDS.md) · [Generated work queue](../ASSESSMENT_REPORT.md) · [Canonical registry](launch-readiness.json)
