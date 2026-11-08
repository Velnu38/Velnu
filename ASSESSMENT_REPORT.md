# Finviant Comprehensive Assessment Report


**Last updated: November 8, 2026 (UTC).** Every future change to this report must include a dated entry with completed work, evidence, unresolved limits and the next action. Preserve older entries as history. The current dated release entry supersedes conflicting historical status statements below.

## November 8, 2026 — E-Business Card implementation

- Verified the previous domain-bound release before editing: `1d4b7d30360c844401daaded26f2255bd57293e7`, Vercel `dpl_2igRSzsnct7KUN3mjBTHRZePg8Ye`, READY on finviant.com/www.finviant.com. The existing private-beta backend and recipient restrictions are retained.
- Added the approved two-column E-Business Card setup and contact preview in **Invoice & Estimate Setup**, with a stacked layout on phones. Business name, business phone/email, website and services/tagline begin with company profile details. Card-specific edits do not change invoice/estimate branding or issued documents. A business address is excluded by default and included in the exported contact only when explicitly selected.
- Business Pro exclusively includes one shared company card, unlimited `.vcf` downloads and device sharing. The primary owner edits; authorized account users with billing access may share the same card. This does not add employee cards, worker logins, a customer site or a public card page. Free/Individual see a sample with an underlined Explore Business Pro link. Existing plan prices, worker counts and account seats are unchanged.
- Saving and exporting are enforced on the server using business membership, current Pro entitlement, primary-owner edit permission and revision checks. Private storage has RLS and no direct client table access. vCard 3.0 escapes contact text, uses CRLF, folds Unicode safely, and preserves website URI punctuation. Downloads do not reserve messaging usage.
- Added direct E-Business Card email to the existing Resend outbox/claim/webhook pipeline. A reviewed saved revision becomes an immutable `.vcf` attachment; one recipient reserves one existing Pro email delivery (2,000/month shared). Repeated requests reuse the same send and reservation; unresolved sends are restored when the card reopens and block duplicate new operations. Beta recipient approval, sender activation and revoked-access/plan checks remain in effect.
- Updated the live landing-page Pro benefits, featured plan and comparison table, plus the in-app Plans & Usage comparison, to highlight customers saving the company in phone contacts. Marketing explains download forwarding and the direct-email allowance.
- Validation: production TypeScript/Vite build and 55 startup/deployment checks passed; 139 tier regressions passed before the final additional handler/beta cases, all 8 final card database/handler cases passed, 116 settings cases passed, and the new React DOM journey passed (tier links, owner save, privacy, native share, unsaved changes, retry identity and office read-only sharing). No customer emails or texts were sent in testing. The older broad browser-CI fixture issues remain recorded in VALUE-11 below; this release does not claim full browser CI or physical-phone certification.
- Backend verification: migration `20261108165736_e_business_card` applied to the existing beta backend; `send-business-card` ACTIVE v1 with JWT validation and its own session check. Live rollback-only checks passed for save/export privacy, exact email attachment, approved-recipient rejection, one quota reservation on retry, leased completion/activity and lower-tier denial. No persistent test card/message or provider send was created. Security advisors showed no new WARN/ERROR findings; the additional INFO is intentional RLS with no direct client table policy. Web release `19f1e245bae679b4007d83862dd6bb3ff1c85042` is READY in Vercel deployment `dpl_CCfEGhrWKUVFkrBCBdUmp1k2R5tr` on finviant.com and www.finviant.com. The live browser showed the new Pro benefit, plan inclusion, comparison row and direct-email/SMS limitation. All 69 scheduling regressions also passed.

### Remaining limitations / next actions (November 8, 2026)

