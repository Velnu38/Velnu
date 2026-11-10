# Release reconciliation and integration

Checked November 9, 2026, America/New_York. This is work package 1: source recovery, baseline reconciliation and safe source integration. It does not authorize the remaining 27 packages as external actions.

## Verified baseline

| Surface | Current evidence | Limit |
| --- | --- | --- |
| Release | `ux/private-testing-20261029`, `6cacfe7cfc1f9b02c3eec2a9d9ed1e53e78504b1` | Do not start from older QA/PR67 |
| Both domains | READY preview `dpl_2ZZ8fPGmhCg8af9K3b94NzUzSNkb`, same release SHA | Metadata is not signed-in acceptance |
| Hosting boundary | Project SSO is enabled; aliases have existing overrides; app private-beta admission remains required | No audience/security setting changed |
| Beta database | `xvybcmyoblfgzokaifsx`: 129 migration entries, 33 active Edge Functions | Ledger counts are not clean replay evidence |
| Isolated QA | `ocmlvzkackufwpwnnsdb`: SQL reachable, 109 entries, 26 functions, no worker roster/completion-report tables | Management project lookup returns NotFound; no reset attempted |
| Separate production | `qusmeexjbwphoezlcmie`: one bootstrap entry, 12 older functions | No key/domain swap or promotion |

The preview project labels identify beta; its browser URL is encrypted and was not decrypted. The five existing availability RPCs exist, are invokers, deny anonymous execution and permit authenticated execution. Their definition fingerprints belong in the schema-contract receipt; exact inventories belong in the baseline receipt, rather than treating RPC presence as tenant acceptance.

## Source integration

| Work | Inspected head | Candidate decision |
| --- | --- | --- |
| PR70 stationery/test repairs | `c2c717eee70843e20a53f2b0bd246b906f6b66b7` | Merged into review candidate; original PR/release untouched |
| Manager availability | `deb00364db985b1ea1398d0208772b6384c2d72d` | Merged; uses the existing shared Refresh control beside the heading |
| PR68 Fin guide | `b4363acd7ac28457b058eac11f4f0e035d49d39b` | Merged and reconciled with manager roster/seat limits and availability; no Edge deployment |
| PR69 execution | `373fba610a6ef46770e2e06cebeff4e39643ea98` | Held separately; preserve visits, costing and reports while separating field self-service |
| Customer reminders | `125211cf5e40391878810135e8dbdc2e0180fa18` | Held separately pending schema/concurrency/visit reconciliation; sending not activated |

The candidate is `review/finviant-integration-20261109`. Its Vercel automatic deployment is disabled, and the hosted build guard also rejects this branch. Local builds and synthetic checks remain available. No new migration, invitation, field-login UI or account seat is introduced. The original registry observations from release, availability and Fin branches are preserved; no acceptance gate is marked done from local tests.

PDF inspection against the supplied invoice/estimate references found an inherited zero-tax display defect. Newly generated template v3 omits the zero-tax summary and line tax labels. Frozen amounts and stored issued PDFs are unchanged; the existing artifact cache continues to return their original bytes. The centered default/custom footer and four-page custom-footer layout were inspected.

## Already-applied execution SQL: do not retry

| PR69 source filename | Actual beta ledger version | Statement MD5 |
| --- | --- | --- |
| `20261109203232_planned_job_visits.sql` | `20261110002708` | `9da146d2ab1afcb29f75a4b4543f3caf` |
| `20261109203235_assigned_field_workspace.sql` | `20261110002741` | `e929689153ab18ed0e06ae1efc824aac` |
| `20261109203238_job_cost_review_completion_reports.sql` | `20261110002751` | `95ff722b52a5768cf22e40ef15b38368` |
| Additional applied hardening | `20261110003505` | `dd57ffb79444c16e9c3018f620239545` |

