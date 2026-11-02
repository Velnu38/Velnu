# Dashboard, job photos and expenses

The dashboard leads with the daily calendar beneath the business-name heading. Its three work tiles are Estimates, Invoices and Jobs. Jobs opens the current/upcoming/history list directly. Schedule and reminders remain accessible from the daily calendar, with no duplicated tabs or reminder section in the Jobs tile.

## Using photos and expenses

- Jobs: select **Photos & expenses** on a job.
- Estimates: select **Photos & expenses** on an estimate.
- Invoices: open an invoice and use its **Photos & expenses** panel.
- Save a new record first, then attach its photos or expenses.
- Pictures accept JPG, PNG and WebP, up to 10 MB each, ten per selection. The browser decodes them, strips image metadata and re-encodes them as JPEG, with the longest edge capped at 2400 pixels. Invalid images fail visibly.
- Expenses have a date, positive amount, category and description. Each expense is stored once in the existing bookkeeping ledger and included in Financial Performance. It does not increase an invoice or estimate's customer-facing total.
- Photos and expenses remain internal. They are excluded from customer approval documents, customer email payloads and printed invoices/estimates. Photos use short-lived authenticated signed URLs from a private storage bucket.

## Persistence and access

`20261102152958_record_photos_expenses.sql` creates `record_photos`, its private bucket and storage policies, and adds nullable record references to `bookkeeping_entries`. Composite foreign keys require the record and its business to match. Each photo targets exactly one record; a linked ledger entry targets at most one and must be an expense. Existing finance policies continue to protect expenses.

Owners, admins and office staff can manage photos and expenses for all three types. Technicians can upload job photos; viewers can view job photos. Financial-document photos and expenses require finance access. Photo metadata and storage paths cannot be updated or overwritten by browser users.

Metadata is inserted before storage upload. An upload failure attempts storage cleanup before metadata removal; incomplete records remain visible for refresh/removal if cleanup cannot complete. Bulk uploads save sequentially; already completed pictures remain if a later file fails. Expense submissions retain a request ID after an uncertain save and verify identical persisted details, including the target record, before treating a retry as success.

Expenses and photos stay attached to their original record after estimate conversion; no duplicate expenses are created. These are actual internal costs, not billable line items or planned quote costs. Use document line items to bill a customer.

## Validation

`npm run test:records` executes the migration with PostgreSQL-compatible PGlite and checks tenant isolation, target integrity, storage access, immutable paths, role restrictions and ledger totals. `npm run test:services` covers existing ledger pagination and retry behavior. The calendar workflow runs browser regressions for all three attachment/expense flows, persistence after reopening, removal, ledger inclusion, business headings, calendar ordering and phone widths. Browser network requests are mocked; they do not replace a real-device upload acceptance test.
