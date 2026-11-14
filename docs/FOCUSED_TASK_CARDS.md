# Focused task cards

Select one card per batch. Read `AGENTS.md`, [current handoff](CURRENT_HANDOFF.md), and only the relevant canonical readiness entries. Check concurrent work before edits. Preserve functionality, private beta, approved decisions and document branding. Worker profiles remain separate from logins. Run targeted tests and report changed, tested, blocked, next. Report queued CI promptly without repeated polling. For a selected, authorized implementation, merge and deploy to private beta after required checks pass. Report blocked checks promptly and continue only independent authorized work. Select only owner-authorized work and coordinate concurrent chats. This guide does not activate providers, charge, send, or change public-launch scope.

Source: owner-maintained Finviant_Complete_Stage_Prompts.docx, November 11, 2026. Current release facts below supersede its historical checkpoint. Full acceptance and evidence remain in `launch-readiness.json`; cards are scoped execution guidance.


Current checkpoint (November 14, 2026): PR119 supported journey is merged and deployed to private beta at `b340e5f95f102a9ec11befe3d814dafa02771fe9`. Both aliases resolve to READY deployment `dpl_EDVpN5Wv9KqtPgmBB5U3aUCxiWXN`. Final candidate `d8343d48f3d938a3dc4a96285e973b47baa0dd8c` passed all nine returned workflows and all 22 full-suite jobs in [run 43553054639](https://github.com/Velnu38/Velnu/actions/runs/43553054639); candidate and merge trees match. All four journey migrations and the worker/Fin deployments were independently verified. This supersedes the earlier PR112 failure checkpoint and PR119 pre-release missing-backend notes; do not repeat those repairs or migrations.

Highest priority: finish bounded authenticated hosted journey, provider and physical-device acceptance against the current integrated candidate. Retain all task acceptance history. A passed build or deployed page does not prove real delivery, payment, calendar synchronization or user acceptance. Coordinate with existing work chats before selecting an implementation.

PR118 combines Jobs and Job Management into one canonical directory/workspace and restores Fin to phone invoice/estimate creation. This later owner direction supersedes the old separate-workspace rule. PR115 Home, PR116 invoice and PR117 estimate releases are retained. Financial Performance/View Finances redesign remains mockup discussion; do not implement it from this report.

PR97 reminder history, PR103 security, PR104 archive, PR105 abuse/cost, PR109 live business-card links and related UI work retain implementation/release evidence. Hosted security, restore/capacity, contact import, actual owner/physical-device and provider acceptance remain separate open gates. Preserve prior receipts, do not reapply recorded migrations.

Google testing/verification access remains a reported blocker. Twilio setup is not certified: fresh beta evidence has no active SMS sender or reply route and no managed/business-card SMS records. The latest accessible setup chat ends after an expired OAuth state and owner go; check existing work before asking for another login or repeating setup. Stripe test mode is not a completed real-provider sandbox acceptance test.

Visual changes follow the latest owner-approved mockups, one selected card/screen at a time, preserving functionality. Compare actual signed-in candidate rendering and deployed output, with exact commit, viewport and relevant checks. Do not assume the owner sees the approved design merely from synthetic captures or a READY deployment.

## Implementation and isolated verification cards

These reusable prompts do not automatically restart unselected work. Only the provider-independent part may proceed without the matching owner input; use synthetic fixtures and preserve existing authorized settings.

## Card 01: Retain PR93 release evidence

CI-01, UX-01, JOB-01 | Released; verify only a new regression or changed release candidate

**Task:** PR93 has passed all ten workflows and is deployed. Preserve the release receipt in docs/evidence/2026-11-11-ux-release.json. Do not repeat the repaired Settings/completion selectors, Python runner fix or approved UX design. Recheck only changed evidence for a later candidate.

**Done when:** Source, CI, merge and beta deployment remain clearly distinguished from unperformed provider and physical-device acceptance. A later regression receives its own targeted repair and evidence.

**Release scope:** No additional implementation required by this card; any later selected repair deploys to private beta after required checks pass.

## Card 02: Make the report a focused work queue

All registry entries | Published via PR94; maintenance only

**Task:** Maintain the already-published report from the latest authorized head, with task cards, current-state handoff and the 28-package crosswalk. PR94 superseded the old unpublished c941e9e snapshot; never push that snapshot over newer evidence.

**Done when:** All 51 task records, acceptance criteria and evidence survive; AI-03 remains closed with its dated release evidence. Current PR92/PR93 facts replace obsolete next actions. The canonical registry generates a consistent report; assessment:sync, assessment:test and assessment:check pass. No runtime changes, forced completion or full-guide duplication in the report.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 03: Open the right page from Fin

AI-03; relevant AI-01/AI-02 controls | AI-03 deployed and verified; do not reimplement

**Task:** Preserve the deployed direct contextual navigation for clear typed or voice requests to Fin. Customer-reminder requests must open the correct customer-reminder setup or supported creation destination, not internal follow-ups. Ask only for genuine ambiguity or unsaved edits.

**Done when:** Destination assertions pass for context, repeated requests, missing routes, mobile/deep links, Back/Cancel, unsaved edits and tenant/role/plan denial. Navigation alone creates nothing, changes no setting and sends nothing. Preserve action confirmations; document unavailable destinations honestly. Source tests and real voice/device acceptance are recorded separately.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 04: Finish effective reminder settings

AUTO-01 | Implementation deployed; provider/device acceptance open

**Task:** Make the saved effective appointment and invoice reminder rules clear and verify existing behavior. Preserve 48 elapsed hours as the fresh appointment default, initially disabled. Preserve saved 72-hour/other overrides. Invoice defaults remain email-only, 2 days overdue, every 7 days, maximum 3.

**Done when:** Master paused/enabled and inherit/off/custom states are visible and correct. Targeted tests cover fresh/existing businesses, elapsed-time/DST, late arrivals, recipient changes, reschedule/cancel/completion, paid/void suppression and duplicate preparation. Defaults never silently enable an account or send a message; provider acceptance stays separately gated.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 05: Expose accurate reminder history

AUTO-02 | PR97 merged and beta-deployed; hosted owner/provider/device acceptance remains open

**Task:** Preserve the released PR97 reminder-history implementation and migration; do not rebuild or reapply it. Verify only remaining acceptance or a newly evidenced regression. The implementation exposes invoice reminder history from the invoice and Send Reminder entry point using existing message records. Show manual/automatic attempts, local time and timezone, permitted recipient, initiator, last reminder and status/failure detail.

**Done when:** Queued, sending, accepted, delivered, failed, canceled, suppressed and uncertain remain distinct; native handoff says Draft opened. Refresh/relogin, paging, tenant/role limits, missing reads, duplicate/out-of-order callbacks and paid suppression pass. Opening history never resends. Controlled provider evidence remains open until separately authorized and obtained.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 06: Guide rescheduling safely

AUTO-03; relevant CAL-01 | Ready; notification activation separate

**Task:** Make every supported Reschedule action open the correct linked appointment with current details. Save one validated canonical update, then offer a reviewed customer notification and Save without notifying. Keep change notifications separate from arrival reminders.

**Done when:** Timezone/DST, crew/leave conflicts, stale edits, multi-visit isolation and Back/Cancel tests pass. Old queued reminders are invalidated and new occurrences deduplicated. Notification failure preserves the saved appointment and truthful status; an uncertain send is not blindly retried. No message, invitation or charge occurs from opening Reschedule.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 07: Replace surcharge entry with a flat fee

FIN-02; relevant INV-01/PAY-01/PAY-02 | Legacy-draft policy and compliance gates

**Task:** Replace both invoice/estimate surcharge entry areas and duplicate controls with one optional fixed-amount Convenience fee, off/zero by default and removable. Confirm unresolved legacy-draft handling only; preserve historical percentage records and issued/accepted snapshots.

**Done when:** No percentage selector or silent conversion remains in new entry. Fee carries once through estimate, invoice, PDF, share and supported checkout; rounding, tax, discounts, deposits, refunds, permissions and retries pass. Qualified jurisdiction/provider review governs collection, which stays disabled where unverified. This does not activate a Finviant platform fee or charge.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 08: Add the persistent live-card link

CARD-02 | Implementation plus physical-contact acceptance

**Task:** Reuse the live business card and include its stable HTTPS link in the vCard website field. Make Request an Estimate primary while retaining Call, Text, Email, Save Contact and Share Card; QR remains optional.

**Done when:** The same-phone link survives approved card edits and respects public-field controls, unpublish, tenant isolation and spam limits. Leads reach the correct owner for review without automatic job approval or messaging. Actual iPhone/Android contact import, reopen and tapping are evidenced; labels and old saved contacts are not assumed to update.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 09: Close document and finance gaps

INV-01, FIN-01; package 3 | Existing shortcuts, designs and ledger retained

**Task:** Read the existing document-convenience and design receipts; verify only missing selected shortcuts and financial views. Preserve approved stationery, saved services, PO/reference/package work, issued revisions and integer-cent ledger semantics. Do not redesign or rebuild accepted features.

**Done when:** Rendered PDFs, saved review, share pages and attachments agree across tax, fee, discount, deposits, partial payments and refunds. Clones reset transactional identity. Financial drilldowns reconcile authoritative dates/totals, distinguish recorded margin from profit and handle stale/partial/empty states. Tenant, role and mobile regressions pass; additional bulk/credit features remain separately selected.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 10: Certify costs and recurring work

JOB-02; relevant JOB-01/INV-01 | Existing implementation; remaining exceptions

**Task:** Complete the remaining cost, recurring-visit and progress-to-final billing cases using existing time/rate snapshots, budgets, expense allocation and completion reports. Preserve the deployed manager roster and approval-to-one-unscheduled-job behavior.

**Done when:** A two-tenant multi-visit/deposit/change-order/final-invoice journey reconciles quantities, tax, credits, refunds and deduplicated labor/receipts. Skips, pauses, rate/crew changes, DST/month-end, completion/reopen and retries pass. Missing costs are visible; immutable reports remain intact. Ordinary completion invoices stay review-first and deterministic recurrence consumes no Fin request.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 13: Close tenant and access findings

SEC-02 | Targeted security acceptance

**Task:** Review the affected current tenant/RPC/storage surfaces and unresolved findings, not every historical audit again. Test two genuine tenant sessions, role changes, expiry, public-link revocation, webhook replay and Fin tool authorization.

**Done when:** Cross-tenant and revoked-session attempts fail server-side; high exploitable findings are fixed with regression receipts. Definer/search-path and token/storage exceptions are documented. Private deny-by-default tables remain closed. No access expansion, security-setting change or permissive policy is introduced merely to make tests pass.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 14: Prove abuse and cost limits

SEC-03 | Existing controls; gap-based changes

**Task:** Finish distributed limits and backpressure for public links, signup, AI/voice, PDFs, OCR, uploads and sends using the current shared/atomic controls. Preserve tenant quotas and manual fallback.

**Done when:** Concurrent account/business/IP bursts, quota races, retry-after, payload bounds and provider ceilings pass targeted isolated tests. Limits work across instances, protect privacy and recover safely. Ordinary tests cannot send real messages or create unapproved provider costs; any remaining hosted-load permission is listed separately.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 24: Verify complete owner archives

EXPORT-01 | Existing archive; completeness and real download acceptance

**Task:** Use the implemented owner archive and its receipt; close missing record/file coverage and acceptance rather than rebuilding it. Include all current Jobs, financial, attachment and worker/availability data before retention work.

**Done when:** Versioned manifest/count/hash checks prove complete, tenant-scoped export, including over 50,000 rows, final PDFs, balances and history. Owner and expired read-only downloads succeed without a paid plan or Fin charge. Short-lived access and seven-day archive-object expiry work without deleting source records. Historical import stays separate.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 30: Verify the phone Job Management design

JOB-01, UX-01, JOB-05, DEVICE-01 | PR110/112 release evidence; current CI failures and phone discrepancy unresolved

**Task:** First resolve current PR112 required-check failures and establish the phone build being observed; do not presume cache or declare visual acceptance. Keep Job Management distinct from Jobs. Preserve all existing functionality and the owner-approved mockup concept. Verify the full-width phone presentation and quick buttons against those mockups across the entry screen, Summary, Work, Billing, Records and each reachable detail/editor. Do not merely shrink the desktop layout, hide required actions, add capabilities, or treat passing functional tests as visual fidelity. Inspect the actual signed-in release and viewport, not an obsolete screenshot or unrelated preview. Reuse the current active work chat; do not start a competing redesign.

**Done when:** Dated side-by-side evidence shows the selected candidate matches the approved visual hierarchy, proportions, spacing and quick actions at representative phone widths, with no horizontal clipping or inaccessible actions. Existing navigation, permissions, unsaved changes, completion safeguards and all functionality remain. Required functional checks still pass. Record exact tested commit and private-beta deployment. Owner acceptance and physical iPhone/Android testing remain open until obtained. Track the desktop document-creation primary-button contrast finding separately under UX-01; a phone-only exclusion does not fix it.

**Release scope:** Only a separately selected corrective implementation merges and deploys to private beta after visual comparison and required checks pass. This report initiates no corrective implementation or deployment.

## Things I need to fix before prompting Chat

These items are not removed or complete. Prepare only what is needed for the next selected task. Provider-independent code and isolated tests can be scoped separately; the cards below require setup, a decision, a real account/device, or bounded external-test approval before full acceptance.

- Google Calendar: provider project/consent setup and authorized test accounts; then Card 19.
- Stripe and Square: merchant/mode/location setup and exact bounded transaction scope; then Card 20. Do not enable live payments by default.
- Twilio: sender registration, approved recipients, reply/STOP handling and bounded messaging budget; then the SMS part of Card 18.
- Email/Auth: dedicated sender and authorized recipient/recovery accounts; Cards 12 and 18.
- Monitoring/restore/load: operator, target, limits and any paid plan decision; Cards 15–17 and 26.
- Voice/QuickBooks/device acceptance: controlled inputs, provider scope and actual phones/company; Cards 21, 22 and 27.
- Commercial policy, retention, production cutover and optional expansion remain specific decisions, not an instruction to implement or activate all proposals; Cards 11, 23, 25, 28 and 29.

## Card 11: Scope recurring dispatch and autopay

REC-01; relevant PLAN-01/PAY-01/PAY-02 | Decision first; no charge activation

**Task:** Resolve only unsettled plan/scope choices, then implement the selected recurring-dispatch increment separately from stored-method autopay. Reuse current owner controls. Prepare autopay only after explicit customer authorization, processor readiness and its own approved scope.

**Done when:** Draft generation, owner-enabled sending and customer-authorized charging are distinct states. Selected tests prove pause/cancel, versioned dates/prices, quotas, idempotency, expiry and pending/failure/refund recovery. Unselected autopay stays deferred; no provider setup, real send or charge occurs without the exact required authorization.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 12: Certify signup and recovery

AUTH-01, SEC-01; relevant REL-03 | Owner/provider inputs required

**Task:** Verify the remaining real signup, onboarding and recovery gaps against the Auth review. Preserve already- enabled protection/session decisions. Prepare dedicated verified Auth mail separately from document mail, and document the exact remaining operator MFA/recovery actions.

**Done when:** Authorized separate-owner and phone/browser tests cover confirmation, duplicate signup, expired/replayed links, password reset, revoked sessions and lost-access procedures. Sender/rate/budget evidence exists before activation. No shared temporary passwords or chat-only identity bypass. Unavailable SMTP, MFA or physical tests remain named blockers, not passed gates.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 15: Prove alerts and worker recovery

OPS-02, OPS-03 | Monitoring choice and bounded activation required

**Task:** Use existing worker/queue receipts and select the smallest justified monitoring gap. Prepare scrubbed owner/Admin summaries and alert routing; verify worker completion and recovery rather than treating cron presence or an empty queue as success.

**Done when:** An authorized test incident reaches the named owner and shows correct degraded/unavailable timestamps. Expired leases, duplicate/missed jobs, provider throttling and outage catch-up are evidenced without duplicate uncertain sends. Logs exclude customer content/tokens; sampling, retention and budgets are explicit. No new paid monitor or unapproved telemetry activation.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 16: Prove an isolated full restore

OPS-01; relevant REL-01 | Backup plan and isolated target required

**Task:** Extend the existing synthetic recovery work into an authorized hosted restore drill for database, private files and configuration. Use a separate target and approved recovery objectives; leave live beta data unchanged.

**Done when:** A complete business restores with matching file hashes, financial totals, permissions and links; measured recovery time/data loss and rollback are recorded. Backup coverage, storage coverage and deletion- ledger suppression are demonstrated, not inferred from provider settings. Missing owner/provider access or paid backup choice remains a precise blocker.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 17: Measure performance and capacity

PERF-01, PERF-02, JOB-04 | Bounded isolated load authorization required

**Task:** Profile representative Jobs/document/history queries and connection pressure, then run the approved isolated capacity plan. Reuse existing paging/index work; fix measured bottlenecks only. Never stress the live beta or external providers by default.

**Done when:** Before/after query plans and tenant checks support each change. Approved smoke, ramps and soak report p95/p99, failures, queue lag, connections and cost across realistic synthetic tenants. The registry target is 300 workspaces with 10/50/100 concurrent-user ramps and a 60-minute soak; it is not proven capacity. Expansion toward 1,000 requires passing evidence.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 18: Certify email and managed SMS

EMAIL-01, SMS-01 | Provider/recipient approval required; one channel per batch

**Task:** Select the next unverified delivery channel and finish its provider acceptance using the existing delivery engine. Reuse earlier bounded receipts but obtain fresh scope for new recipients/sends. Keep Auth mail separate.

**Done when:** Email alignment/replies/attachments/links and bounce/suppression pass, or SMS registration/replies/STOP/START/segments and signed callbacks pass for the selected channel. Cross-business isolation, quotas and uncertain-send reconciliation hold. Controlled recipient receipt is evidenced. No blanket sending permission, customer campaign or promised inbox placement is inferred.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 19: Certify calendar connections

CAL-01; package 5 availability | Google setup/owner accounts required

**Task:** Finish remaining Google setup and separate-account Google/Outlook connection, refresh/reconnect/revoke and worker acceptance. Preserve already-delivered pagination/throttle fixes and manager availability. External personal events remain display-only unless a separately approved conflict policy changes that.

**Done when:** Real authorized accounts demonstrate background sync, duplicate prevention, refresh/revocation, DST and job-calendar consistency. Internal availability/crew/appointment conflicts still validate server-side. A worker profile grants no login or message. Missing consent/provider/device inputs remain open; do not repeat Square work or reimplement the availability calendar.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 20: Certify Stripe and Square payments

PAY-01, PAY-02 | Merchant and bounded transaction approval required

**Task:** Certify the remaining merchant/provider/device paths on the existing payment implementation. PR92 recovery and its additive lookup/Edge rollout are already recorded; verify changed evidence only. Square remains disabled/unconfigured until specifically approved.

**Done when:** Selected receipts prove merchant/mode/location binding, checkout, signed reconciliation, deposits/partials, refunds/disputes, return loss and duplicate/concurrent processor attempts. Actual POS phones cover missing app, wrong seller and cancellation. Link visits/browser callbacks alone never mark paid. Square POS handoff has no app-fee rail; native NFC remains separate.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 21: Verify Fin voice and usefulness

AI-01, AI-02; relevant AI-03 | Bounded provider/device and pilot inputs required

**Task:** Verify current typed/voice/OCR workflows and source-maintained product guidance after the relevant UI settles. Use authorized bounded provider calls, two tenants and actual phones; compare three scoped tasks with the manual workflow only after baseline safety passes.

**Done when:** Record selection, arithmetic, confirmations, microphone/codec fallback, slow networks, OCR accuracy and failure/request refunds pass. No incorrect unauthorized change executes. A selected 10-20-owner pilot measures time, corrections, abandonment, cost and repeat use against a proposed 30% median time-saving target. Targets are not results; manual workflows stay usable.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 22: Certify QuickBooks and integration claims

INT-01 | Controlled real company required

**Task:** Complete only the advertised QuickBooks read-only import gaps using an authorized controlled company. Check current public integration claims against actual supported behavior rather than expanding scope.

**Done when:** OAuth refresh/disconnect, pagination, supported transactions and reconciliation pass without writeback. Setup needs and limitations are visible. Personal Google review links are not described as a certified Google Business Profile integration. Unavailable provider access remains blocked rather than replaced with a simulated live pass.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 23: Settle commercial terms and lifecycle

PLAN-01, BILL-01, PAY-03; relevant COST-01 | Unsettled decisions first; one implementation increment at a time

**Task:** Recover explicit owner decisions and resolve only remaining pricing/entitlement/lifecycle terms, then implement the selected narrow increment. Treat $14.99 Individual, $28 Business, 15-day trial, 90-day Free, 25/100 Fin requests and Free-only 0.5% fee after a possible 30-day waiver as proposals until approved.

**Done when:** Approved terms map consistently to server-owned dates, seats/profiles, shared requests, packs, grace, upgrade/expiry and public wording. Signed billing events govern paid access; duplicate/refund/failure tests pass. Beta/admin grants and read/export/payment recovery survive. No automatic enrollment/overage, fee collection or live subscription activation is implied; Square POS cannot collect platform fees.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 25: Prepare safe inactive-account retention

RET-01; depends on EXPORT-01 | Policy approval; no live purge

**Task:** After export acceptance and policy approval, implement only isolated retention dry-runs and safeguards. Verify the proposed 30-day abandoned signup cleanup, 60-day export window, expiry/30/7/1-day notices and provider-confirmed backup retention; do not activate live deletion.

**Done when:** Tests cover paid/beta/admin exemptions, legal holds, payment/reactivation races, multi-workspace identities, all current database/file/token/queue data, retries, monitoring and pause. Restore cannot revive purged records. Named live candidates and prospective notice require separate review; irreversible deletion requires its own exact confirmation.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 26: Validate costs and operating ownership

COST-01, OPS-04, REL-02; relevant JOB-04 | Provider bills, plan evidence and owner decisions required

**Task:** Finish the existing cost/support drafts using actual plan/bill evidence and measured full-use behavior. Name support, alert and recovery owners and the backup developer. Recommend commercially eligible hosting and bounded budgets without buying or upgrading.

**Done when:** Paid/free/trial scenarios include AI, voice, OCR, delivery, registration, storage/egress and support; a proposed 50% paid-tier operating margin is demonstrated or assumptions are revised before sale. No unapproved fee income or annual discounts. Approved 80/100% alerts and escalation work without an active chat. Privacy, cancellation/refund and incident procedures have owners and approval.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 27: Finish real-device journey acceptance

DEVICE-01, JOB-05, UX-01, JOB-01; relevant CARD/AUTO/INV | After current UI candidate is releasable

**Task:** Test only the remaining authenticated iPhone Safari/Android Chrome and accessibility journeys on the correct integrated candidate. Reuse PR93 synthetic receipts; do not rerun an app-wide discovery audit or rebuild its four mobile groups and next-action policy.

**Done when:** Exact-job navigation, directory views, tasks/templates, visits/crew, materials/photos/receipts, changes, completion/reopen and financial links pass with role/tenant checks. Contact import, PDFs/share, voice fallback, keyboard/screen reader/zoom, interruption and unsaved edits are evidenced. Approved branding, roster limits and beta restrictions hold. Unperformed provider tests stay open.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 28: Run the explicit release audit

REL-01, REL-03, CI-01; all mandatory advertised gates | Release audit only after scoped work

**Task:** For the selected release, reconcile the complete 28-package crosswalk once, verify the integrated immutable candidate and rehearse the approved cutover/rollback with two tenants. Distinguish the domain-bound beta backend from the separate future production project.

**Done when:** The release decision lists checks, schema/Edge/frontend, provider/device evidence, costs, policies, disabled scope and owner actions. Required tests pass on the actual promotion candidate. No URL/key-only migration, public registration, beta-protection removal, subscription/fee activation or domain/backend switch occurs without separate exact authorization. Keep private beta if mandatory gates remain open.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.

## Card 29: Keep optional work separate

EXPORT-02, GROW-01/02/03, PORTAL-01, TAP-01, JOB-03, STORE-01 | Deferred or separately selected; no automatic implementation

**Task:** Choose at most one optional item for a bounded recommendation using prior feasibility work. Keep historical import, a new offer, component licensing, dedicated portal, native NFC, field-worker logins and app stores outside the core backlog until separately selected.

**Done when:** The selected recommendation states demand, exact scope, dependencies, licensing/data rights, cost, security and one next decision. Import includes dry-run/duplicate/restore safeguards; new products need demand and delivery/billing acceptance. Field access needs revocable assigned-job-only permissions; native/store work needs device/platform approval. No outreach, purchase, vendor signup, development or sale is implied by this assessment.

**Release scope:** For a selected authorized application change, merge and deploy to private beta after required checks pass. Documentation/verification alone does not authorize an application change. Preserve provider, physical-device and public-launch gates; paused work remains paused.



