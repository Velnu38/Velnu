# Business card, jobs and recurrence verification

November 12, 2026. Base: `7875381` on `ux/private-testing-20261029`. Candidate branch: `fix/business-card-job-billing-verification-20261112`.

## 7. Business card

Implemented an opt-in stable HTTPS card address with an opaque public UUID separate from the business ID and expiring bearer links. Only the primary Pro owner can publish, explicitly publish reviewed updates or unpublish. Publication does not happen on migration, card save or download. Existing snapshot previews, contact fields, external website, call/email, native contact sharing, managed-delivery gates and saved-send recovery remain. The first standard vCard URL is the stable card; the external company website remains a second standard URL. Unsupported custom contact labels are not assumed.

The live route supports call/text/email, contact download, native link sharing/copy fallback and an estimate request. Requests are bounded to 160-character names, 254-character emails and 2,000-character descriptions, reusing the shared distributed public-link limiter with a per-card ceiling of 20 stored requests/hour. Request IDs and content fingerprints prevent changed or duplicate retries. Valid requests create tenant-scoped inbound received messages and appear as the latest 20 estimate requests in the card editor. No customer, approved estimate/job, outbox send or charge is created. No public response includes leads or private address fields. New email attachments freeze the same stable URL; retries retain previously frozen bytes.

Targeted verification:

- 16 SQL tests across `business-card-live`, `business-card` and `business-card-links`: stable URL after explicitly published edits, address privacy, Pro/owner/staff/anonymous/foreign-business rejection, unpublishing, standard website fields, Unicode contact parsing, bounded lead routing/idempotency, frozen email attachments and existing email/SMS activation/replay behavior.
- Existing card editor and delivery DOM checks passed. Added publication/unpublication assertions to the editor suite.
- New public-card DOM check passed: call/text/email/contact/share availability, same-ID request retry, review-only result and fresh unpublish denial before download.
- Added populated 320/390/430px Chromium/WebKit browser cases. Local Chromium was attempted and failed at process-singleton socket creation (`Operation not permitted`). Hosted browser and full-schema migration replay are release prerequisites, not claimed as passed locally.

Separate acceptance: actual iPhone Contacts and Android/Google Contacts website retention/tapping, native same-phone sharing, signed-in hosted owner-business review, public ingress/IP/invalid-ID abuse protections, and deployment verification remain open. Existing saved contact copies do not acquire new fields; they must be downloaded/imported again. New publication/request metadata is not yet added to the versioned owner-archive catalog; inbound request messages are already covered. This archive-catalog follow-up is retained under EXPORT-01. No live publication, hosted migration, provider activation or customer message occurred.

## 8. Jobs and crew

34 targeted SQL/logic cases passed across job management/execution, management approval, worker availability/profiles, deposits and operations billing. Nine job-management/execution DOM scenarios plus Team Management and worker-availability DOM suites passed.

Verified approved-estimate handoff creates/reuses one job; editable tasks/templates and materials preserve stale-write/retry guards; multi-visit crews and conflicts/rescheduling/completion retain the exact job; worker profiles, limits, inactive history, hours and leave remain distinct from login memberships/seats; linked photo metadata and quota reservations reject foreign/revoked access; expenses/time snapshots, budgets, duplicate-cost exclusion and missing-cost indicators remain; approved changes and deposits feed one reviewed final invoice; immutable completion reports preserve private selected photos. Existing restricted-account permission tests do not activate worker accounts or change the manager-operated profile model.

No verified implementation failure was found in these suites. Synthetic SQL/PGlite and DOM evidence does not certify real tenant sessions, actual Storage uploads, device cameras, physical phones, live-provider behavior, complete-schema integration or accounting profit. JOB-01/JOB-02/JOB-05 remain open for their broader criteria. PR107 and app-wide layout work are untouched.

## 9. Recurring visits and progress billing

Three new database lifecycle tests and the existing recurring owner DOM suite passed. The tests execute the deployed source functions and tier-aware replacements. They verify:

- One occurrence/draft on repeated processing and one plan for an unchanged creation request; changed replay payloads fail.
- Pause prevents generation; resume skips missed past dates. Existing booked visits and invoices remain unchanged, as the UI confirmation states.
- Monthly anchors retain January 31 → leap-year February 29 → March 31.
- Existing schedules retain their stored time zone when the company time zone changes. A company-setting edit does not silently move booked visits.
- Worker/foreign-business rejection and rejection of deposit-adjusted recurring templates.
- Review-first draft generation with no message, provider call or charge.

The review identifies remaining product gaps, not passed features: there is no dedicated single-occurrence skip, owner cancellation/end command, explicit series time-zone edit/reschedule workflow, or quantity-based progress-to-final billing ledger. Unsupported skip/cancel/end statuses are rejected by the checked RPC. End dates can naturally end a series; they are not equivalent to an owner cancellation action. Existing deposit/partial-payment/approved-change/final-invoice tests and separate Stripe/Square refund tests passed, but they do not certify a missing progress-billing allocation system. Keep JOB-02/REC-01 open. No autopay or dispatch was introduced.

## Validation and release boundary

TypeScript, production build with all 95 startup checks, assessment sync, all 10 assessment tests and assessment check passed locally. Hosted browser cases and full migration replay are tracked separately. Local logs are transient; source-controlled tests and PR CI are the durable receipts. Apply the additive stable-card migration before deploying its matching frontend only after required checks. Automatic candidate deployment is disabled. Do not overwrite current Home/Job Management layout work or activate messaging/payments/public launch.
