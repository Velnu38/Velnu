# November 10 implementation and acceptance tracker

Source: `Finviant_Prioritized_Implementation_Prompts(4).pdf`, 28 work packages.
This table complements `docs/launch-readiness.json`; it does not replace the canonical acceptance registry or mark partial work complete.

The user authorized continued implementation, testing and deployment on November 10. Deployment remains to the existing private beta. The attachment explicitly retains separate approval for paid services, real recipients/charges, commercial and retention policies, public cutover and deferred products. Browser emulation is not physical-device acceptance.

## Current release boundary

Latest verified beta release: f82f9901daf3c21edf6e37efd57cae4b9bc249a7, READY deployment dpl_T6DBB47cN9wWv1R3F5r7m2tEurCD on both domains. Its five triggered CI workflows passed. The existing source includes integrated document stationery, manager availability, Jobs execution, reminders, archive exports, bounded directories, queue tuning and isolated capacity/concurrency checks. Exact prior receipts remain in docs/evidence; they are not replaced by this summary. Beta backend remains xvybcmyoblfgzokaifsx; the separate production project is not the target.

Step 15: the owner confirmed receiving the three controlled invoice/estimate/card emails. Their signed callbacks and canonical PDF/card-link checks passed within included allowance; managed Twilio SMS remains inactive without a configured sender/reply route. Step 16 now adds bounded calendar listing, correct Outlook throttling delays and explicit external-calendar booking limitations. The candidate requires complete CI and beta deployment before it is called released; see docs/CALENDAR_CONNECTION_ACCEPTANCE_2026-11-10.md.

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
| 15 | Email/SMS | Three controlled emails delivered once; owner receipt, signed callbacks and canonical PDF/card APIs verified; $0 incremental send cost | SMS sender/reply setup, phone attachment/contact-import and reply/Auth/broader suppression acceptance; beta restrictions retained |
| 16 | Google/Outlook | Outlook sync recovered with empty queue. Candidate fixes throttling and calendar-list loops; UI explains personal events do not block booking | Complete candidate CI/deployment; Google setup/consent and live separate-account refresh/reconnect/revoke/device certification |
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

Latest additional deployment: PR81 recurring owner controls and receipt-refresh stabilization passed all final checks and deployed as 18bab1b38bf3f15d05b4dc1a9e4d97084c0d23af at dpl_Htcp9Cot1hUNcRRqxPNQ9jq57Wur on both beta domains. PR82 passed all final checks and deployed bounded server Jobs paging as 7fd20458994aa18139d6380ed0fd5d4da30dbae3 at dpl_8GkFoTnnKhapyQzN3mM99dGYSmdB on both beta domains. PR83 owner archives and PR84 bounded Jobs Overview passed every final workflow and are deployed. Latest verified beta merge is b19f89f278eeed0bf09b32123cfaed83c47db565 at dpl_ABypKt34wEfTbirtodshytiNnz5Y. Exact database/Edge/domain receipts are in docs/evidence/2026-11-10-archive-overview-rollout.json. The 300-workspace isolated capacity harness is prepared next; Job Management and customer-picker scaling remain open. These are separate from approval-dependent provider, physical-device and commercial gates.

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