- **CARD-01 — Direct card SMS:** not implemented. Plain SMS cannot carry a vCard attachment. Device sharing/download is available now; a future managed download-link or supported MMS implementation needs delivery, consent, access/expiry and SMS-segment tests before release. The UI and landing-page note this limitation.
- **CARD-02 — Real-device/provider acceptance:** validate iPhone and Android Add to Contacts and an explicitly authorized live-recipient email. Browser sharing depends on OS/app support and falls back to a downloaded file. Some email apps may require saving/importing the attachment. The recipient always confirms contact creation; Finviant cannot silently add or update contacts.
- Saved/downloaded copies can be forwarded indefinitely, including after the sender changes plans. Current Pro entitlement is required for further Finviant exports/edits/sends. Edits apply to future exports, not copies already in recipients’ contacts. Private beta direct email remains restricted to approved recipients; production email/SMS activation and merchant/calendar items remain as described in the earlier release entry.

## November 8, 2026 — Business Pro value, landing page and connected workflow release

### Release baseline and scope

- Baseline: `ux/private-testing-20261029`, commit `6a5af984b3744ebf8242a92bea17cbe02f4f4b16`; Vercel deployment `dpl_BmpNaJnWPpkJaBWPyjFLkuk8XjQv` READY and serving finviant.com and www.finviant.com. The finviant.com branch binding is correct; the old October branch-binding warning below is historical.
- The domain-bound release uses the existing private-beta/staging environment. This work does not switch backends, open public beta, activate paid subscriptions, broaden approved email recipients, or activate SMS/payment providers.
- Before edits, 221 database/handler regression checks passed across tier rules, scheduling, canonical PDF handoffs, approval handling and customer payment logic. This is test evidence, not a claim of a new live-provider certification.

### Implemented in this release

- Replaced the landing page with the approved Business Pro design: connected estimate/approval/scheduling/work/invoice/payment-tracking story, six-stage animated example, four interactive benefit scenes, worker roster example, pricing comparison, setup limitations and functional sign-in/account/workspace/legal destinations. Reduced-motion settings, pause/replay and offscreen/background pausing are supported. Examples are illustrative; they never create records or send messages.
- Kept Free $0, Individual $19.95/month, Business Pro $39.95/month and Pro $399.50/year as proposed public pricing. Private beta has no subscription charges.
- Individual now has 250 manually initiated managed email recipient deliveries/month after verified sender activation. Free retains personal-app sending. Pro retains 2,000 monthly email recipients, 200 US SMS segments, scheduled email, owner-enabled overdue invoice reminders and customer booking. The server still checks permissions, plan, sender readiness, reviewed PDF/revision and beta-recipient approval. Individual cannot claim queued Pro automation after a downgrade. Retrying the same reservation does not consume another allowance.
- Preserved five Individual internal worker profiles, 25 Pro profiles and five Pro account users including the owner. Worker profiles are internal assignment/availability records, not logins or worker notification accounts.
- Added customer CSV import alongside vCard/device contacts: First name, Last name, Company, Email and Phone; review before save, 8 MB/file, up to 2,000 contacts/file, batches of 100, duplicate skipping and retry-safe persistence. Company is retained. Addresses, notes and historical documents are not imported through this file format.
- Added owner customer CSV export and business-scoped saved service items. Saved descriptions, unit prices and tax rates can be reused in new/draft estimates, invoices and change orders. Quantity begins at one and remains reviewable. Removing a saved service never removes historical document lines. Service CSV export is available. Service permissions are enforced by database RLS and billing/write access, with explicit grants and numeric bounds.
- Added a read-only setup/readiness summary, links to resolve configuration, progress meters and near/full-allowance warnings in Plans & Usage. Email usage refreshes after sends and when the app returns to the foreground. Storage remains a separate non-resetting allowance. No automatic overage purchase is enabled.
- Added a connected Pro database journey covering customer booking, crew assignment, completion, exactly one draft invoice, retry safety, partial/full manual payments, dashboard balance and activity updates. Provider delivery is simulated in this journey; PDF/email provider contracts have separate tests.

### Current limitations and whether they prevent full tier use

