# Job Management execution phase — prepared for private beta

Status: implemented and locally tested on `feature/job-execution-20261109`; **not deployed**. The three database migrations remain unapplied. The first approval expired and the next request was canceled. Follow-up checks confirmed the new visit column, field RPC and report RPC are absent. The existing beta branch/domain remain on the prior release.

## Resulting behavior

- **Jobs → Job Management → Schedule & Crew:** plan multiple future visits on the same job with separate crew, title, times and task association. Appointments remain the calendar source; the job caches its next active visit. Editing or canceling one visit preserves others. Availability checks include later visits, worker hours, time off and other jobs. Closed visit history is retained. Completing a whole job cannot silently complete future visits.
- **Team Management → Account Access → Assigned-job access:** explicitly link an accepted field staff account to a worker profile, using an existing Pro seat. New field invitations start without broad module access. A linked user receives My jobs with scoped visits/checklist, time submission and private job photos. Financial data, unrelated customers/jobs, office modules and broader RPCs are denied at the server. Pause keeps the restriction in place; removing the account revokes membership. An explicit owner action can switch back to general staff access before editing the role/modules. Profile counts do not create logins or seats.
- **Job Management → Billing → Cost review:** review field hours before posting to the labor ledger with an internal rate snapshot. Repeated approvals post once. Correct a labor rate with version checks, identify similar time entries and missing rates, and exclude a duplicate expense from job costing with a recorded reason while preserving bookkeeping. Each expense uses one canonical job. Pending time and non-USD expenses are flagged separately from actual USD cost. Budget/planned materials never become actual purchases automatically.
- **Job Management → Completion Report:** after completing the job, save an immutable numbered snapshot of work performed, checklist, visits and up to 12 selected uploaded photos; download a professionally formatted PDF. Selected photos are retained so saved versions remain reproducible. Optional acknowledgement is typed in person on the business device with a server timestamp and capturing staff account; it is not a remote signature or payment authorization. Corrections create another version.
- **Calendar:** closing a visit in a multi-visit job closes that visit and retains the job/other visits. The existing single-visit invoice handoff remains available. Final multi-visit completion stays an office review action.

No new paid plugin, subscription, account seats, customer messages or payment charges are introduced. Existing database/storage/hosting/bandwidth usage remains metered. Existing Pro account access and worker-profile allowances remain distinct. Offline sync, routing/GPS, stock control, ERP and enterprise SLA features are not included.

## Verification

`docs/evidence/2026-11-09-job-execution-validation.json` records source hashes, exact commands and limits. The final execution suite passed eight SQL-backed journeys, PDF rendering/pagination and six DOM journeys; the existing seven management database cases and five DOM journeys passed. Scheduling (72), records (21), bounded-concurrency settings (116), TypeScript/Vite and startup (56) also passed. An earlier operations regression run passed 28 cases before three further execution cases were added and separately verified.

The SQL-connected case covers three visits, a deposit, an approved addition, actual time/expenses, completion and one final invoice across retries. Other cases cover server role/tenant/file checks, pause/revocation, stale edits, future crew conflicts, calendar projection/lifecycle, legacy same-time appointment repair, report version replay and photo retention. The actual linked-appointment lifecycle trigger is included in the execution fixture. These are local PostgreSQL-compatible tests and mocked DOM provider boundaries, not actual provider/device acceptance.

The synthetic PDF was rendered and inspected. Shared-browser preview access failed, and no browser-policy workaround was attempted. Physical iPhone, authenticated browser, real uploads, external calendar delivery and live payments remain unverified for this phase.

## Activation sequence

1. Approve and apply `20261109203232_planned_job_visits.sql`, `20261109203235_assigned_field_workspace.sql` and `20261109203238_job_cost_review_completion_reports.sql` to the current private-beta project, in that order.
2. Verify function grants/RLS, new foreign-key indexes, existing schedule caches, and a rolled-back synthetic workflow on the real schema. Review advisor deltas; retain unrelated existing warnings accurately.
3. Merge the review branch into `ux/private-testing-20261029`, verify its private-beta deployment/aliases/assets, and run signed-in owner versus restricted-field acceptance. Do not promote the older production backend or broaden audience.
4. Record actual migration/deployment/rollback receipts and keep physical-device/provider/load gates open until their acceptance evidence exists.

The frontend calls the new access-context RPC at sign-in; it must not be published to the active beta before the database functions exist.
