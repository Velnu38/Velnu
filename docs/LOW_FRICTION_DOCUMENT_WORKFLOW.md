# Invoice, estimate and scheduling workflow — November 3, 2026

## Operating rule

Needs Attention is an action queue. A sent invoice belongs there only when it has an unpaid balance and a due date before today in the business timezone. Due today, future-due, no-due-date, paid and void invoices do not qualify. Sending does not imply payment, and scheduling does not imply work completion. Outstanding balances remain visible separately. Explicit user-created reminders remain independent tasks; sending an invoice does not silently complete an unrelated reminder.

## Recommended sequence and minimum input

| Starting point | User supplies | System carries forward / next step |
| --- | --- | --- |
| Invoice for completed work | Customer, work and price; due date if payment follow-up is wanted | Reuse company branding, tax and payment defaults. Save draft, inspect once and send. Do not create an unnecessary job for historical/completed work. Sent/current invoice waits for payment outside Needs Attention. |
| Invoice for work still to do | Open Schedule job and choose the agreed start; adjust duration/site/crew only when needed | Copy customer and line-item scope. Preselect the sole saved site and current user, reuse business duration, calculate end time. One save creates the linked job and calendar appointment atomically. Invoice remains financially unchanged. |
| New estimate | Customer, scope, quantities and prices; site/terms only if needed | Reuse branding/tax/payment defaults. Save opens the preview; send once for customer review. Customer acceptance is recorded once. |
| Accepted estimate | Agreed time, or approved availability options to send to the customer | Schedule from Needs Attention. Copy customer, service site, approved scope and crew. Booking creates one linked job/event and removes its scheduling prompt. Do not also create the same job manually. |
| Work completed from estimate | Mark the job completed | Reuse approved estimate prices to prepare one invoice draft; review/send once. Existing linked invoices are reused. If prices are missing, request only the missing charges. |
| Job without an estimate | Customer, scope and start; assign crew only when defaults are unsuitable | Enter once in Jobs or the calendar; use the same job details for notes/materials, photos and expenses. Prepare its invoice when appropriate. |
| Payment received | Amount and method after verifying receipt | Record payment once. Clear overdue invoice attention when the balance is settled; preserve history. |

An invoice-first path is optional. The lowest-input estimate-led path is **estimate → acceptance → schedule/job → completed work → invoice → payment**. An already-created invoice can instead become the source for the scheduled job without re-entering customer or scope. Converting an estimate before scheduling remains supported; the job links both documents and does not create a second invoice on completion.

## Attention states

| State | Needs Attention behavior |
| --- | --- |
| Sent invoice, not overdue | No invoice action; retain outstanding balance and invoice-list access. |
| Sent/partly-paid/viewed invoice, unpaid and overdue | Show Review invoice until balance is settled or invoice is voided. |
| Invoice due today or without a due date | No automatic overdue action. A due date is required for overdue classification. |
| Completed job with invoice draft | Review/send the draft. After sending, the work-completion invoice-review action clears. |
| Approved estimate awaiting a booking | Schedule job or review proposed times. Clear when actual work is scheduled. |
| Confirmed scheduled job | Calendar and Jobs are the working views. Do not keep asking to schedule it. |
| Pending customer approval | Retain its existing approval view/count; do not record acceptance on the customer's behalf. |
| Explicit due reminder | Show the reminder as its own user-created task until completed. |

## Implementation and safeguards

Invoice detail now offers Schedule job directly, or Open linked job when already linked. The scheduling form does not ask for the customer, price, line items or scope again. Job name and crew are available under an optional disclosure. Legacy document-only schedules preload their dates and are replaced inside the same transaction; a conflict rolls the replacement back. Worker conflicts, membership, billing/scheduling permissions, matching service addresses and void invoices are checked by the server. Retries return the linked job, preventing duplicate jobs/events. Long scope keeps a clear reference to the full linked invoice rather than silently implying that shortened notes are complete.

Attention actions use one blue treatment, 13 px semibold-style text (weight 700), a 44 px height, and 176 px desktop width. On phones they fill the available row. Schedule job, Review invoice, Add charges, Prepare invoice and reminder Done actions share this style. Financial/status colors remain semantic and separate from the action-button style.

Sending/manual issuance announces a work change so mounted attention views can refresh. The dashboard's invoice query explicitly requires an issued status, positive balance and due date before the business day. Browser regressions cover due-today versus overdue at a UTC/business-day boundary, invoice-to-job defaults, one job/event, and computed action styles at desktop/phone sizes. Database regressions exercise real SQL locally, including unauthorized calls, issued-document preservation and transaction rollback.

Private hosting and customer-delivery gates remain. Mock browser sends are not evidence of actual email/SMS delivery or provider calendar synchronization. This assessment does not activate those providers or change production data.