| Item | Current position | Assessment / next action |
|---|---|---|
| Private beta access and approved recipients | Managed email is restricted to approved test recipients; ordinary customers cannot all receive beta email | **Blocks unrestricted business use.** Appropriate for private testing; not reasonable as a permanent paid-plan restriction. Complete public-release readiness and sender onboarding before charging for full use. |
| Managed SMS | Sender registration, activation, replies and consent must be verified; the current private release does not enable general SMS | **Prevents full Pro messaging use.** Preserve the explicit personal-app alternative; complete activation before advertising SMS as generally available. |
| Automatic invoice payment updates | Merchant connection and signed provider events must be verified; a payment-link click never marks an invoice paid | **Prevents a fully automatic payment journey.** Manual partial/full payment recording remains available. Finish controlled provider validation before enabling reconciliation. |
| Google Calendar | Provider project/OAuth setup is unfinished | **Blocks the advertised Google connection**, not Finviant's internal calendar. Complete Google setup and end-to-end connection/refresh/conflict tests. |
| Outlook Calendar | Existing server integration requires per-business authorization; operational status must be checked, not inferred from subscription | Verify the intended account, background sync and reconnect behavior before calling it universally ready. |
| Extra automatic follow-ups | Scheduled email and owner-enabled overdue invoice emails are supported; automatic estimate/appointment follow-ups and automatic dispatch of every recurring draft are not included | Add reviewed scheduling rules and suppression after customer response/payment. Do not describe these missing automations as active. |
| Dedicated customer site | Deferred by owner; no combined customer history portal | Keep on the to-do list. **Not required for the current end-to-end workflow:** professional document approval, booking and payment action pages can work independently. |
| Paid billing and overage purchases | Proposed prices/allowances; no active subscription checkout or automatic paid entitlement activation | **Commercial launch blocker.** Validate checkout, subscription events, entitlements, cancellation and quota behavior before paid public release. |
| Public reliability and support | Local/fixture checks do not establish load capacity, backup restoration, support response or physical-device voice performance | Complete staged operational checks; do not substitute marketing claims for measured results. |

### Allowance assessment — November 8, 2026

- **One-business scope:** The server currently permits one workspace per account. This is reasonable for the present single-business offer, but prevents managing multiple separate businesses under one login and must not be advertised otherwise.
- **Reasonable:** Free's 10 active customers and five new bookings/month provide a limited entry tier. Individual's five worker profiles preserve useful job-management value. New managed email improves Individual without requiring a price cut.
- **Needs usage monitoring:** Individual's 250 recipient deliveries are about eight/day averaged over a month. Pro's 2,000 email recipients are materially larger, but neither should be marketed as unlimited.
- **Potentially restrictive for busy Pro businesses:** 200 US SMS segments can be consumed by 50 jobs receiving four single-segment texts each; long or nonstandard-character messages can consume more segments. This is an illustration, not a universal message cost. Provide transparent usage and evaluate optional prepaid capacity or a larger included allowance after actual usage/cost measurement.
- **Do not imply 25 dispatch users:** 25 worker profiles plus five account users is suitable for owner/office planning, but not equivalent to 25 mobile employee accounts, payroll, GPS tracking or automatic worker notifications. Those are outside the current promised internal-roster scope.
- **Shared AI capacity:** Pro’s 600 requests are about 20/day across the business, and 180 voice minutes are about six/day. Heavy assistant use may reach these limits; manual entry remains available and paid top-ups are not active. Do not describe Fin as unlimited.
- **Bulk export boundary:** Customer and saved-service scans use the existing 50,000-record verification guard. Larger exports need a chunked/archive workflow (VALUE-09); this is a bulk retrieval boundary, not a monthly creation allowance.
- **Cost/allowance validation:** Confirm AI, voice, email and SMS unit costs and support demand before expanding allowances. There is no evidence here that the service has zero incremental cost or that a target margin is guaranteed.
- Do not reintroduce separate charges for core calendar, document or manual financial-record workflows as a prerequisite to finishing a Pro job.

### Dated follow-up backlog — added November 8, 2026

