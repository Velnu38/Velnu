# Supported customer journey: agreed work to final payment

Defined November 13, 2026 (America/New_York). Product/workflow definition only. This specifies the target contract; it does not certify current implementation, enable automation or authorize deployment, messaging, merchant activation or charges. Existing account settings and permissions remain authoritative until a separately implemented change.

## Selected reference journey

A manager-operated service business delivers a fixed-price job for an existing or newly entered customer. The customer approves the estimate, selects an offered appointment, receives service, and pays the final invoice through verified hosted checkout. Multiple visits and approved changes stay within the same job. The reference currency is USD. Email is the primary customer channel once certified and enabled. SMS is optional only with a configured sender and appropriate permission; never silently switch channels.

Use one customer, service location, job and linked document history throughout. The job workspace is the operational home. Estimates and invoices retain their own financial/legal records; users should not copy their data between screens. Fin is an optional shortcut into the same actions, not an additional required step.

## Stage contract

| Stage | Deliberate action | Automatic continuation required | Visible outcome / next action |
| --- | --- | --- | --- |
| 1. Capture and price | Owner selects/enters customer and site, describes work and reviews fixed-price line items, tax and terms. Fin may prepare this from typed or dictated instructions. Owner chooses Send estimate. | Save linked records together; publish the exact reviewed document revision; queue one authorized delivery. Preserve entries on failure. | Estimate awaiting approval; customer sees scope, price, terms and Accept/Decline. Delivery failures show Fix delivery. |
| 2. Accept work | Customer accepts the current estimate and terms. | Record decision/version; create or reuse exactly one linked job with the agreed scope and prices. Stop approval follow-ups for that resolved revision. | Job Needs scheduling; owner has Prepare appointment options. Decline stops progression and exposes Revise estimate, without inventing acceptance. |
| 3. Offer appointments | Owner reviews visit duration, crew, location and available time options, then sends the offer. | Check authorized availability/conflicts and preserve the approved offer snapshot. Customer gets one booking link. | Awaiting customer booking; owner can see which offer is current. No repeated customer/scope entry. |
| 4. Book and prepare | Customer selects a still-available offered time. | Atomically recheck and reserve the canonical visit/crew; mark Scheduled; queue one confirmation and the eligible arrival reminder; queue calendar synchronization. | Customer sees confirmed time in the business timezone and can download a calendar file. Owner sees visit, crew and preparation tasks. A conflict offers fresh choices instead of double booking. |
| 5. Deliver work | Manager starts the visit, manages tasks/materials/photos and records additional visits as needed. | Keep the same job and activity history; update progress. Approved changes update agreed billing once. | Work In progress; primary action points to the actual next task, visit or blocker. Internal labor/material costs remain distinct from customer charges. |
| 6. Complete work | Manager chooses Review completion and confirms the current completion snapshot. | Require all visits to be resolved; recheck warnings and approval state; mark work Completed; suppress obsolete appointment messages; prepare/reuse one final draft invoice from agreed prices, approved changes and eligible deposit credit. | Completed · Invoice ready for review, with one Review invoice action. Missing pricing, disputed changes or unsettled deposits produce a specific resolution action; no guessed amount or automatic send. |
| 7. Issue invoice | Authorized owner reviews the final invoice and chooses Send invoice. | Publish the exact reviewed revision; queue branded email with private invoice/PDF/payment access; record truthful delivery state; enroll the issued unpaid balance in the saved enabled reminder rule. | Invoice issued with current balance and due date; delivery failures stay visible without duplicating the invoice. |
| 8. Collect payment | Customer uses Pay now through the selected verified merchant checkout, or owner records money already received through another method. | Verify provider/account/currency/invoice/amount before posting funds; deduplicate callbacks; update partial/paid balance, customer balance and financial metrics. On final settlement suppress unclaimed payment reminders and queue one receipt. | Partial payment leaves the remaining balance active. Completed work plus settled final balance produces Closed · Paid. Owner sees exceptions requiring reconciliation. |

## Explicit business rules

- **Pricing:** Fixed-price, customer-agreed scope is the supported baseline. Saved services can prefill it. Time and internal cost records never silently become billable charges. Hourly/time-and-materials and quantity-based progress billing require a separate completed specification and acceptance.
- **Owner decisions:** Review price and estimate delivery, appointment options/crew, actual work completion and final invoice delivery. Customer acceptance, booking, routine enabled reminders, verified payment posting and receipts should not require repetitive owner confirmation. Completion autosend is outside this baseline; retain final draft/review.
- **Terms:** Carry agreed terms into the final draft, calculate due date from the actual issue date and agreed terms, and show the result before sending. Missing terms require selection once. Preserve issued dates and snapshots. Never silently adopt a new global Net 15/30 setting.
- **Deposit option:** Default reference case needs no deposit. If the owner requires a deposit, issue its linked invoice from the accepted terms and require verified settlement before opening booking. Carry its credit once to the final invoice. Deposit payment never completes work. Existing jobs with already arranged visits need a reviewed exception rather than automatic cancellation.
- **Multiple visits:** A completed visit is not a completed job. Remaining visits block job completion. Canceled/skipped visits require an explicit recorded resolution. Reopening work preserves invoices/payment history and requires review; it must not generate another final invoice blindly.
- **Changes:** Additional customer charges require approved scope/pricing. Pending or declined changes cannot be silently billed. Change approvals retain their own exact revision and audit history.
- **Invoice-first entry:** Resolve an existing invoice to its canonical job and reuse its financial record. Do not run the reference flow in a way that creates a second charge for previously invoiced work. Unpriced/direct jobs require agreed pricing before automatic final preparation.
- **Work versus money:** Maintain separate operational state (needs scheduling/scheduled/in progress/completed/canceled), invoice state and payment state. Overall labels are derived. A refund can reopen a financial exception without reopening completed work; a paid deposit never marks the job complete.

