# Manager Job Management execution release

The user approved activation of the prepared implementation. The three execution migrations and access hardening are applied to the existing private-beta schema and have passed a real-schema, rolled-back acceptance workflow. This release integrates the newer beta at `b2fe20c` and preserves its stationery, issued PDF, availability, Fin guidance, plan and private-beta boundaries.

The current owner roster direction takes priority: workers do not need accounts, invitations or notifications. The employee self-service pages/controls and mandatory sign-in context RPC are excluded. Their original source remains recoverable at PR69's original `373fba6` commit. Existing account management remains unchanged. No employee field account is activated by this release.

## Manager workflows

- **Jobs → Job Management → Schedule & Crew:** plan multiple future visits with their own title, times, crew and associated tasks on the same job. Editing/canceling one visit retains the rest. Appointments remain the calendar source; the job caches its next active visit. Finishing a visit preserves the job for remaining work; whole-job completion cannot silently finish future visits. Single-visit legacy scheduling and the existing invoice handoff remain supported.
- **Tasks:** associate a checklist step with a visit or the whole job, retaining worker, priority, date, templates and optimistic updates.
- **Billing → Cost review:** managers retain manual time/rate entry and budgets, can correct cost rates and exclude a duplicate cost with a reason while keeping the bookkeeping transaction. One canonical job receives each expense. Missing rates, unsupported currencies and historical unreviewed submissions are distinguished from actual USD costs. Planning materials do not become actual purchases automatically.
- **Completion Report:** after completing a job, publish an immutable numbered record of work performed, checklist, visits and up to twelve selected uploaded job photos. Download its PDF. Optional acknowledgement is typed in person on the business device with a server timestamp and capturing staff account; it does not authorize payment. Corrections produce another version and selected photos are retained.

The original Jobs directory, Overview, Board, approved-job handoff, customers/sites, documents, change orders, deposits, account limits and source links remain. No automatic send/payment, paid plugin, additional account seat, new provider activation or production-backend promotion is introduced. Existing storage/database/hosting usage remains metered.

## Verification and schema history

The receipt at `docs/evidence/2026-11-09-job-execution-validation.json` records exact scope, source hashes and limitations. The final selected manager source passes eight SQL-backed execution cases, PDF rendering/pagination and four DOM journeys; the existing seven management database cases and five DOM journeys pass. TypeScript/Vite and the newer 58 startup checks pass.

`tests/operations/job-execution-live-rollback.sql` uses synthetic records and existing authorized test identities against the migrated beta. It verifies approval to one linked job/site, three visits and calendar records, independent crews and conflicts, protected backend field/unknown-actor access, time replay/office posting, expense exclusion/restore, cancellation/reschedule/visit completion, approved change plus deposit credit, one final invoice across retries and immutable report replay. The final approved scope is $125, deposit credit $30 and final balance $95. It makes no auth user, Storage object, customer message or provider charge; every fixture and permission mapping rolls back. Follow-up checks found zero retained fixtures.

The public RPCs are invokers, deny anonymous execution and use private implementations with current membership checks; the five private tables have RLS and deny direct reads. The calendar view remains an invoker. Covering indexes address new foreign keys. Security warning counts returned to the prior baseline; optional consolidation of separate staff/field policies was canceled, confirmed unapplied and excluded. Existing permissive-policy performance notices and broader load/replay gates remain recorded.

Canonical source filenames use the actual hosted ledger versions: `20261110002708_planned_job_visits.sql`, `20261110002741_assigned_field_workspace.sql`, `20261110002751_job_cost_review_completion_reports.sql`, and `20261110003505_job_execution_access_hardening.sql`. Their statement MD5 fingerprints match the hosted ledger. This is source alignment only: no ledger row was edited and no applied migration was retried to force timestamp equality.

Shared Chrome inspected the 390px fixture and native date input; a future visit with its own crew saved and appeared as a second open visit. PDF layout was rendered and inspected. These checks are synthetic. Authenticated real-tenant browser sessions, physical iPhone camera/touch, actual uploads/calendar delivery/payments, two-tenant browser sessions and measured concurrency/capacity remain open. No new provider or physical-device certification is claimed.

## Activated private beta

PR69 merged as `c3dcddaaf650784f2ce59b15f6e7972b98b1f592` with the exact tree tested at `36fcf3599c18741567b7a414003a2d1b7ed6b3f8`. All seven final PR workflows passed, including the complete 535-case TypeScript/SQL/PDF suite, desktop browser groups, four simulated iPhone Safari groups and all DOM checks. The long Safari PDF/history journey retained every interaction/assertion and passed in 35 seconds with a scoped 60-second total budget.

READY deployment `dpl_FE8NoHpgBrpnjVUYvkY34dSmXKCj` serves both `finviant.com` and `www.finviant.com` on the existing private-beta branch and beta backend. On 2026-11-10T07:47:40.802Z, `/?view=work` and its entry, App and Jobs assets returned HTTP 200. The live Jobs chunk contains visit planning, cost review and completion reports, with PDF generation lazy-loaded. Employee self-service chunks are absent. HTML retains private no-store caching and noindex; shared Chrome observed the sign-in boundary, not an authenticated tenant session.

This is activation of the manager UI and verified database workflow. Signed-in real-account, physical-device, actual upload/provider and load acceptance remain open. The separate QA and older production backend were not promoted. Restore the preceding compatible frontend at `b2fe20c` / `dpl_FR471eC4y8xzy3PQGiSDBytcJFiq` if required; do not remove applied SQL or rewrite its ledger.