| ID | Work remaining | Reason / acceptance requirement |
|---|---|---|
| VALUE-01 | General customer email release | Verified business sender/reply handling, deliverability monitoring, public recipient policy and release approval; retain current beta restrictions meanwhile. |
| VALUE-02 | Activate and verify Pro SMS | Approved sender registration and reply/STOP handling, consent, signed callbacks, accurate segment usage and test receipts. |
| VALUE-03 | Verify merchant payments end to end | Controlled merchant setup, hosted checkout, signed events, partial/full payments and refund/reconciliation behavior; no false paid status. |
| VALUE-04 | Finish Google Calendar setup | Correct OAuth application, allowed redirects/scopes, user connection and background sync. |
| VALUE-05 | Broaden automation deliberately | Estimate/appointment reminders and recurring send rules, with owner control, retry safety and response/payment suppression. |
| VALUE-06 | Dedicated customer site | Owner-deferred enhancement; retain separate document action pages for current workflow. |
| VALUE-07 | Active paid subscriptions and optional capacity purchases | Verified billing/entitlements and explicit purchase confirmation; no silent overage charges. |
| VALUE-08 | Evaluate higher SMS allowance / top-ups | Measure real usage and unit economics; decide before claiming the allowance covers high-volume teams. |
| VALUE-11 | Modernize and rerun broader browser CI fixtures | Post-deployment CI passed the new tier/database/DOM checks, but the broader calendar job hit an old literal Mark Paid markup assertion and the pricing browser server failed its multi-entry fixture build. Existing browser fixtures also predate stored PDF previews and current Team Management labels. Update those fixtures and rerun the full authenticated browser suite; do not claim all CI is green. |
| VALUE-10 | Authentication password protection | Enable and recheck existing leaked-password protection in Supabase Dashboard; current connector does not expose this Auth setting. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection. |
| VALUE-09 | Expanded migration/export | Customer addresses, historical documents and a complete business archive are not covered by the new contact CSV and existing workbook/service exports. Define a versioned import/export format before implementing broader migration. |

### Verification and release outcome

- 228 tier/scheduling/payment/CSV regression checks passed with test concurrency limited to two. An earlier highly concurrent run had two test-process failures; the controlled rerun passed all checks. No failures were relabeled as successes.
- 55 deployment/startup checks passed as part of a complete TypeScript/Vite build. The build check caught a newly split landing stylesheet; its import was moved to the existing eager entry stylesheet so the earlier blank-screen prevention remains intact.
- Four CSV parser/export checks passed, including export/reimport of international phone numbers; three were also included in the 228-check regression run. Saved-service and Plans & Usage DOM checks passed for reuse, price/tax preservation, tenant-scoped save/archive, warning meters, provider status and refresh.
- Landing/auth/beta-gate DOM checks passed, including saved and stalled authentication. Mobile routing checks passed for Pro, Individual managed email, Free personal sending, pending-draft handling and explicit personal alternatives.
- The live registered-beta database migration `20261108155833_pro_value_workflow_release` was applied successfully; the source filename matches the recorded server migration version. The rollback-only smoke passed CSV company retention, catalog RLS, exact $105 totals, Individual's 250 allowance, canonical send claim, idempotent reservation and Pro automation exclusion. No email/provider dispatch occurred; all synthetic records and tier overrides were rolled back. The first smoke attempt hit the existing one-workspace-per-owner rule and was corrected to use a verified beta workspace inside the rollback transaction; an overly broad provider assertion was then narrowed to the synthetic request.
- Post-migration health advisor: no findings. Security advisor: no ERROR findings and no finding on the new service catalog or helper. Existing warnings include leaked-password protection, extension placement and intentionally callable authenticated functions; these are not new provider certifications.
- Browser preview verification was limited by a browser URL-policy rejection after local startup configuration was supplied. DOM, built-asset and native deployment checks are used here; a completed physical-device/live authenticated browser journey is not claimed.
- Release verified November 8, 2026: implementation commit `60178960093df04eb542aef894f73933b4219776`, Vercel deployment `dpl_D7PbRWDN7JunYckugeE2EKcGvaNp` READY, both finviant.com and www.finviant.com aliases assigned, Vercel status success. Public HTTP returned 200 and the served App chunk contains the new landing and Individual allowance. Subsequent report-only updates do not change application behavior. No production/provider success is inferred from passing isolated tests.
- Post-deployment CI review, November 8: the new remote tier/database/DOM checks, calendar/storage/deployment checks and production build checks passed. The broader CI runs are **not green**: an old financial test expects a literal payment button that now comes from the action policy; the legacy browser server fails its multi-entry fixture stylesheet assertions. Full local Settings checks also passed (116). VALUE-11 tracks fixture modernization and a complete browser rerun. These failures must remain visible rather than being presented as a certified full-browser release.

