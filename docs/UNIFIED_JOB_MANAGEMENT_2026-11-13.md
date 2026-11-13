# Unified Job Management and restored Fin

Implemented on `ux/unified-job-management-20261113`, based on the verified invoice/estimate beta release and its handoff receipt. This is a development candidate, not a beta deployment. The owner's instruction to consolidate the two job areas supersedes the earlier handoff's separate-workspace guidance.

## One entry and one job workspace

The main navigation has one Job Management entry. Its default screen is the server-paged directory, retaining search across job/customer/location, status and date-based views, crew filtering, history and optional Board layout. A single view selector replaces overlapping status cards and the second management queue. Board clearly identifies its page scope. Approved work retains server paging and distinguishes estimates requiring explicit job setup from already-linked jobs.

Every job opens the same workspace, including existing `document` links, management `job` links and calendar links. The job identity appears once. All jobs and browser Back retain list filters/search/page; list scroll is stored with the history entry. Calendar entries now use the same workspace, and their calendar date/view/expansion context survives browser Back. Non-job calendar entries retain their existing editor.

## Fewer steps to act

- One New job button opens essential customer/title/location fields. Notes are optional. Add first visit reveals scheduling, crew and duration only when needed; a single Create job / Create & schedule button commits the chosen operation. Existing atomic booking and conflict/permission checks remain. Retry uses the same request identifier and payload.
- A job card exposes its relevant next action: Schedule visit, Start job for an active due visit, Review visit for future work, Open checklist, or linked invoice/charge review. Past visits retain a status-review warning. Start uses the existing atomic status action; completed work still requires explicit review.
- Summary keeps one next-action prompt, call/directions and direct Add task, Add photo and authorized Log time shortcuts. Add photo opens the existing native picker in the user gesture; Log time opens the existing manual costing form. No upload or time entry occurs merely from opening these tools.
- Summary / Work / Billing / Records remain accessible throughout the workspace. Work opens the actual checklist, with direct section buttons for tasks/templates, visits/crew, materials and photos/expenses. Records opens activity directly. There are no intermediate category-menu or Back-to-category screens.
- Costs & budget and Cost review previously opened the same destination. One Costs & budget entry now contains the existing labor/expense review, time entries, budget and recorded-cost warnings. Invoices and change orders remain distinct. Finance-only access retains costing without exposing invoices.
- Job notes/information are inline on Summary. Occasional reminder, customer review request, cancellation/reopening and completion-review actions remain in Job actions. The second full Job details workspace and its repeated shortcuts are removed from product navigation. The underlying compatibility component remains for isolated legacy harnesses.

Completion still rechecks the current work snapshot. Remaining visits block completion, and existing unfinished-task/material/change warnings require acknowledgement. Completing a job does not send an invoice or record payment. Approved scope, deposits and canonical invoice paths remain intact. Role/module restrictions and unsaved-edit guards remain.

## Fin restored

The simplified document form's mobile CSS explicitly hid its existing task-level Fin helper. The button is restored in the original form header for both New Invoice and New Estimate. The header uses a grid so the wordmark, Fin and private-beta badge do not overlap at 320px. Opening/closing Fin preserves the invoice/estimate entries.

## Verification and limits

The [development receipt](evidence/2026-11-13-unified-job-management.json) records the current-source production TypeScript/build and 95 startup checks, 32 Chromium browser cases (24 Jobs/Fin plus eight shared document cases), 21 domain cases, seven management/phone component scenarios and shared PDF/document acceptance. All 32 unique browser cases are verified across a 29-pass main run and three passing bounded rechecks. Two whole-test timeouts and one corrected assertion of the generic retry guidance are recorded in the receipt; a clean single-run result is not claimed. Other listed checks passed. Actual synthetic phone captures are retained in `docs/reference/unified-jobs-*`. Chromium checks cover 320/390/430/1440 widths, direct actions, typed creation, booking, stable retries, list/Calendar history and Back, approved work, role limits, dirty drafts, completion rechecks and Fin. The tested 390px Jobs fixture has no axe WCAG A/AA violations; this is bounded automated coverage.

The new Chromium/WebKit workflow is configured for a future PR; it has not run. Local verification does not establish WebKit, physical-device, owner or live-provider acceptance. Several older broad browser journeys still assert the retired category menus/Job details path and require navigation migration before the full release suite can certify this candidate. Broader release regression remains a promotion gate; no beta release is claimed.

No hosted data edits, migration, provider activation, real customer message or charge is part of this implementation. All 51 launch task records and acceptance criteria are retained.
