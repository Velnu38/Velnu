# November 10 implementation and acceptance tracker

Source: `Finviant_Prioritized_Implementation_Prompts(4).pdf`, 28 work packages.
This table complements `docs/launch-readiness.json`; it does not replace the canonical acceptance registry or mark partial work complete.

The user authorized continued implementation, testing and deployment on November 10. Deployment remains to the existing private beta. The attachment explicitly retains separate approval for paid services, real recipients/charges, commercial and retention policies, public cutover and deferred products. Browser emulation is not physical-device acceptance.

## Current release boundary

The last verified domain release before this batch was `bd70eef70b4ee09eafd387843df417a34cbbf02d`, Vercel preview `dpl_GskVn9r863C93pax4hTb7YhRocDM`. It includes the integrated document stationery, manager availability, Fin guide and manager Job Management releases. Beta database: `xvybcmyoblfgzokaifsx`. The separate production project is not the target.

PR72 adds full migration replay and a combined release check. PR73's missing-suite rejection is merged into PR72. PR74 integrates the existing reminder branch with Job Management and adds mandatory full-schema concurrent reminder tests. PR72 is now deployed as merge 045c697e718ef1116b86774b996ffd2ea5259c1e (Vercel dpl_9fbaX5ymTMd8YbQsz5RqandyWZ8r), with both domain aliases verified. PR74 and PR75 passed all triggered workflows and are deployed; latest verified merge is 54ccfe796e12f6f15f48dca4f5eb2d0e312e1931, deployment dpl_4ZYJdcWfYQvL4oW97b7PUZ44owx1 on both domains. Reminder worker v13 and Fin v15 match prepared source. Outlook sync recovered at 13:36 UTC with an empty queue. PR75 includes the calendar grant repair and 23-policy identity optimization. PR76 deployed expanded service-only worker health. PR77 deployed customer PO references, reusable service packages and all ten shared PDF entrypoints. Latest verified domain merge is 755bdd6282d4fb3808b710ffcefdd29f11f503fe at dpl_33X8Zqx9KwM7ystfJH1sSsJXpe6r. Exact receipts are in docs/evidence/2026-11-10-health-document-rollout.json. PR78 passed every final workflow and deployed as e8696e1f368b7ed8d73fc52306566b45e65f3434 at dpl_4Nd8y54yVqPCeLU3cmMJMNr9CK5z on both domains; Fin v16 matches all eight prepared source files.