## Invoice handoff and overdue-only attention — November 3, 2026

Sent invoices qualify for Needs Attention only with a positive unpaid balance and a due date before the business calendar day. Invoice-first scheduling now carries customer/scope/site/crew into one linked job and calendar event through an atomic, authorized RPC. Uniform attention actions share color, typography and dimensions. See [the complete flow and minimum-input assessment](docs/LOW_FRICTION_DOCUMENT_WORKFLOW.md) for invoice-first, estimate-led, scheduling, completion and payment paths, plus the distinction between document attention and explicit reminders. Validation evidence and deployment are recorded in the change request and ongoing assessment.

## Professional interface audit — November 3, 2026

The interface pass adds one-click dashboard creation, inline job contacts, consistent native form dialogs, accessible icon names, mobile-safe input sizes, business-zone scheduling/follow-ups and direct document handoffs. The complete page disposition and individual control inventory are in [docs/PROFESSIONAL_WORKFLOW_AUDIT.md](docs/PROFESSIONAL_WORKFLOW_AUDIT.md). Source inventory: 70 TSX modules and 516 control definitions. Runtime/provider limitations are explicit; source coverage is not a claim that every provider action was clicked live. The full browser suite is enabled for the change request.


## Current private-testing state — October 29, 2026

This update supersedes earlier deployment and “pending” status statements in the historical chronology below. The current private-testing candidate is branch `ux/private-testing-20261029`, commit `e6295ea273b13a2b8ea5f993a5bfbc79a5133457`, deployed READY as `dpl_216nLhy51GT3qBoG24U33rH77Nax`. The candidate hides subscription prices/selection and presents a notice that test data may be reset or deleted. The campaign metrics below remain tied to the earlier source revision and must not be interpreted as an eight-hour soak of this candidate.

Both `finviant.com` and `www.finviant.com` are aliases on this candidate deployment. Vercel SSO protection is enabled for **all deployments**; project password protection is disabled. SSO is the current access gate. The `noindex` response header only discourages search indexing and does not restrict access. Keep SSO enabled while private testing continues.

**Operational issue to fix in Vercel:** both custom-domain records still have `gitBranch: feature/velnu-stage1`, although their aliases currently point to this private-testing deployment. Update each domain’s branch binding to `ux/private-testing-20261029` (or deliberately detach automatic branch binding while preserving the current aliases), then verify unauthenticated requests remain blocked and authorized testers can sign in. Otherwise a later deploy from the stale branch may replace the intended site.

The candidate still uses the staging Supabase project `xvybcmyoblfgzokaifsx`; the separate production project is not serving this candidate. This is intentional for owner-led private testing. No payment or entitlement system is active. Do not invite public beta users or switch off SSO until the production backend, recovery plan, and release gates below are addressed.

Original assessment date: October 28, 2026 (America/New_York). Report update: October 29, 2026. Repository: `Velnu38/Velnu`. Current candidate branch: `ux/private-testing-20261029`; the detailed campaign results below remain tied to the revisions and timestamps recorded in each historical section. This report describes the code inspected, database checks, observed test outcomes and remaining release limitations. It does not certify that every possible defect has been eliminated.

## Campaign status — automatically updated by GitHub Actions

<!-- CAMPAIGN_STATUS_START -->

Updated: 2026-10-29T07:46:57.367Z. Status: **completed_with_failures**. Verified accumulated campaign duration: **28803 seconds** of the required 28,800 seconds.

