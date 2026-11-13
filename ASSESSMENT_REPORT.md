# Finviant Assessment Report

**Reviewed: 2026-11-13 (America/New_York).** Focused work queue; acceptance records are not counts of unbuilt features.

> Generated from [docs/launch-readiness.json](docs/launch-readiness.json). Completed tasks are removed from this report automatically; evidence/history remains in the registry and Git history. Do not edit this generated file directly.

## Release boundary

**NOT READY for unrestricted public launch** — 20 public gates; 9 paid/Pro/advertised gates; 21 optional/deferred items.

Owner authorized publication, merge and private-beta deployment after required checks pass. Private beta, existing permissions and backend remain unchanged. Source, CI, merge, migration, deployment, activation and provider/physical-device acceptance are separate.

## Current state and next action

- November 13 latest verified beta: PR118 unified Job Management and restored Fin released as f421e562853002d9e7a31fa4a427a5a08bd5b753, READY deployment dpl_H3j5zc3YH4Jso4U3zYU4ABC9cDkS on both Finviant domains. All 16 applicable workflows and 22 full-suite jobs passed at 02f165820003f857500eddb0506e4d9cbad49e32; tested and merged trees match. One canonical job directory/workspace and direct actions preserve permissions, dirty drafts, history, scheduling/completion/invoice safeguards. Customer context and a phone footer overlap were corrected. Home PR115, invoice PR116 and estimate PR117 are retained. No backend/provider/data/message/payment changes. Supported customer journey is a definition, not a new implemented automation pipeline. Owner, physical-device, live-provider and public-launch gates stay open.

- Last recorded operational issue: November 13 read-only beta evidence found one dead calendar queue item and one Outlook integration with an error despite state=connected; last successful sync November 11 00:14 UTC. OPS-03/CAL-01 remain open. Current provider state and recovery were not rechecked in the end-to-end source assessment, and no requeue, reconnect or provider change was performed.

- PR97 reminder history is already merged and beta-deployed; the old pause/open-PR97 instructions are historical and superseded. Preserve its migration and receipts without reapplying. AUTO-02 still needs hosted owner/provider/physical-device acceptance. PR103 security, PR104 archive and PR105 abuse/cost work have implementation/release evidence, not full hosted isolation, restore, capacity, provider or operating-owner acceptance.

- PR109 stable live business-card links and PR110 Job Management visual correction have release evidence. Retain CARD-02 contact-import/owner acceptance, JOB-01/UX-01/DEVICE-01 mockup and physical-device gates. PR111 invoices and PR113 estimates were owner-approved for implementation; do not treat them as proposal-only. The current phone screenshot discrepancy remains unresolved; do not presume a caching cause or claim the owner sees the deployed design.

- The owner authorized combining Jobs and Job Management into one efficient canonical workspace, superseding the earlier separate-workspace rule. The local candidate retains existing actions, directory views, deep links, permissions and completion review. Capture actual candidate comparisons and record exact source/viewport/check evidence; full release regression and beta verification remain required before promotion. This does not authorize new automation or providers in the current assessment.

- All 51 canonical task records and their criteria/history are retained unchanged. AI-03 remains the sole formally completed record; this is not a measure of total application completion. No other requested change is removed merely for implementation, merge or deployment. Provider setup, real-device acceptance, security, full hosted restore/load, commercial decisions and public launch remain separately gated.

- Hero/introduction claims must be checked against verified enabled beta capabilities and approved plan terms. This checkpoint does not establish new hero verification or a pricing decision. No application code, provider settings, activation, customer sends, purchases or costs changed in this report.

[Current handoff](docs/CURRENT_HANDOFF.md) · [Detailed task cards](docs/FOCUSED_TASK_CARDS.md). Select one card; do not repeat the full audit. Recheck current heads before publication or release.

## Focused task cards

This index summarizes scope and blockers; detailed Task and Done when text lives once in the linked guide.

