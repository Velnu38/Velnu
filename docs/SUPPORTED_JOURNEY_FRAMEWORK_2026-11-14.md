# Supported journey: first implementation checkpoint

This is a development candidate on `ux/supported-journey-20261113`, based on the verified PR118 beta release. It is not a beta deployment or a certification of the complete supported journey. The owner subsequently authorized implementation and beta release; the earlier assessment-only restriction describes the original assessment, not this candidate.

## Implemented in this candidate

- One derived journey status in the existing Job Management workspace, including the phone header. Work completion and financial settlement remain independent. Only completed work with a settled final invoice and no unresolved visit, scope-change or payment-review blocker can display **Closed · Paid**. Paying a deposit never completes work. Internal costs never become an agreed customer price.
- The existing next action honors approval/deposit review, queued or uncertain delivery, pending payment and reconciliation. It opens the canonical estimate, deposit or final invoice. Existing crew, visit, checklist, material and explicit completion-review controls remain.
- A private, tenant-linked workflow ledger captures new job status, visit and payment changes transactionally. Existing records are not backfilled as new events. Worker rows sharing one arrival deduplicate within the transaction; canceling one crew member does not report the entire visit canceled while other active crew rows remain.
- New workflow records are included in the existing owner archive source. Existing archive authorization, older snapshots, retention and restore gates are retained.
- Invoice-link opening uses the existing validated public capability and ingress controls. It records one event per issued revision, never a raw token, address, IP or user agent. Only an active current issued revision may move `sent` to `viewed`; superseded, partial, paid, expired and revoked cases cannot falsely advance the current invoice. A preview/scanner opening is explicitly distinguished from proof of human reading.
- A bounded, authorized history merges with existing work-plan history in Job Records and appears in the existing Invoice Activity area. Jobs-only staff receive no financial records, document IDs or money state. Tenant/role checks run on the server. No extra dashboard or parallel Jobs route is introduced.
- The existing automatic-reminder eligibility function now holds while Stripe or Square reports an active/pending or review-required payment operation. Invoice settlement/voiding cancels scheduled and queued reminder work. Claimed, sending, accepted or uncertain operations retain their outcome for reconciliation. This cannot recall an already in-flight provider request.

## Release order and limits

The additive migration is `20261114000100_supported_journey_framework.sql`. Deploy and verify it before promoting this frontend: the new invoice activity RPC requires it. The existing Job Management reader tolerates absent/malformed journey facts and retains the prior next-action behavior during a staged rollout. Reverting the frontend can retain the additive ledger and reminder safeguards.

Local synthetic tests exercise rules, actual PostgreSQL functions in PGlite, capability validation, tenant/role restrictions, sibling visit rows, ledger settlement, pending Stripe/Square operations and paging. Phone Chromium captures exercise the implemented workspace at 320/390px. These are development evidence, not hosted PostgreSQL replay, live-provider or physical-device acceptance. See the [checkpoint receipt](evidence/2026-11-14-supported-journey-framework.json).

No hosted migration, beta promotion, environment publication, provider activation, customer message or charge is included in this checkpoint. Supabase deployment access is not available in this runtime; the requested secret declaration in the environment draft alone does not bind a token or apply configuration. Full migration replay/release CI, additive backend rollout and exact beta deployment verification remain required before release.

## Next implementation slices

1. Owner-controlled booking confirmations and payment receipts through the existing durable email outbox. New policies must start disabled, capture intent at event time, preserve stable retry IDs, revalidate recipient/current record/owner/plan/sender at claim, and retain failed/uncertain outcomes. Enabling a policy must not send historical events. This candidate logs events; it does not yet send these new notifications.
2. Reviewed customer notifications for rescheduling/cancellation (AUTO-03), with one saved appointment change, exact customer/time review and a visible notification outcome independent of the scheduling transaction. Do not introduce a second scheduling mutation as a retry.
3. Explicit required-deposit booking enforcement, agreed payment terms, then the isolated full reference-journey acceptance run. The progress suggestion to review an unpaid requested deposit is not a new server-side required-deposit policy. Existing booked work is retained.
4. Google Calendar OAuth configuration and controlled booking/reschedule/cancel/refresh tests on a dedicated calendar. Separately diagnose the previously recorded Outlook/dead-letter issue; this checkpoint neither rechecks nor repairs it.

The reference remains [the supported journey](SUPPORTED_CUSTOMER_JOURNEY_2026-11-13.md). Existing disabled defaults, 48-hour appointment reminders, overdue email 2/7/3 rules, saved overrides, owner review of final invoices, private-beta sender/recipient restrictions and all 51 readiness task histories remain. There is no new autosend/autopay, employee app, merchant activation or public-launch approval.