Profiles exercised: 96000; successful service checks: 96000; failures: 23; expected input rejections: 34560; live edge probes: 1211.

Workflow: https://github.com/Velnu38/Velnu/actions/runs/40789573149

The JSON log contains every observed unexpected exception and per-function counts. A nonzero failure count remains a finding and does not become a pass when a job finishes.

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
| F-12 | High / launch | Custom domains are protected by Vercel SSO; current private-test candidate uses the staging backend | Open public-release blocker; SSO and staging are intentionally retained during owner-led private testing |
| F-13 | Medium | Staging Supabase leaked-password protection is disabled (advisor rechecked October 29) | Open configuration warning; the available integration is read-only for this Auth setting. Enable it in Supabase Dashboard → Authentication → Settings → Password Security, then recheck the advisor. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection |
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

The following are public-beta/paid-launch gates. SSO and staging are intentionally retained for the owner-led private-test phase; do not treat these controls as defects to remove during private testing.

1. Before public beta, resolve production data ownership/migration, assign the correct production deployment/backend, and verify ordinary customer onboarding before changing SSO protection.
2. Before paid launch, implement and reconcile subscription checkout, verified billing events and server entitlements before collecting recurring fees or advertising active Basic/Pro allowances. Subscription information is hidden for current testing.
3. Verify the email sender and controlled inbox receipt, approval expiry/replay behavior, provider reconciliation and QuickBooks records against a live test company. Release gates must remain meaningful until those checks pass.
4. Enable compromised-password protection for staging (the Oct 29 security advisor still reports it disabled) and verify backup/restore, operator alerts and incident response access. No restore drill or recovery-time guarantee was established here. The available Supabase integration can inspect this warning but cannot change the Auth setting; an owner must enable it in Supabase Dashboard → Authentication → Settings → Password Security, then rerun the security advisor. The production advisor did not report this warning, which is not by itself proof that production configuration is correct.
5. The corrected browser suite passed 95/95, but the original campaign retains 22 browser failures from its pinned older revision and one Stripe guard-probe timeout. Keep those in historical evidence; investigate whether the timeout reproduces, and run a soak on the current private-testing revision before making any soak claim for it.
6. Extend coverage to authenticated concurrent writes, tenant role matrices across every endpoint, assistive-technology/manual usability, localization/currency, real mobile devices and measured throughput/capacity. Current tests do not establish those claims.

Changes are on the review branch for traceability. Provider credentials, real customer data and production deployment exposure are not part of the seeded dataset. A completed eight-hour campaign with zero observed errors would support the tested paths only; the commercial launch blockers above still require resolution.

## Additional voice-to-invoice assessment requested October 28