| # | Work package | Implementation / current evidence | Acceptance or implementation still required |
| --- | --- | --- | --- |
| 1 | Release baseline | Document, availability, Fin and Job Management sources reconciled; reminder source integrated in PR74; applied Job SQL recovered by statement hash | Reminders and following updates deployed; keep subsequent frontend/backend receipts synchronized |
| 2 | Release validation | Full desktop/mobile, DOM, financial/security, Deno and PostgreSQL replay jobs; required eight-suite aggregate fails on absent/failed/skipped results | Final candidate green; required-check enforcement and staged promotion settings |
| 3 | Documents | Approved stationery and shared rendering deployed; zero-tax omission and immutable issued artifacts preserved | Final integrated link/attachment/device acceptance; controlled real delivery |
| 4 | Job Management | Manager-operated visits, tasks, crews, reviewed costs/time and completion reports deployed; field self-service excluded from UI | Genuine tenant sessions and complete device/provider estimate-to-final-invoice journey |
| 5 | Availability | Manager weekly hours, eight-week exceptions/calendar, stale-write protection and roster/seat limits integrated | Final integrated physical-device and booking-conflict acceptance |
| 6 | Customer reminders | PR74: owner defaults, invoice overrides, 48-hour appointment overrides, consent/STOP and single-attempt queue | Full-chain concurrency CI, three migrations and worker/frontend deployment passed; controlled provider sends remain unverified and defaults stay off |
| 7 | Fin guidance | Product guide deployed; PR74 adds actual reminder settings navigation and limitations | Updated reminder guide deployed; bounded typed/voice provider evaluation and user pilot remain |
| 8 | Tenant/security | Fresh review finds no private table directly readable by anon/authenticated; new reminder tests deny unrelated identity and worker RPC access | Three genuine local sessions/private Storage checks pass; broader hosted tenant/role/session/token matrix and independent acceptance remain |
| 9 | Auth/recovery | Existing password/session/onboarding fixes and automated access tests retained | Auth configuration, branded SMTP/domain ownership, real recovery/invitation/MFA and physical-device acceptance |
| 10 | Abuse controls | Shared account/business/global burst guards and atomic first-attempt reservations prepared; 92 focused and 72 recovery tests pass | Final candidate concurrency replay/deployment; public reads/IP/signup/sends and dollar ceilings |
| 11 | Monitoring | Expanded calendar/reminder/recurring aggregate health deployed in PR76, with service-only failure/recovery checks and complete replay passing | External alert configuration/approved destination and proven controlled incident delivery |
| 12 | Workers | Existing idempotency/leases; reminder concurrency test adds changed-recipient, competing-claim and uncertain-send coverage | Complete calendar/recurrence/payment recovery matrix, queue-age visibility and reconciliation procedures |
| 13 | Backup/restore | Actual synthetic data/private-object restore drill prepared for mandatory CI; local safety guards pass | Restore execution evidence; hosted backup inventory, full environment recovery and approved production RPO/RTO |
| 14 | Performance/capacity | 23-policy identity optimization tested and deployed with PR75; 50 unindexed FKs still require query review | Representative query plans/tuning, 300-tenant 10/50/100-user load and 60-minute isolated soak |
| 15 | Email/SMS | Three beta email accounts active; zero active SMS accounts observed; beta restrictions retained | Domain/sender registration, approved recipients, controlled delivery/callback and suppression acceptance |
| 16 | Google/Outlook | Missing visit_worker_ids grant repaired; actual Outlook sync recovered and queue cleared | Google client configuration absent from hosting metadata; owner consent, refresh/reconnect/revoke and external-event conflict semantics |
| 17 | Stripe/Square | Existing provider implementations retained; Square phone action is native app handoff | Controlled merchant sandbox and physical-device payment/refund certification, signed event/reconciliation matrix |
| 18 | Processing fees | Saved preference remains separate from collection; collection disabled | Qualified provider/legal determinations and supported-rail eligibility/caps/disclosures/refund acceptance |
| 19 | Financial/document gaps | Receivables, aging, cash drilldowns, statement PDF, copy/search and expense rebilling already built | PO/reference fields and reusable service packages tested and deployed with PR77; final financial/device acceptance remains; historical statements require opening-balance design |
| 20 | Recurrence/progress | Existing recurring drafts, visits and cost review retained | Selected skip/pause/reschedule exceptions and progress/final allocations; no automatic customer charging |
| 21 | AI/OCR/QuickBooks | Reviewed actions, manual fallbacks and provider guards implemented | Authorized model/voice/OCR and controlled-company QuickBooks evaluations; measured user pilot |
| 22 | Commercial lifecycle | Existing beta grants/entitlements preserved | Confirm proposed prices/trial/Free/Fin limits; signed-event billing lifecycle and test-mode acceptance; platform fee remains inactive |
| 23 | Complete export | Customer CSV/vCard and service exports exist | Full owner archive with all records/files, manifest/integrity, >50,000 rows, interrupted exports and seven-day expiry |
| 24 | Retention | Live purge remains disabled | Confirm policy after export; dry-run deadlines/holds/exemptions/races/deletion ledger and isolated tests |
| 25 | Economics/support | Safe beta usage baseline and owner-review support/privacy/incident/refund procedures drafted | Actual provider/support costs, full-use margins, staffing/policy approval and exercised escalation |
| 26 | Devices/cutover | CI runs Chromium and iPhone WebKit simulation; private-beta boundary preserved | Actual iPhone/Android journey, isolated cutover rehearsal and exact public-launch approval |
| 27 | Historical import | Optional, unselected | Select a source/mapping only if still needed; versioned dry-run/duplicate/rollback design |
| 28 | Deferred products | Ranked feasibility/license/cost review recommends validating one original download concept; no new product built | Owner scope selection, demand interviews and measured economics; separate build approval |

## Deployment sequence and rollback

1. Require the complete PR72 and PR74 checks to pass on their final source. Investigate failures without deleting assertions or treating a retry as a fix.
2. Apply only the three new reminder migrations after verifying their absence by name/source; do not replay historical or already-applied Job SQL against beta. Migrations are additive and preserve saved enablement/custom rules.
3. Deploy the prepared `tier-delivery-worker` and `fin-workflow` packages with their existing authentication modes. Compare returned deployed sources to the prepared bytes. Retain previous versions/source for rollback.
4. Merge the reviewed frontend into the existing beta branch; verify the build's exact Git SHA and both domain aliases. Verify no fixture harness is exposed and unauthorized worker access remains denied.
5. Verify default-off reminder rules and queue counts without enabling sending or consuming provider budgets. Record safe aggregates and immutable receipts in the canonical registry.
6. For rollback, restore the prior compatible frontend/Edge versions; keep the additive tables and saved preferences. Do not drop issued artifacts, rewrite ambiguous sending outcomes, or remove the private-beta gate.

## External acceptance inputs

These are required for their specific acceptance tests, rather than reasons to stop independent engineering: approved controlled email/SMS recipients and usage budget; merchant sandbox/account and bounded charge/refund steps; Google OAuth ownership/consent; dedicated Auth sender/domain and emergency MFA recovery; monitored recipient and any paid service budget; approved commercial/fee/retention terms; physical iPhone/Android access; exact public-cutover authorization.

No claim that all 28 packages are complete, tested or deployed is supported by this tracker.
