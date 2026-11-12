# App-wide Job Management visual scheme

Owner authorized November 12: apply all three mockup boards throughout the signed-in workspace, without functionality changes. Private beta must stay on its current release until rendered comparisons and required checks pass. PR97 and the sequential feature queue remain paused.

## Design contract

Use the released PR102 Job Management font, navy/teal palette, mint selected state, 12px cards, 10px controls, 44px minimum action targets, full-width phone shell and safe-area spacing. Generated images illustrate composition, not replacement data or new controls. Preserve meaningful content that a mockup omits, including calendar modes/chart drill-downs, customer records, status-dependent actions, timestamps, permissions, notices, worker availability and account access. Do not restyle issued PDFs or customer document branding. Existing inline editors stay inline; existing dialogs fill phone viewports.

## Screen map

| Area | Existing destinations retained | Visual treatment |
| --- | --- | --- |
| Home | Calendar modes and entries, Financial Performance and drill-down/chart, Needs Attention, work attention, payment reviews | Shared outlined cards, mint headings and consistent readable controls |
| Quick Links | Invoice, estimate, job, reminder; business card, customers, team | Work-style create tiles and Records-style destination rows |
| Jobs | Overview/List/Board, directory filters/search/paging, details and Management | Shared shell, directory cards and controls; approved Management remains reference |
| Documents | Invoice/estimate lists, summaries/filtering/paging, creation/review, Details/Photos & expenses/Activity, existing actions | Summary hierarchy, consistent rows, tabs and full-screen phone dialogs |
| More | Customers/Schedule/Support; Company/Team; Documents/Delivery/Reminders; Connections; account destinations | Same groups/links with outlined icon-divider rows |
| Team | Workers, Availability, Account Access and existing inline worker form | Shared controls, readable profile cards, unchanged separation |
| Subsequent pages | Customer detail, schedule/reminders, bookkeeping/payments, company/document/delivery/reminder/calendar/storage/archive/support/plan/subscription settings | Same typography, surfaces, controls and responsive forms |

## Verification

Pending hosted Chromium/WebKit screenshot comparisons and required CI. Local Chromium was attempted and cannot create its process-singleton socket in the executor. Hosted fixtures use synthetic records and intercepted services; they do not certify actual phones or live providers.

Reference boards are in `docs/evidence/2026-11-12-workspace-scheme/`. The focused browser suite captures main screens at 320, 390, 430, 768 and 1440px, document details/editors, and subsequent destinations. Existing browser suites retain functionality/permission/unsaved-edit coverage. Release evidence will be appended only after actual verification.

## Resumed verification — November 12

- Remote beta head freshly verified as `c614324a71faba24caeefb75791069b97b75c7d9`; candidate `58bbb82` and all three reference boards survived the chat transition.
- Corrected `.invoices-module` to the rendered `.invoice-module` in the summary styling and screenshot readiness selector. No business logic changed.
- Local build completed during the browser test startup. All 95 startup/deployment checks, all 39 operations tests, the operations DOM checks and all 10 assessment checks passed.
- All eight workspace browser cases stopped at browser launch: Chromium process-singleton `socket()` returned `Operation not permitted`. No screen comparison or browser acceptance is claimed.
- Candidate branch publication was blocked by automatic approval review, citing the publication hold and external GitHub destination. No workaround or beta release was attempted. Explicit approval to publish the candidate for hosted CI is required to proceed; beta release remains gated on actual rendered review and required checks.

Owner explicitly authorized candidate publication and completion in this chat on November 12. Hosted CI publication may proceed; beta release still requires rendered comparison and successful required checks. Automatic Vercel deployment is disabled for the candidate branch.