The first three hashes match the PR69 source bytes exactly. The fourth SQL source was recovered by read-only query into `docs/reconciliation/job_execution_access_hardening_applied.sql`, outside automatic migration replay. It moves privileged implementations into private invoker-wrapped RPCs and adds grants/index/policy hardening. This review did not apply, retry or roll back any hosted migration and does not infer approval from a prior canceled request. Zero field accounts and zero field-time submissions were observed; this does not authorize enabling those APIs or UI.

## Dependency order and remaining work

1. **CI and replay (package 2):** finish current PR70 failures, pin supported runtime paths, run the full unmodified browser journeys against the candidate and rehearse the complete migration chain in disposable PostgreSQL/Supabase. Node 22.23.4 runs PGlite suites here; app builds use Node 24.22.1. Review the full Node24/PGlite concern rather than changing versions blindly. The connector does not expose Actions quota; no new remote runs were dispatched. Required-check repository settings need their applicable approval.
2. **Documents (package 3):** certify final draft/review/settings/link/attachment flows and rendered PDFs on that same candidate. The new shared renderer is not live until its Edge Function is deliberately released; frontend build success alone does not deploy it.
3. **Manager execution (package 4):** reuse PR69 visit/cost/report work. Exclude `FieldJobsPage`, `FieldAccountControls`, mandatory sign-in access-context dependency and new employee invitations/self-service from the manager release. Preserve existing records and restrictive backend protections. Reconcile the live hardening source/ledger names and validate effective schema, permissions, rollback and multi-visit estimate/deposit/change/final billing before any frontend promotion. Do not edit/reapply historical ledger entries to force timestamp equality.
4. **Availability (package 5):** retain this manager-only candidate and verify its existing booking conflicts against the final multi-visit implementation. Normal hours/time off are separate from confirmed bookable choices, the Home calendar and customer booking. Preserve unsaved edits, stale writes and existing 1/5/25 worker and 1/1/5 account limits, including beta/admin exceptions.
5. **Customer reminders (package 6):** integrate the existing source after execution is settled; its three migrations are not present in the current beta ledger. Run full-chain PostgreSQL concurrency, service-role, cancellation/reschedule, consent/STOP, quota, recipient-change and uncertain-delivery checks. Invoice reminders remain email-only. Defaults/limits are not authority to enable sending. Keep appointment/customer reminders distinct from internal follow-ups.
6. **Fin (package 7):** reconcile this preliminary guide again after execution/reminders are integrated. Keep unavailable actions as truthful screen handoffs, role-filtered context and reviewed mutations. No model-provider calls or configured-model change is certified here.
7. **Private-beta promotion:** only after relevant CI, schema, approval and rollback checks; re-fetch branch heads/aliases immediately beforehand. Keep real-provider/device, tenant-security, capacity and public-launch gates open until separately evidenced.

## Validation and limits

See `docs/evidence/2026-11-09-integration-baseline.json` for read-only inventories, `docs/evidence/2026-11-09-integration-schema-contracts.json` for SQL fingerprints, and `docs/evidence/2026-11-09-integration-validation.json` for test commands/results and source fingerprints. Local SQL tests use PGlite and controlled synthetic fixtures, not the full hosted schema or genuine provider accounts. DOM tests mock provider boundaries. PDF visual checks are local renders, not physical printer/device acceptance.

Chromium was attempted and failed before launch with `process_singleton_posix.cc: socket() failed: Operation not permitted`. The shared preview daemon was already occupied, so this review did not stop or replace another session's preview. No browser/layout or phone acceptance is claimed. No security/sandbox bypass was attempted.

## Rollback

This candidate has no live effect. Abandoning it leaves the release/domain/backend intact. Restore the review branch through ordinary reviewed Git changes; do not force-push the release or remove the deployment guard to test it. A later release should prepare a compatible frontend/Edge rollback to the exact preceding deployment; stored issued PDFs stay immutable. Already-applied Job Execution SQL is preexisting state and must not be destructively removed as this candidate's rollback. No new recurring service, purchase, cost commitment, real message, charge, refund or live purge was performed.
