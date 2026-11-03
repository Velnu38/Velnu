# Recurring invoices, work completion and Your Next Steps

The primary owner opens an invoice and chooses **Repeat invoice**. Customer, current service property (when linked), line items, prices and payment choices are copied into a private recurring template. Weekly, fortnightly, monthly, quarterly and yearly repeats use a fixed first-date anchor, so month-end and leap-year dates do not drift. The first date defaults to next month; it is the date for a new invoice, not the existing source invoice.

The optional visit uses the same billing date, business timezone, selected workers and duration. Its next calendar job/appointment is prepared immediately. Later visits are prepared as billing dates advance. Current crew conflicts, time off, plan limits, invalid daylight-saving times and current access are checked. Scheduling failures are flagged rather than silently double-booked. Invoices are drafts and require review before delivery; this does not send a message or charge a card.

One active plan per source invoice prevents accidental overlapping repeat schedules. The Invoices list has a Recurring invoices manager. Pause retains existing drafts and visits; resume skips missed billing dates. An end date stops the series. Catch-up is bounded; schedules missed by more than 31 days pause for review. Voided sources, archived customers, owner/access removal or quota failures also require review.

`private.run_recurring_invoices()` runs every 15 minutes using pg_cron. Each occurrence is unique by plan/date; invoice and job request IDs are stable. Workers recheck the saved primary owner and current terms/modules on each execution, restore the caller context, and reuse the existing commerce/crew guards. Private tables have RLS and no browser grants; checked RPCs expose only permitted owner summaries. No email/payment API is called by this worker.

Invoices have an optional Work completed checkbox in creation and detail views. It persists independently of payment state, prints on the invoice when checked, and prevents new change orders server-side. A completed linked job is authoritative. Existing legitimate change-order retries remain readable.

Business contact fields are available in company onboarding and invoice/estimate creation. A primary owner's changes save atomically with the document. Business reply email and contact phone are optional; they do not provision delivery. Account signup still needs an email. Finviant email uses its configured verified sender, with valid business email as Reply-To; automated SMS requires its own configured sender. Existing private-test delivery gates remain in force.

Scheduling prompts, invoice/estimate follow-ups, recurring-draft notices and reminders are grouped under **Your Next Steps:** below the dashboard calendar. Billing tiles default to recent documents; overdue and approval counts/filter views remain accessible. Tile borders are strengthened without altering invoice print borders.

## Verification boundaries

Database tests cover optional completion, contact validation/transaction rollback, copied prices/payment choices, exactly-once generation, date anchoring, selected-worker scheduling, conflict handling, end dates, daylight-saving errors, pause/resume, owner/tenant checks, archived customers, caller-context restoration and private worker/table restrictions. Browser fixtures cover desktop/390px layout and the owner/office flows. Live delivery and physical device behavior remain separate validation work.