## Customer and worker communication

Target communication events are estimate issued, appointment offer, booking confirmation, changed/canceled appointment, enabled arrival reminder, final invoice, enabled payment reminders and payment receipt. Each uses current authorized contact details, the relevant record/version, one durable request identity and a recorded result. Approval-offer follow-up for customers who have not replied is outside the baseline until its timing is selected; show owner attention rather than inventing an automatic chase policy.

Preserve existing fresh defaults: arrival reminder **48 elapsed hours** before the visit; invoice reminder **email two days overdue, every seven days, maximum three**. Defaults start disabled; previously saved timing, channels and per-record overrides survive. Do not introduce pre-due/due-day/+3/+14 escalation merely from the conceptual example. Show the effective enabled/paused rule and next eligible action.

Late bookings should receive the booking confirmation; do not send a redundant backdated 48-hour reminder. Rescheduling invalidates unclaimed old reminder snapshots and queues one authorized change notice. Cancellation/completion ends obsolete visit messages. Final settlement suppresses future eligible payment reminders; it cannot recall an already accepted/in-flight message. Partial payment updates the amount owed. Pending/uncertain online payment holds collection pressure until reconciliation; do not call uncertainty either paid or failed.

The selected release remains **manager-operated crew assignment**. Assignment does not mean a worker accepted, was notified or received login access. The manager sees crew details and coordinates the crew. Automated worker notification or a restricted worker app is a separate scope decision; no employee identities, invitations or channels are activated by this definition.

## Job workspace and Fin

Show one identity, overall stage, next visit/crew, completion blockers, agreed billing, remaining balance, next enabled automation and a shared timeline. Retain Summary / Work / Billing / Records; present one primary next action plus occasional actions. Home surfaces upcoming work and exceptions linking to this same job. Keep routine history separate from items needing attention without creating another competing job manager.

Fin should use the same authorized records to prepare an estimate, help choose appointment options, find job information, capture tasks/notes, explain a blocker and open invoice review. One request should lead to one coherent review/action with entered data retained. Show what saved, what is queued and what still needs attention. Fin must not invent customer identity, pricing, consent, worker availability, delivery or payment success. Background rules and verified events drive automatic transitions even when Fin and the browser are closed. Manual controls remain usable.

Invoice-link opening is an additional customer activity event, not an approval or payment. The target records a deduplicated opening and exposes it to the owner without downgrading Partial/Paid to Viewed. Label it as link activity because scanners/previews can open links. Keep this implementation gap explicit.

## Failure and completion contract

Every automatic action requires a durable identity, current-state/permission check, bounded retry policy and audit link. Duplicate requests/events must produce one intended business result. Distinguish queued, sending, accepted, delivered, failed, canceled and uncertain. A provider timeout must not trigger a blind second message or charge. Show one actionable exception; preserve completed stages, entered data and original financial history. Calendar sync failure must not erase an authoritative booked visit; show the integration problem separately.

The journey is accepted only after isolated tests and separately authorized provider/device acceptance demonstrate:

1. One accepted estimate produces one job, one customer booking produces one canonical visit, and completion produces/reuses one correct final invoice without re-entry.
2. Multiple visits, crew changes, rescheduling/cancellation and changed recipients correctly invalidate obsolete actions; permissions and two-business isolation hold.
3. Exact document versions, due dates, approved changes, deposits, partial payments, tax and refunds reconcile across invoice, job, customer and Financial Performance.
4. Real enabled delivery/checkout works, failures and uncertain outcomes recover without duplicates, paid suppression works across dispatch races, and receipt/history survive refresh/relogin.
5. The journey works on actual supported iPhone/Android devices. Measure actions/time and compare Fin with the manual path; no assumed time-saving percentage.

Synthetic billing example: accepted work $2,400 plus approved change $300, no tax, deposit already paid $500. Final charges are $2,700, credited deposit $500, remaining balance $2,200. A $1,000 payment leaves $1,200; verified final payment closes the financial stage and suppresses reminders. None of these figures is hosted business data.

Dependencies/gaps remain as recorded in the [assessment](END_TO_END_AUTOMATION_ASSESSMENT_2026-11-13.md). This definition closes no readiness gate and does not certify the end-to-end automation merely from the released [unified Jobs/Fin UI](UNIFIED_JOB_MANAGEMENT_2026-11-13.md).