| Card | Selected work | Boundary / input |
| --- | --- | --- |
| 01 | [Retain PR93 release evidence](docs/FOCUSED_TASK_CARDS.md#card-01-retain-pr93-release-evidence) | PR93 historical release retained; current PR112 regression/CI triage takes priority |
| 02 | [Make the report a focused work queue](docs/FOCUSED_TASK_CARDS.md#card-02-make-the-report-a-focused-work-queue) | Published via PR94; maintain source and regenerate, no old snapshot |
| 03 | [Open the right page from Fin](docs/FOCUSED_TASK_CARDS.md#card-03-open-the-right-page-from-fin) | AI-03 verified and closed; broader voice/provider acceptance remains open |
| 04 | [Finish effective reminder settings](docs/FOCUSED_TASK_CARDS.md#card-04-finish-effective-reminder-settings) | Implementation deployed; provider/device acceptance remains open |
| 05 | [Expose accurate reminder history](docs/FOCUSED_TASK_CARDS.md#card-05-expose-accurate-reminder-history) | PR97 merged and beta-deployed; owner/provider/device acceptance open, do not reimplement |
| 06 | [Guide rescheduling safely](docs/FOCUSED_TASK_CARDS.md#card-06-guide-rescheduling-safely) | Ready; notification activation separate |
| 07 | [Replace surcharge entry with a flat fee](docs/FOCUSED_TASK_CARDS.md#card-07-replace-surcharge-entry-with-a-flat-fee) | Legacy-draft policy and compliance gates |
| 08 | [Add the persistent live-card link](docs/FOCUSED_TASK_CARDS.md#card-08-add-the-persistent-live-card-link) | PR109 release evidence; real contact-import and owner acceptance remain open |
| 09 | [Close document and finance gaps](docs/FOCUSED_TASK_CARDS.md#card-09-close-document-and-finance-gaps) | Existing shortcuts, designs and ledger retained |
| 10 | [Certify costs and recurring work](docs/FOCUSED_TASK_CARDS.md#card-10-certify-costs-and-recurring-work) | Existing implementation; remaining exceptions |
| 11 | [Scope recurring dispatch and autopay](docs/FOCUSED_TASK_CARDS.md#card-11-scope-recurring-dispatch-and-autopay) | Decision first; no charge activation |
| 12 | [Certify signup and recovery](docs/FOCUSED_TASK_CARDS.md#card-12-certify-signup-and-recovery) | Owner/provider inputs required |
| 13 | [Close tenant and access findings](docs/FOCUSED_TASK_CARDS.md#card-13-close-tenant-and-access-findings) | Targeted security acceptance |
| 14 | [Prove abuse and cost limits](docs/FOCUSED_TASK_CARDS.md#card-14-prove-abuse-and-cost-limits) | Existing controls; gap-based changes |
| 15 | [Prove alerts and worker recovery](docs/FOCUSED_TASK_CARDS.md#card-15-prove-alerts-and-worker-recovery) | Monitoring choice and bounded activation required |
| 16 | [Prove an isolated full restore](docs/FOCUSED_TASK_CARDS.md#card-16-prove-an-isolated-full-restore) | Backup plan and isolated target required |
| 17 | [Measure performance and capacity](docs/FOCUSED_TASK_CARDS.md#card-17-measure-performance-and-capacity) | Bounded isolated load authorization required |
| 18 | [Certify email and managed SMS](docs/FOCUSED_TASK_CARDS.md#card-18-certify-email-and-managed-sms) | Provider/recipient approval required; one channel per batch |
| 19 | [Certify calendar connections](docs/FOCUSED_TASK_CARDS.md#card-19-certify-calendar-connections) | Google setup/owner accounts required |
| 20 | [Certify Stripe and Square payments](docs/FOCUSED_TASK_CARDS.md#card-20-certify-stripe-and-square-payments) | Merchant and bounded transaction approval required |
| 21 | [Verify Fin voice and usefulness](docs/FOCUSED_TASK_CARDS.md#card-21-verify-fin-voice-and-usefulness) | Bounded provider/device and pilot inputs required |
| 22 | [Certify QuickBooks and integration claims](docs/FOCUSED_TASK_CARDS.md#card-22-certify-quickbooks-and-integration-claims) | Controlled real company required |
| 23 | [Settle commercial terms and lifecycle](docs/FOCUSED_TASK_CARDS.md#card-23-settle-commercial-terms-and-lifecycle) | Unsettled decisions first; one implementation increment at a time |
| 24 | [Verify complete owner archives](docs/FOCUSED_TASK_CARDS.md#card-24-verify-complete-owner-archives) | Existing archive; completeness and real download acceptance |
| 25 | [Prepare safe inactive-account retention](docs/FOCUSED_TASK_CARDS.md#card-25-prepare-safe-inactive-account-retention) | Policy approval; no live purge |
| 26 | [Validate costs and operating ownership](docs/FOCUSED_TASK_CARDS.md#card-26-validate-costs-and-operating-ownership) | Provider bills, plan evidence and owner decisions required |
| 27 | [Finish real-device journey acceptance](docs/FOCUSED_TASK_CARDS.md#card-27-finish-real-device-journey-acceptance) | After current UI candidate is releasable |
| 28 | [Run the explicit release audit](docs/FOCUSED_TASK_CARDS.md#card-28-run-the-explicit-release-audit) | Release audit only after scoped work |
| 29 | [Keep optional work separate](docs/FOCUSED_TASK_CARDS.md#card-29-keep-optional-work-separate) | Deferred or separately selected; no automatic implementation |
| 30 | [Verify the phone Job Management design](docs/FOCUSED_TASK_CARDS.md#card-30-verify-the-phone-job-management-design) | PR110/112 release evidence; current required CI fails, phone discrepancy and owner acceptance open |

## Open acceptance records

Original acceptance criteria, owner, rationale and evidence remain in the canonical registry. Cards narrow execution; they do not replace or weaken those criteria. Card 02 maintains every record; the table lists implementation/acceptance cards separately.

| ID | Priority / status | Requirement | Gate | Cards |
| --- | --- | --- | --- | --- |
| REL-01 | P0 · open | Choose and rehearse the production cutover | public | 16, 28 |
| REL-02 | P0 · blocked_external | Use commercial hosting and set budget alerts | public | 26 |
| REL-03 | P0 · open | Release ordinary customer onboarding safely | public | 12, 28 |
| CI-01 | P0 · open | Complete release validation and staged promotion enforcement | public | 01, 28 |
| SEC-01 | P0 · blocked_external | Harden Auth and privileged accounts | public | 12 |
| SEC-02 | P0 · not_verified | Finish independent tenant, RPC and storage security review | public | 13 |
| SEC-03 | P0 · open | Add distributed abuse limits and backpressure | public | 14 |
| OPS-01 | P0 · not_verified | Prove backup and recovery | public | 16 |
| OPS-02 | P0 · open | Install operational monitoring and route alerts | public | 15 |
| OPS-03 | P0 · not_verified | Verify scheduled work and reconcile uncertain deliveries | public | 15 |
| PERF-01 | P0 · open | Tune RLS, queries and connection budgets | public | 17 |
| PERF-02 | P0 · not_verified | Measure capacity with realistic isolated tenant load | public | 17 |
| EMAIL-01 | P0 · blocked_external | Release general transactional email | public | 18 |
| BILL-01 | P0 · open | Implement and reconcile paid subscription activation | paid | 23 |
| SMS-01 | P0 · blocked_external | Activate and certify managed SMS | pro | 18 |
| PAY-01 | P0 · blocked_external | Certify customer merchant payments and reconciliation | pro | 07, 11, 20 |
| CAL-01 | P0 · blocked_external | Finish Google setup and multi-account calendar certification | pro | 06, 19 |
| AI-01 | P1 · not_verified | Verify AI, voice and receipt scanning live | paid | 03, 21 |
| INT-01 | P1 · not_verified | Validate remaining advertised external integrations | advertised | 22 |
| DEVICE-01 | P1 · not_verified | Complete real-device and accessibility acceptance | public | 27, 30 |
| OPS-04 | P1 · open | Set customer support, privacy and incident operations | public | 26 |
| COST-01 | P1 · not_verified | Validate tier unit economics and shared capacity | paid | 23, 26 |
| AUTO-01 | P2 · open | Extend owner-controlled follow-up automation | optional | 04 |
| EXPORT-01 | P1 · open | Provide complete owner record archives before automated deletion | public | 24, 25 |
| PORTAL-01 | P2 · deferred | Dedicated customer site | optional | 29 |
| TAP-01 | P2 · deferred | Native Tap to Pay and expanded field-worker tools | optional | 29 |
| AUTH-01 | P0 · open | Certify production signup and account recovery end to end | public | 12 |
| PLAN-01 | P0 · open | Implement the revised pricing, trial and Free lifecycle | public | 11, 23 |
| RET-01 | P0 · open | Implement bounded inactive-account retention and verified deletion | public | 25 |
| EXPORT-02 | P2 · open | Expand historical migration and archive import | optional | 29 |
| GROW-01 | P2 · open | Validate one additional Finviant business-solutions offer | optional | 29 |
| GROW-02 | P2 · open | Qualify reusable job-management components and commercial licenses | optional | 29 |
| GROW-03 | P2 · open | Certify the selected product or download before sale | optional | 29 |
| JOB-01 | P1 · open | Unify Job Management into a practical daily manager workspace | optional | 01, 10, 27, 30 |
| JOB-02 | P2 · open | Certify job costs, recurrence and progress-to-final billing | optional | 10 |
| JOB-03 | P2 · deferred | Decide and certify restricted field-worker access separately from profiles | optional | 29 |
| JOB-04 | P2 · open | Benchmark, load-test and cost-certify the selected Jobs module | optional | 17, 26 |
| FIN-01 | P2 · open | Validate the extended Financial Performance dashboard | optional | 09 |
| PAY-02 | P2 · blocked_external | Configure and certify Square hosted checkout and POS Tap to Pay | optional | 07, 11, 20 |
| PAY-03 | P2 · open | Decide and certify payment monetization before collecting platform fees | optional | 23 |
| FIN-02 | P2 · open | Replace invoice and estimate surcharge controls with an optional flat convenience fee | optional | 07 |
| INV-01 | P2 · open | Finish document shortcuts and consistency acceptance | optional | 07, 09, 10 |
| REC-01 | P2 · open | Certify opt-in recurring dispatch and merchant autopay | optional | 11 |
| AI-02 | P2 · open | Measure Fin usefulness against the manual workflow | optional | 03, 21 |
| JOB-05 | P1 · open | Verify Job Management on physical devices and authenticated live workflows | public | 27, 30 |
| STORE-01 | P2 · deferred | Prepare future Apple and Google store distribution | optional | 29 |
| CARD-02 | P2 · open | Add a persistent live business-card link to saved contacts | optional | 08 |
| AUTO-02 | P1 · open | Make invoice reminder history visible, complete and delivery-accurate | advertised | 05 |
| AUTO-03 | P1 · open | Guide rescheduling and reviewed customer notification | advertised | 06 |
| UX-01 | P1 · open | Make Finviant intuitive, action-first and frictionless | optional | 01, 27, 30 |

## Original 28-package crosswalk

Lookup only; not a completion certificate or instruction to rerun all packages.

| Package | Original scope | Cards |
| --- | --- | --- |
| 1 | Accurate baseline and consolidation | 01, 02 |
| 2 | Release test system | 01, 28 |
| 3 | Approved invoice and estimate design | 09, 27 |
| 4 | Jobs execution and roster reconciliation | 10, 27, 30 |
| 5 | Manager availability | 19, 27 |
| 6 | Customer reminder defaults | 04, 05, 06, 15, 18 |
| 7 | Fin product knowledge | 03, 21 |
| 8 | Tenant, role, RPC and file isolation | 13 |
| 9 | Signup, onboarding, recovery and MFA | 12, 28 |
| 10 | Distributed abuse and cost limits | 14 |
| 11 | Monitoring and owner alerts | 15, 26 |
| 12 | Workers and uncertain deliveries | 15, 18, 19, 20 |
| 13 | Backups, storage restore and rollback | 16, 28 |
| 14 | Database performance and capacity | 17 |
| 15 | General email and managed SMS | 18 |
| 16 | Google and Outlook calendars | 19 |
| 17 | Stripe and Square payments | 20 |
| 18 | Fee handling | 07, 23 |
| 19 | Financial reporting and document tools | 09, 10 |
| 20 | Recurrence and progress billing | 10, 11 |
| 21 | AI, voice, OCR, QuickBooks and usefulness | 03, 21, 22 |
| 22 | Commercial lifecycle and monetization | 23, 26 |
| 23 | Complete owner archives | 24 |
| 24 | Safe retention | 25 |
| 25 | Economics, support and privacy | 26 |
| 26 | Device acceptance and cutover | 27, 28, 30 |
| 27 | Historical import | 29 |
| 28 | Deferred products and major expansion | 29 |

## Decisions and supporting evidence

The canonical registry retains all dated observations, recommendations, proposal bodies and source references. Historical pending actions are superseded by the current handoff; approved document design, reminder rules and worker-profile/login separation are not reopened.

## Finviant Pricing

**Implementation pending.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Finviant Business Solutions

**Implementation pending.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Finviant Job Management Widget

**Native Jobs and manager Job Management execution UI are deployed in the private beta through PR69. Planned visits, office cost review and immutable completion reports use the applied, real-schema rollback-verified SQL; all seven final PR workflows passed and live assets were checked. Employee self-service UI is excluded. Broader recurrence/progress billing and real-account, provider, physical-device and measured performance acceptance remain open. The dated design discussion below is historical.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Finviant Dashboard, Jobs and Payments Plan

**Financial, Jobs and Stripe/Square source paths are implemented. Provider activation, compliant fee collection, device and operational acceptance remain open. The historical recommendations below do not authorize new fees or services.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Finviant Invoice Ninja Benchmark

**Selected document/report/Jobs conveniences are implemented. Remaining PO/packages, recurring, provider and economic work stays open; historical comparisons do not replace current source or approve commercial terms.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Finviant frictionless navigation and Job Management refinement

**Navigation and phone presentation increments are deployed through PR101. Owner/mockup fidelity, physical-device, accessibility and broader JOB-01/UX-01 acceptance remain open; do not repeat completed source work or claim the design is accepted.** Full preserved proposal: [canonical registry](docs/launch-readiness.json), proposals section. Later approved task-specific decisions take precedence over conflicting older proposal text.

## Maintenance

Run `npm run assessment:sync`, `npm run assessment:test`, and `npm run assessment:check` after registry changes. Close tasks only with complete dated, commit-bound acceptance evidence; use assessment:complete or assessment:reopen. Never infer provider, restore, capacity or physical-device acceptance from source, mocks or deployment READY.

No runtime change, migration, provider activation, real send/charge, access expansion, paid commitment or public cutover is authorized by this report.
