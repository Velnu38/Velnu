# Jobs / Job Management

The existing Jobs entry now contains two tabs. Jobs defaults to the current directory and retains its List, Board, Overview, timing/worker filters, pagination, reminders, details and history. Each record has Manage, which opens the same record in Job Management. Returning preserves the directory search/filter/page state. The last chosen job ID is remembered within a browser session and business/permission/customer scope.

Job Management has a searchable, paginated approved/active/history queue, actionable operational counts, a selected-job workspace and responsive phone navigation. Only the selected job loads full work-plan/cost/visit histories; queue signals use bounded batches of at most 200 authorized job IDs.

Implemented behavior:

- Tasks: add, edit, assign a worker, set a due date and priority, complete/reopen, remove, save a reusable shared checklist and apply it once across retries. Templates copy unfinished steps without assignments/dates. Shared template creation/removal is office-only. Worker profiles do not grant logins or notifications.
- Materials: server-persisted quantity/unit/supplier, Needed/Ordered/Received/Used status, optional finance-authorized estimated total cost, optimistic updates, removal and audit history. Planning material estimates do not create expenses or customer charges. Actual purchases remain one reviewed expense.
- Schedule & Crew: existing guarded scheduling and crew commands; customer booking options retain their existing Pro entitlement and approval/sending controls. Finish visit closes only the matching past/current appointment, keeps the same job open, retains history and permits the next visit to be booked. This is sequential multi-visit support, not multiple simultaneously planned future appointments or per-visit crews.
- Photos & Expenses: existing private upload/capture/review, receipt scanning allowances, expense editing and storage permissions are reused against the same job. Existing provider activation requirements remain.
- Changes: select the approved estimate or a linked invoice, view all job-linked changes and open the existing reviewed change-order/billing workflow in context. Pending and unbilled approved changes are surfaced. No pending change overwrites approved scope.
- Billing: linked deposit/final/draft/void documents, issued invoice balance, approved scope from the existing change-context function, actual expenses/labor, budgets, time entries and provisional contribution. Draft balances and planning costs remain separate from money owed or actual expenses.
- Completion: review unfinished tasks/materials/pending and unbilled changes plus missing-cost warnings; explicit acknowledgement permits completion with unfinished work. The reviewed data is checked again before the existing completion command. No invoice is sent or payment marked received. Cancel/reopen, legacy details/reminders and source links remain available.
- Activity: existing persistent history with actor labels, exposing the latest 50 entries in this workspace. Earlier database events remain stored.

New estimate approval creates exactly one unscheduled job with customer, service address and approved scope. Legacy unlinked approved work is visible and explicitly prepared through an idempotent command. Existing manual/customer booking commands reuse this record; Home scheduling attention remains until an actual appointment exists. Approval does not book, message, grant access or mark payment.

## Validation

See `docs/evidence/2026-11-09-job-management-validation.json`. Operations: 23 checks; scheduling: 72 at bounded runner concurrency; records: 21; startup/build: 56. Five retained overview DOM scenarios, five management DOM scenarios and existing component journeys passed. Current TypeScript/Vite build passes.

Shared Chromium inspected desktop and the 390px synthetic phone fixture. Phone content had no horizontal overflow; material name, quantity, unit and Received status saved and visibly appeared. This is not physical iPhone or real-provider acceptance.

All three migrations are additive on the existing staging/private-beta project. Live rollback verification passed task/material persistence, template replay suppression, signals, unknown-user denial and approval-to-one-unscheduled-job creation. Follow-up queries confirmed zero remaining test jobs/templates. Three private tables have RLS and deny direct anonymous/authenticated reads; six new public wrappers are invokers and deny anonymous execution. Security warning counts did not increase. Both new composite foreign keys received covering indexes.

No new paid service, subscription, public launch or production-backend promotion is introduced. Existing hosting/storage/messages/provider usage remains metered. JOB-01/JOB-02 retain their larger roadmap scope; JOB-05 records physical-device and authorized live workflow acceptance rather than calling those checks complete.
