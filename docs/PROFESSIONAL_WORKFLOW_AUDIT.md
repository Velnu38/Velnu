# Professional interface and workflow audit — November 3, 2026

## Scope and evidence

The source inventory covers every TSX module and every JSX button, link, input, select, textarea and disclosure summary. See [the complete control inventory](INTERFACE_CONTROL_INVENTORY.md) for individual source lines, labels and handlers, and its JSON companion for machine-readable review. Re-run `node scripts/qa/interface-inventory.mjs` after interface changes. Definitions inside maps represent repeated controls; the inventory count is not a count of clicks or live records.

Source review is distinct from runtime verification. The new audit exercises eleven authenticated routes and eight public/account-entry URLs at desktop and 390 px widths. It checks runtime errors, visible button names and horizontal fit, and captures each route at both widths for visual review. Focused desktop and phone tests exercise one-click creation, preserved drafts after backdrop taps, native Escape dismissal, and adding a customer within a job draft. The full existing browser suite remains enabled, including voice mocks, customer approvals, recovery, onboarding, records, permissions and financial workflows. Final CI results and hosting identity are recorded in the change request and the ongoing assessment.

## Changes

| Finding | Delivered behavior |
| --- | --- |
| Dashboard creation required navigating into a list first | New invoice, New estimate and New job open their forms from dashboard links in one click. Internal app links preserve the running session/document rather than reloading the app. Keyboard modifiers, downloads, external links and separate-tab links retain native behavior. |
| Native customer selection obstructed new job entry | Add and select a customer within the job draft while preserving scope and scheduling fields. This explicit contact action creates a customer record; invoice/estimate typed contacts retain their existing atomic document-save behavior. |
| Inconsistent overlays; accidental backdrop dismissal | Shared native form dialogs provide an accessible name, modal focus containment, Escape handling and focus restoration. Backdrop taps preserve drafts. All dialog form controls are disabled while saving, including Cancel/Close. Applies to invoice, estimate, conversion, job, customer, location, payment, follow-up, change-order and workbook-entry forms. Read-only previews and specialized existing dialogs retain their appropriate behavior. |
| Conversion ended at a refreshed estimate list | After conversion, the resulting invoice opens directly. Created estimates open their document preview. Document URLs and creation intent consumption are synchronized with the visible screen. |
| Icon actions lacked meaningful names | Close and remove-line controls have explicit accessible names and button types. Visible control names are also checked on route audit screens. |
| Control styles differed across modules | Shared screen-only workspace styles align primary/secondary buttons, card borders, heading scale, focus rings and icon hit areas. Mobile inputs use 16 px text to avoid forced iOS input zoom. Existing print-document styling remains separate. |
| Timezone behavior differed in older screens | Legacy Schedule entry/ranges and invoice follow-up entry use the business timezone. Reminder dates display in that same timezone. Impossible local times still fail validation. |
| Repeated submits could open duplicate attempts | Same-tick guards protect customer creation and both payment-recording forms. Existing atomic financial/idempotency safeguards remain unchanged. |
| Document settings offered logo uploads without checking plan access | Hosted uploads now follow the same backend entitlement check as onboarding; free company-name branding, color and footer editing remain available. Settings saves prevent same-tick duplicate submissions. |
| Terminology differed | Payments links to Financial performance using the workspace's existing product terminology. |

## Page-by-page disposition

| Page/surface | Review disposition |
| --- | --- |
| Dashboard | Quick creation, single attention area, financial drill-down, calendar and accessible actions reviewed; protected by regression and route tests. |
| Estimates | Typed/saved customer, site selection, tax/line validation, terms, preview/print, approval, conversion, scheduling and change-order actions inventoried. Shared form and conversion handoff improved. |
| Invoices and detail | Creation, totals, payment destinations, status, notes, reminders, change orders, print and payment recording inventoried. Existing document review after creation preserved; payment/follow-up forms aligned. |
| Jobs and shared detail | Timing groups, search, crew dispatch, notes/materials, photos and expenses inventoried. Quick entry and inline contact creation added. Shared calendar/Jobs editor retained. |
| Schedule and calendar | Week/month, dates, manual entries, crew filters, resource availability and legacy appointment actions reviewed. Business-zone consistency corrected. |
| Reminders | Creation, association, completion, status filter and paging reviewed; business-zone display aligned. |
| Customers and detail | Search, import review, creation, detail, properties and maps reviewed. Search naming, submit guard and property dialog improved. |
| Locations | Search, selected location, maps/directions and customer management controls reviewed. Address sharing remains explicit; embedded maps still require provider setup. |
| Payments | Invoice selection, default balance, amounts, methods, recording confirmation and workbook destination reviewed. Double-submit and form behavior improved. |
| Financial workbook | Source switching, filtering, exports, manual entries, deletion and QuickBooks controls reviewed. Entry dialog aligned; irreversible/account/provider confirmations retained. |
| Settings | Company, documents, team, calendar, scheduling and cancellation disclosures reviewed with role/module guards. Provider setup/errors remain explicit. |
| Landing and service selection | Links, FAQ, service choices and signup paths inventoried; public route audit and existing marketing tests provide runtime coverage. |
| Authentication and recovery | Sign-in/signup, confirmation resend, reset and recovery actions inventoried; existing mocked recovery/onboarding tests retained. No real email delivery certification. |
| Plan, agreement and business onboarding | Required consents, optional payment setup, business fields and progression reviewed. Legal acceptance is intentionally not skipped. |
| Customer approval | Scope/terms, explicit consent, acceptance/decline and unavailable-link states reviewed; mocked customer tests retained. |
| Customer booking | Slot choice, conflict recovery, confirmation and ICS actions reviewed; existing mocked booking tests retained. |
| Team invitation | Current-account selection and explicit joining reviewed; existing role/invitation tests retained. |
| Legal, terms, privacy and install | Public routing, labels and responsive readability audited; no legal terms changed. |
| Compatibility/unused modules | JobsSchedulePage is a compatibility export. PlaceholderPage and WorkspaceServicesPage are not active AppShell destinations; inventory presence does not imply a user-facing feature. |

## Friction targets and limits

From the dashboard, opening an invoice, estimate or job draft now takes one click instead of selecting a module and then its create action. These are navigation clicks, not a promise to complete a document without entering required customer/work/price fields. Saving an invoice continues to open its review, saving an estimate now opens its preview, and conversion opens the resulting invoice. Existing business tax and payment defaults remain reusable. A confirmed customer appointment still creates the linked job and calendar record; the attention queue removes its scheduling action.

Keep confirmations where the action records payment, changes issued documents, deletes data, accepts terms or sends customer communications. Remove duplicate navigation and unnecessary internal review, rather than weakening financial or customer authorization boundaries.

The source audit and mocked browser checks do not establish that every production provider, every possible data state, every role or every physical device works. Live signed-in inspection, actual external email/SMS, calendar OAuth, provider payments, live voice output and physical-device behavior remain distinct verification work. Existing private-access and customer-delivery gates stay in place. Native Tap-to-Pay, bank/OCR matching and other previously documented strategic requirements are not implemented by this interface pass. Calling the app the market's best would require observed usability results and validated provider operations; this report makes no such certification.