The supplied voice-development history was checked against commit `bb65df2de023210f91aa2f9b67fa3d8782bd5f82` and successful [trial run 40706193494](https://github.com/Velnu38/Velnu/actions/runs/40706193494). The server-only storage change is present. The former gap in dedicated backend coverage is addressed by `supabase/functions/transcribe-voice/index_test.ts` and the new voice security workflow: **67 tests passed locally and in dedicated GitHub run 40790552675 with zero failures**, including 100 forged-tenant inputs, 100 entitlement edge cases and 100 simultaneous mocked quota requests. No OpenAI request or charge was made by those tests.

Confirmed fixes preflight secure storage before billable work, bound and time out request parsing, reject malformed business/entitlement values, require quota reservation proof, bound Supabase network requests and report uncertain storage outcomes accurately. Caller-supplied user IDs or transcripts cannot override verified storage fields. Live staging role checks confirm SELECT is granted while INSERT/UPDATE/DELETE are denied; six actual database-role tests verified own read, foreign read denial and forgery/update/delete denial, with all fixtures rolled back. The RLS predicate also requires accepted terms. Staging handler version 11 is ACTIVE with JWT verification preserved and returned 401 to an unauthenticated live request. Two genuine subscriber HTTP sessions are still required to complete the separate direct API isolation script; its current result is explicitly not_run. Activated-entitlement/provider reconciliation and physical mobile microphone/codec tests remain launch requirements from the October 27 report.

Detailed findings, the full coverage matrix, prerequisites and all supplied source links are in [docs/VOICE_BACKEND_ASSESSMENT_2026-10-28.md](docs/VOICE_BACKEND_ASSESSMENT_2026-10-28.md). The eight-hour campaign is [GitHub run 40789573149](https://github.com/Velnu38/Velnu/actions/runs/40789573149); its completed result and preserved failures are documented in **Final eight-hour campaign result** below. This voice assessment remains scoped to its original pinned source revision.

## Browser regression triage

The first real Chrome diagnostic, [run 40790874259](https://github.com/Velnu38/Velnu/actions/runs/40790874259), failed because older tests sought a removed `Bookkeeping` navigation button after the dashboard redesign. It did not fail to load the application. The test helpers now follow the visible financial workbook button and combined Jobs & schedule tabs, retaining the underlying financial and permission assertions. The mobile fixture uses the current Financial performance label. Aggregate RPC mocks were also updated to match the service contract.

The earlier assessment incorrectly classified the missing standalone Change Orders sidebar entry as a defect and restored it. That conflicted with the accepted design direction to offer change orders from sent invoices or estimates. The correction removes the standalone desktop entry and tests the sent-invoice Change orders action, including the original void/status assertions. The combined work hub and dashboard layout remain in place. The corrected flows later passed in [browser run 40802703491](https://github.com/Velnu38/Velnu/actions/runs/40802703491): 95 passed, 0 failed, 0 skipped. Historic failures from the original campaign remain evidence for that original source revision and are not relabeled as passes.

The original full browser run completed with **72 passed and 22 failed** at revision `e6eab2c`. The JSON artifact was inspected. Most failures used obsolete Bookkeeping, Company settings, Jobs/Schedule, or mobile Locations navigation selectors; those flows now follow current visible controls. The old aggregate-value assertion also exposed lost visibility of outstanding receivables after the dashboard redesign. The Invoices tile now shows the existing tenant-scoped open count and outstanding amount for office/owner roles, and the test still verifies the $125.00 balance plus aggregate RPC scope. No tests or assertions were removed to claim a pass; the corrected full browser run 40802703491 later completed with 95 passed, 0 failed, 0 skipped.

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

At the time of this historical delivery note, the ready frontend deployment was **`dpl_BXkwHV6dq1FjjoQAF2y2JvrNi1k8`**. It was later superseded by the private-testing deployment identified at the top of this report. Staging transcription was ACTIVE at version 11 with JWT verification. The eight-hour campaign has since completed; its full result is recorded below. The previously scheduled 07:30 report delivery is historical.

The campaign is pinned to its original source revision. Its historical 22 browser failures must remain in the final campaign log even though the corrected functional source now passes all 95 browser tests. A later code correction is not represented as eight hours of testing of that later revision. The report's commercial launch blockers and real-device/credential prerequisites remain open and explicit.

## Publication and navigation follow-up

[Publication check 40802292269](https://github.com/Velnu38/Velnu/actions/runs/40802292269) successfully executed the actual overnight publisher using its GitHub runner token and wrote both required root files. The original eight-hour campaign has since completed; its earlier browser failures remain historical evidence. A fresh database query still verifies exactly 1,000 QA profiles, with 100 for each of the ten functions.

The accepted dashboard design removes Change Orders from the left navigation and offers it from a sent invoice or estimate. An earlier audit change had mistakenly reintroduced the standalone menu entry. That regression is corrected: the menu remains removed, the existing sent-document workflow is preserved, and the browser regression now checks both the menu's absence and status/void behavior through a sent invoice. The navigation-only correction passed all 95 browser cases in GitHub run 40802703491, with none skipped; provider/device prerequisites remain open; the scheduled 07:30 report delivery is historical and has since been completed.

Current verification after the navigation correction: **`ba5cdb2448ad524775c427bf1df972fdcedb1693`**, [browser run 40802703491](https://github.com/Velnu38/Velnu/actions/runs/40802703491), **95 passed / 0 failed / 0 skipped**. The corrected Change orders test enters through a sent invoice and retains its status/voiding assertions, while explicitly checking that the left-menu entry is absent. This supersedes the earlier menu restoration and its classification as a product defect. Both domains now point to the ready deployment `dpl_7C1RdpuvG8jGbSZv49EQvAWDfvV1`; access protection remains enabled. The latest test receipt records this revision. At that earlier checkpoint, phase one was still running. The completed phase-one result is recorded below without altering the earlier source-specific history.

## Phase-one infrastructure result and publication recovery

Phase one completed its full measured window with **14,401.27 active seconds**, 47 complete live-dataset cycles, **47,000 successful service checks**, 16,920 expected validation rejections and no application-service or dataset failures. The persisted artifact contains one unexpected runtime event: unauthenticated staging guard probe 13 for `stripe-events` exceeded the runner's 12-second client timeout. The other 99 `stripe-events` probes returned the expected gated 503 response. Supabase function-edge logs for the probe window independently contain 99 matching 503 responses with recorded execution times from 31 to 385 ms; no function-edge record exists for the timed-out request. This is consistent with a transient client/network path timeout before a completed handler response, not evidence that the failure can be erased or relabeled as a pass. It remains in `STRESS_TEST_LOGS.json` and keeps the phase status `completed_with_failures`.

The phase-one root publisher separately failed when its initial connection to `api.github.com` exceeded the runner's connection timeout. The artifact upload succeeded, and phase two downloaded that artifact and began from the measured 14,401.27-second checkpoint, so no campaign time was discarded or restarted. The root files were recovered from artifact `finviant-phase-one` (ID `12871203061`). Publication now retries bounded transient network, 408, 429 and 5xx failures with exponential backoff, and re-reads file state after a 409 conflict. A simulated connection failure followed by a 503 verified the retry path before commit; the publication verification workflow now runs whenever the publisher changes. At recovery time, phase two continued toward the required 28,800 accumulated seconds; its completed result is recorded below. The original browser failures remain attached to the original campaign source and are not altered by this recovery.


## Final eight-hour campaign result

[Campaign run 40789573149](https://github.com/Velnu38/Velnu/actions/runs/40789573149) completed both measured phases: **14,401.27 seconds** in phase one and **14,401.29 seconds** in phase two, for **28,802.56 accumulated active seconds**. Across 96 complete cycles, the runner read the live staging dataset and recorded **96,000 successful application-service checks**, **34,560 expected validation rejections**, 2,172 live requests and 1,211 Edge Function guard probes. Phase two added 49 successful 1,000-profile cycles and no new runtime, dataset or security failure.

The final status is intentionally **completed_with_failures**, not a clean pass. The root log contains **23 preserved failures**: one phase-one client/network timeout on unauthenticated `stripe-events` guard probe 13, plus the **22 original browser failures** at pinned source revision `e6eab2c`. Those browser failures remain source-specific history even though corrected functional revision `ba5cdb2` later passed all 95 browser tests in run 40802703491 with none skipped. The campaign runner exited nonzero because it correctly retained the earlier failure count; this was not an early exit, and no measured time was restarted or discarded.

Final root publication succeeded, and artifact `finviant-eight-hour-results` (ID `12881232666`) preserves the measured campaign log. Inspection identified that the original final artifact was created from the pre-browser-merge local file while the published root JSON correctly included all 23 failures. The publisher was corrected to write its merged report/log back to the local workspace before artifact upload, and a separate publication-recovery artifact now carries the same complete root pair. The original artifact is retained unchanged as historical evidence.

A final native query verified **exactly 1,000** rows in `public.finviant_qa_profiles`, with ten functions and exactly 100 profiles per function. No customer email, paid OpenAI request, entitlement change, production write or access-control removal was performed. Commercial launch blockers, real-provider credentials, two genuine subscriber HTTP sessions and physical-device voice validation remain open exactly as documented above.
