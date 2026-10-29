# Finviant Comprehensive Assessment Report

Assessment date: October 28, 2026 (America/New_York). Repository: `Velnu38/Velnu`. Working branch: `ux/professional-dashboard-20261028`. This report describes the code inspected, database checks, observed test outcomes and remaining release limitations. It does not certify that every possible defect has been eliminated.

## Campaign status — automatically updated by GitHub Actions

<!-- CAMPAIGN_STATUS_START -->
The infrastructure workflow is running as [GitHub campaign 40789573149](https://github.com/Velnu38/Velnu/actions/runs/40789573149). The verified local smoke run queried all 1,000 live Supabase profiles and completed 1,000 service checks with zero unexpected failures, including 360 expected validation rejections. It also made one live unauthenticated request to each of 12 deployed Edge Functions. The run lasted approximately 15 seconds; this is not an eight-hour result. See `STRESS_TEST_LOGS.json` for the exact measurements. GitHub Actions will replace this block after each four-hour phase.
<!-- CAMPAIGN_STATUS_END -->

## Readiness and business value

**Current recommendation: controlled private beta. Paid public launch remains blocked.** The strongest current value is a manual office workflow for small service businesses: customer and property records, jobs, scheduling, reminders, draft estimates/invoices, recorded payments, and separate manual/QuickBooks workbooks. Business owners can consolidate daily administrative work. The app does not yet provide a verified end-to-end subscription purchase or unrestricted public onboarding experience.

| Capability | Assessment | Commercial implication |
| --- | --- | --- |
| Customers and properties | Existing create/update/archive and tenant filters; synthetic special-character profiles included in QA | Useful foundation; browser rendering and authenticated tenant journeys require the browser/DB evidence described below |
| Jobs, calendar, reminders | Existing flows and date/window validation; financial service regression covers reminder retry behavior | Helps owners manage work; a general scheduling/dispatch platform is outside the current scope |
| Estimates, invoices, change orders | Atomic RPC-based creation, bounded line counts, server calculations and request IDs in source | Useful document workflow; private-beta quotas and entitlement restrictions still apply |
| Payments | Records money already received; validates amount and request retry | Does not charge a customer, move funds, or establish a paid subscription |
| Bookkeeping | Loads paginated local payments/manual entries and a separate QuickBooks import workbook | Cash record keeping; not a general ledger, payroll, tax filing or debt underwriting system |
| QuickBooks | Selected Payment, SalesReceipt and Purchase imports; bounded query pagination and incomplete-result warning | Requires a configured provider connection and live reconciliation before promising comprehensive accounting |
| AI/voice | Provider calls are gated, budgeted and require review for changes in source | Paid entitlement/provider delivery has not been established by this campaign |
| Email/online approvals | Server and UI release gates remain; signing/idempotency logic has regression coverage | Delivery and customer approval journeys are not proven by an HTTP 503 gate response |
| Plans and billing | Basic/Pro prices and allowances are explicitly proposed; no checkout/subscription activation path | Cannot yet sell an operational paid subscription through the app |
| Public access and production | Finviant domain is SSO protected and currently serves a review deployment connected to staging | External paying owners cannot use ordinary public onboarding yet |

The live domain's staging dependency and SSO should be resolved through an explicit production data migration and release cutover. Changing the environment variable alone could strand existing users/data. Enabling purchases requires checkout, verified billing events, entitlement state, cancellation/refund handling and reconciliation before paid allowances can be granted. These provider/account setup gaps are recorded as open items, not reported as implemented features.

## Findings and corrections

| ID | Severity | Finding / impact | Action and current status |
| --- | --- | --- | --- |
| F-01 | High | QuickBooks sync read only the first 100 records for each queried transaction type, risking incomplete totals | Fixed earlier in this review: bounded pagination to 1,000 provider query results; changing/inconsistent totals fail; over-cap results are marked incomplete. `supabase/functions/_shared/quickbooksQuery.ts`, `supabase/functions/quickbooks/index.ts`, `src/pages/BookkeepingPage.tsx` |
| F-02 | Medium | The claimed search-index exclusion header was absent from the deployed source | Fixed: `X-Robots-Tag: noindex, nofollow, noarchive` in `vercel.json`, with a deployment regression check. Header is not authentication |
| F-03 | Medium | QuickBooks callback configuration could use obsolete or cross-environment app overrides | Fixed earlier: callback routing uses the verified app environment allowlist. Staging/production backend identities remain distinct even when the verified app domain is shared |
| F-04 | Medium | Financial services assumed arrays and text fields were well typed; malformed payloads could throw incidental TypeErrors before useful validation | Fixed in this change: shared runtime checks for document records/items, numeric types, cent precision, bounds, descriptions and dates. Applied to invoices, estimates and change orders |
| F-05 | High | Workbook numeric conversion silently substituted zero for invalid stored amounts, risking a misleading financial summary | Fixed: strict numeric parsing fails visibly for null, malformed, non-finite or unsupported values. Dashboard totals now use the same parser |
| F-06 | Medium | Bookkeeping accepted numeric strings and JavaScript rollover dates such as February 30 | Fixed: strict number validation, exact calendar round-trip, direction/text checks, and amount bounds before a write |
| F-07 | Medium | Payment validation did not fully guard malformed runtime payloads, method values, oversized notes and server amount bounds | Fixed: explicit checks aligned with the server's positive amount ceiling and two-decimal rule |
| F-08 | Medium | Dashboard overdue date derived a date string through UTC conversion after using local midnight | Fixed to build the local calendar date directly, avoiding a previous-day date in positive UTC offsets. Business-timezone aggregation still merits further product work where users travel |
| F-09 | Medium | Voice draft extraction could retain huge numeric tokens beyond the document unit-price ceiling | Fixed: non-text commands fail clearly and extracted amounts above $10,000,000 require manual review instead of becoming a draft amount |
| F-10 | Low | Invalid plan identifiers or malformed assistant selections could return NaN or trigger runtime property errors | Fixed: reject invalid tier/selection shapes before proposed price math |
| F-11 | High / launch | No active subscription checkout or paid entitlement activation | Open commercial launch blocker; selection is an interest/preference and does not authorize charges |
| F-12 | High / launch | Public domain is protected by Vercel SSO and uses the staging backend | Open release blocker for ordinary paying customers; protection was preserved during assessment |
| F-13 | Medium | Supabase leaked-password protection is disabled | Open configuration warning; enabling it requires Auth settings access not exposed by the available Supabase operations. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection |
| F-14 | Evidence gap | Full authenticated live provider flows and all browser journeys are not established by the local runs | Browser job installed for independent infrastructure execution; no fabricated success for unavailable providers or blocked browser setup |

Corrections to frontend validation are defense in depth. Supabase constraints, authorization and RPC transactions remain authoritative; client-side checks cannot be the authorization boundary.

## Static security and financial logic review

The inspected source uses Supabase query builders and named RPC parameters rather than concatenating customer text into SQL. Dynamic SQL in the bootstrap uses fixed document/table choices, quoted identifiers (`%I`) and `USING` parameters. This did not reveal a confirmed SQL injection path in the inspected document/payment flows. Special characters, SQL-looking owner names and HTML-looking notes are retained as test data. Passing those values through a transport contract is not a browser XSS penetration test.

Financial source uses PostgreSQL numeric columns, per-line rounding, tax rounding and transaction-based document creation. The manual payment RPC locks invoices, rejects draft/void payments and overpayments, and compares retry IDs with existing records. JavaScript frontend checks reject fractional-cent input; a BigInt cents oracle in the runner checks document return contracts independently of binary floating-point arithmetic. Because the service transport simulates the database result, that oracle alone does not prove live PostgreSQL calculation correctness.

Static inspection found no frontend `eval`, `new Function`, `innerHTML` or `dangerouslySetInnerHTML` in the search performed. Ordinary React text rendering is used in the inspected components. This is a scoped source observation, not proof that every browser injection vector is absent. No service-role key or private provider credential was added to browser code or test fixtures. The QA target file contains only a public publishable key.

The environment build checks reject hosted preview/production project mismatches, privileged values exposed as public Vite variables, and staging customer-delivery activation. `noindex` complements the private preview but does not secure records. Earlier read-only inventory checks found RLS on all 29 existing public application tables, 90 public policies and fixed `search_path` on the inspected public security-definer functions. The new QA table also has RLS, intentional read-only synthetic access, and no browser INSERT/UPDATE/DELETE grants. Security-definer functions were inspected for execution grants; this does not replace an authenticated authorization test of every RPC.

The staging security advisor reports six informational RLS-with-no-policy findings for internal delivery/budget tables and QuickBooks credentials/OAuth tables. These represent default-deny browser access, not a reason to add permissive policies. The leaked-password warning remains open. The fresh transactional staging financial/RLS regression completed with 16 passing checks, including exact $233.64 line/tax totals, request idempotency, cross-tenant denial, negative/overprecision prices, overpayment rejection and role restrictions. Six additional actual database-role transcript isolation/forgery checks passed with disposable fixtures rolled back; zero test voice businesses remained afterward.

## Exactly 1,000 persisted mock profiles

Native Supabase queries verified the count and function distribution after seeding. Target: staging project `xvybcmyoblfgzokaifsx`. Table: `public.finviant_qa_profiles`. Dataset ID: `finviant-chaos-v1`. Profile identities and customer-like records are synthetic and use `example.invalid` email addresses. They are stored as JSONB in the isolated QA table, preserving wrong types and missing/null fields without corrupting live customer, invoice or business tables.

| Batch | Application function | Profiles | Primary checks |
| --- | --- | ---: | --- |
| 1 | `createInvoice` | 100 | Valid document RPC contract; null/missing items; bad types; negative price; excessive tax; impossible date |
| 2 | `createEstimate` | 100 | Estimate creation contract with the same diverse malformed/valid document boundaries |
| 3 | `createChangeOrder` | 100 | Existing customer/job contract, title, item limits and financial validation |
| 4 | `recordPayment` | 100 | Positive payment contract and clear rejection of missing payloads |
| 5 | `addManualEntry` | 100 | Expense creation contract, tenant attribution, date/amount handling and missing payload rejection |
| 6 | `listVelnuWorkbook` | 100 | More than 1,000 rows, complete paging, stable IDs and corrupted stored amounts |
| 7 | `listQuickBooksWorkbook` | 100 | Separate imported workbook pagination and corrupted amount rejection |
| 8 | `getDashboardSnapshot` | 100 | Exact totals contract, count handling and invalid aggregate amount rejection |
| 9 | `parseQuickInvoice` | 100 | Exact single-price extraction and refusal to turn refunds into a positive draft |
| 10 | `assistantMonthlyTotal` | 100 | Deduplicated proposed add-on pricing and invalid plan rejection |
| **Total** | **10 core functions** | **1,000** | **100 unique profile IDs per function** |

The financial contexts explicitly contain zero revenue, negative revenue, very large/exponential debt representations, nulls, strings in numeric positions, objects, arrays and booleans. Owner/customer fields include Unicode, apostrophes, emoji, SQL-like strings, HTML-like strings, missing email and internal notes. These contexts test input resilience; Finviant currently has no dedicated debt-to-income underwriting function, so the campaign does not claim to validate one. The alternative full generator supplies additional payment methods, amount boundaries, invalid dates, transport timeouts and missing-count variants.

`generate-profiles.mjs --write` provides the full generated fixture set and seeding SQL for inspection/reproduction. The current live dataset was seeded from its first batch plus the recorded staging expansion query; the exact live dataset hash is recorded in each campaign log. Every cycle reads live profiles. Failure to read exactly 1,000 records or exactly 100 per function fails the campaign rather than silently substituting local fixtures.

## Automated campaign and logs

The workflow is `.github/workflows/finviant-overnight-assessment.yml`. It launches on a push of the engine/workflow to this review branch and supports manual dispatch. Two sequential 14,400-second jobs provide at least 28,800 accumulated seconds of campaign time, subject to GitHub runner availability. GitHub-hosted individual jobs have a six-hour limit, so a single eight-hour job would be invalid. Source: https://docs.github.com/en/actions/reference/limits.

Each five-minute cycle queries the live QA table and executes the actual bundled application functions against an isolated transport. At campaign start, 12 deployed staging Edge Functions receive 100 unauthenticated/invalid-token probes each, bounded to one concurrent request and at most two requests per second. This is a controlled durability/input campaign rather than a peak-capacity or DDoS benchmark. No authenticated customer write, provider charge, paid AI operation or unsolicited email is generated.

API coverage includes `ai-command`, `execute-ai-action`, `create-approval-link`, `customer-approval`, `email-recovery-worker`, `reliability-health`, `send-document-email`, `send-invoice-email`, `transcribe-voice`, `resend-events`, `stripe-events` and `quickbooks`. The initial local live probe observed 401 for six auth-protected endpoints, 400 for customer approval without a valid token, 403 for QuickBooks and 503 for four unconfigured/gated operational or webhook endpoints. These responses establish rejection/configuration gates only; they do not prove authenticated handler behavior or provider success. Some rejections may be enforced by the Supabase gateway before the handler executes.

`STRESS_TEST_LOGS.json` records measured duration, phase/cycle timestamps, live dataset digest, per-function attempts, passes, failures, expected validation rejections, API response status counts and every unexpected exception observed by the runner. Failures include assertion, runtime, setup, timeout, transport and secret-response checks. The separate Playwright job exercises the existing browser flows with mocked Supabase responses, and the final publisher merges its runtime/assertion failures into the root JSON. Missing browser artifacts are recorded as an evidence gap/failure. The log retains errors instead of relabeling failed cases as passes. GitHub uploads both phase artifacts and publishes the root report/log after each phase.

## Completed checks before infrastructure soak

| Check | Verified result |
| --- | --- |
| Production build after validation fixes | Passed |
| Live profile count/distribution | Exactly 1,000; 100 per listed function |
| Live-profile service smoke | 1,000 passed; 0 unexpected failures; 360 expected rejections |
| Deployed API guard smoke | 12 real staging requests; expected rejection/configuration responses |
| Deployment environment/header tests | 22 passed |
| Financial service regressions | 25 passed |
| Recovery/provider/signature regressions | 56 passed, including generated malformed inputs and tampered signatures |
| Deno unit suite | 60 passed after final corrections, including 302 QuickBooks pagination/boundary inputs and high-value financial checks |
| Generated feature regression | 1,800 inputs passed |
| Dependency audit earlier in this review | 0 reported npm vulnerabilities; not a general security certification |
| Browser suite | Final GitHub Chrome run 40801505015: 95 passed, 0 failed, 0 skipped |
| Earlier workspace soak | Log ends at 22 successful cycles; no eight-hour completion record; excluded from an eight-hour claim |
| Fresh transactional live DB financial/RLS regression | 16 passed; synthetic fixtures rolled back |
| Live transcript database-role isolation / forgery regression | 6 passed; synthetic fixtures rolled back |

## Remaining release work and practical limits

1. Resolve production data ownership/migration, assign the correct production deployment/backend, and verify ordinary customer onboarding before changing SSO protection.
2. Implement and reconcile subscription checkout, verified billing events and server entitlements before collecting recurring fees or advertising active Basic/Pro allowances.
3. Verify the email sender and controlled inbox receipt, approval expiry/replay behavior, provider reconciliation and QuickBooks records against a live test company. Release gates must remain meaningful until those checks pass.
4. Enable compromised-password protection and verify backup/restore, operator alerts and incident response access. No restore drill or recovery-time guarantee was established here.
5. Review final browser/campaign artifacts. Resolve any observed failures and rerun the affected evidence paths. The runner can detect and report failures while unattended; it cannot autonomously implement an arbitrary fix without a new engineering execution.
6. Extend coverage to authenticated concurrent writes, tenant role matrices across every endpoint, assistive-technology/manual usability, localization/currency, real mobile devices and measured throughput/capacity. Current tests do not establish those claims.

Changes are on the review branch for traceability. Provider credentials, real customer data and production deployment exposure are not part of the seeded dataset. A completed eight-hour campaign with zero observed errors would support the tested paths only; the commercial launch blockers above still require resolution.

## Additional voice-to-invoice assessment requested October 28

The supplied voice-development history was checked against commit `bb65df2de023210f91aa2f9b67fa3d8782bd5f82` and successful [trial run 40706193494](https://github.com/Velnu38/Velnu/actions/runs/40706193494). The server-only storage change is present. The former gap in dedicated backend coverage is addressed by `supabase/functions/transcribe-voice/index_test.ts` and the new voice security workflow: **67 tests passed locally and in dedicated GitHub run 40790552675 with zero failures**, including 100 forged-tenant inputs, 100 entitlement edge cases and 100 simultaneous mocked quota requests. No OpenAI request or charge was made by those tests.

Confirmed fixes preflight secure storage before billable work, bound and time out request parsing, reject malformed business/entitlement values, require quota reservation proof, bound Supabase network requests and report uncertain storage outcomes accurately. Caller-supplied user IDs or transcripts cannot override verified storage fields. Live staging role checks confirm SELECT is granted while INSERT/UPDATE/DELETE are denied; six actual database-role tests verified own read, foreign read denial and forgery/update/delete denial, with all fixtures rolled back. The RLS predicate also requires accepted terms. Staging handler version 11 is ACTIVE with JWT verification preserved and returned 401 to an unauthenticated live request. Two genuine subscriber HTTP sessions are still required to complete the separate direct API isolation script; its current result is explicitly not_run. Activated-entitlement/provider reconciliation and physical mobile microphone/codec tests remain launch requirements from the October 27 report.

Detailed findings, the full coverage matrix, prerequisites and all supplied source links are in [docs/VOICE_BACKEND_ASSESSMENT_2026-10-28.md](docs/VOICE_BACKEND_ASSESSMENT_2026-10-28.md). The ongoing eight-hour campaign is [GitHub run 40789573149](https://github.com/Velnu38/Velnu/actions/runs/40789573149). It has started, and its final eight-hour result is pending.

## Browser regression triage

The first real Chrome diagnostic, [run 40790874259](https://github.com/Velnu38/Velnu/actions/runs/40790874259), failed because older tests sought a removed `Bookkeeping` navigation button after the dashboard redesign. It did not fail to load the application. The test helpers now follow the visible financial workbook button and combined Jobs & schedule tabs, retaining the underlying financial and permission assertions. The mobile fixture uses the current Financial performance label. Aggregate RPC mocks were also updated to match the service contract.

The review also confirmed a product navigation defect: Change Orders had been removed from the desktop sidebar and had no dashboard destination, leaving the existing page inaccessible there. Its desktop navigation entry was restored. The combined work hub and dashboard layout remain in place. A fresh browser diagnostic is configured to run these corrected flows; results are pending until the new workflow completes. Historic failures from the original campaign remain evidence for that original source revision and will not be relabeled as passes.

The original full browser run completed with **72 passed and 22 failed** at revision `e6eab2c`. The JSON artifact was inspected. Most failures used obsolete Bookkeeping, Company settings, Jobs/Schedule, or mobile Locations navigation selectors; those flows now follow current visible controls. The old aggregate-value assertion also exposed lost visibility of outstanding receivables after the dashboard redesign. The Invoices tile now shows the existing tenant-scoped open count and outstanding amount for office/owner roles, and the test still verifies the $125.00 balance plus aggregate RPC scope. No tests or assertions were removed to claim a pass; the latest full diagnostic result remains pending.

A separate boundary probe reproduced a mathematical validation defect: binary multiplication noise caused legitimate two-decimal amounts such as $8,388,913.46 to fail the old fixed epsilon check. Shared frontend validation now checks the canonical cent round-trip, matching strict server precision. Four new unit tests include 1,000 generated high-value cent inputs and reject noncanonical fractional cents, malformed data and rollover dates. Those tests passed; financial service regressions were rerun after this correction.

The follow-up Chrome run at `fd4e916` completed all 94 cases: **93 passed, one failed**. Its remaining failure identified a real mobile accessibility mismatch: a decorative gear was included in the Settings menu button's accessible name. Mobile menu buttons now have explicit text labels and decorative icons are hidden from assistive technology. The final full browser rerun passed all 94 tests with none skipped. The native transcript role test also verified all six isolation/forgery checks after agreement-complete disposable fixture setup; this does not require OpenAI access.

## Latest verified correction results

The full [Chrome browser run 40799543355](https://github.com/Velnu38/Velnu/actions/runs/40799543355) completed **94 passed, zero failed, zero skipped** at revision `a5d1571`. The compact test receipt is [docs/evidence/browser-regression-passed.json](docs/evidence/browser-regression-passed.json). The original 22 failures and the intermediate one-failure run remain historical findings for their respective earlier revisions.

After the final financial-range correction, a fresh live-dataset service smoke completed **1,000 passed, zero failed** and the unit/financial suites completed **59 and 25 passed** respectively. See [docs/evidence/final-service-smoke.json](docs/evidence/final-service-smoke.json); it records the actual dataset digest and a hash of the validation source used. This is a one-pass validation result, not eight hours of execution of the final revision.

Extreme aggregate document totals now have an explicit **$1 trillion supported ceiling**, checked with BigInt cents in the frontend and validated CHECK constraints on staging invoices, estimates and change orders. Existing records were confirmed within the ceiling before applying the migration, and all three constraints were verified validated. Reporting rejects amounts outside that supported range rather than converting them through unsafe JavaScript number precision. The product migration is `supabase/migrations/20261029012001_guard_document_supported_financial_totals.sql`; it has been applied to staging only. Production requires the recorded migration during release cutover.

The corrected frontend was built successfully. Both Finviant domains were verified pointing at the ready review deployment, with no alias protection bypass, and a public request still redirected to Vercel SSO. The final financial-range source update was independently browser verified by run 40800202503: 94 passed, zero failed, zero skipped. The eight-hour campaign continues against its original pinned source revision and live staging services; later corrections have their own test receipts. It cannot establish eight hours on every later code revision.

Final verification: [GitHub Chrome run 40800202503](https://github.com/Velnu38/Velnu/actions/runs/40800202503) passed all **94 tests with no skipped tests** at final functional revision `6402308b9db4f0a2fddebae04e51b1138ebdd143`. The committed compact browser receipt now refers to that final revision, including the financial range guard. The ready Vercel deployment for this revision is `dpl_XxkRcwbKzXn95fPVaL5UuXxLfywt`. Final functional changes are verified separately from the continuing eight-hour campaign and its original source revision.

Final rounding review additionally confirmed that old draft previews summed unrounded line amounts, while the server rounds each line and its tax before summing. Invoice, estimate and change-order previews now share exact-cent rounding and show a validation prompt for invalid line values. Live PostgreSQL golden queries returned $0.04 for two $0.015 lines and $0.02 for $0.01 plus a half-cent tax; the new unit regression matches those values. A dedicated browser case verifies the fractional-line preview and draft return contract without weakening existing assertions. The expanded 95-case browser run passed with zero failures and no skipped tests at the final rounding-corrected revision.

## Final functional verification and delivery state

The final functional revision is **`66b5cbc4669bfd54ce11ae7ff144b7c9aec2ee39`**. [GitHub browser run 40801505015](https://github.com/Velnu38/Velnu/actions/runs/40801505015) completed **95 passed, zero failed, zero skipped**, including the fractional-line rounding regression. The committed browser receipt now records that revision. The final unit suite has **60 passing tests**, and the final live-profile service smoke has **1,000 passing checks**. Voice backend coverage remains **67 passing tests**, with **six verified native subscriber-role transcript isolation/forgery checks** and **16 verified native financial/RLS checks**. These results supersede earlier pending statements for functional verification while retaining the earlier failures as history.

The ready final frontend deployment is **`dpl_BXkwHV6dq1FjjoQAF2y2JvrNi1k8`** and both Finviant domains were assigned to it. Staging transcription remains ACTIVE at version 11 with JWT verification. The complete assessment and the initial measured log are committed at the repository root on the review branch. The eight-hour infrastructure campaign **40789573149 is still running** and publishes measured logs/report status after each four-hour phase. Hourly supervision is scheduled through the overnight window to investigate new failures and recover failed publication; the final report delivery remains October 29 at **07:30 America/New_York**.

The campaign is pinned to its original source revision. Its historical 22 browser failures must remain in the final campaign log even though the corrected functional source now passes all 95 browser tests. A later code correction is not represented as eight hours of testing of that later revision. The report's commercial launch blockers and real-device/credential prerequisites remain open and explicit.
