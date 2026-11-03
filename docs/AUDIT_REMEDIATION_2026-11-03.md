# Flow and friction audit remediation — November 3, 2026

Implements recommendations F01–F40 from the source-based flow audit. Source baseline: d97939f09682e063ede6e82dbca8095cb6ed1082. Release verification requires the complete automated suite, merge and protected deployment. See the ongoing assessment for the final evidence and release identity.

| Audit IDs | Resulting behavior |
| --- | --- |
| F01 | Existing draft invoice/estimate opens a prefilled editor; atomic version-checked update preserves document ID, issue date and creation history. Historical due dates cannot precede issue date. Issued documents keep change-order safeguards. |
| F02 | Customer records and invoice/estimate reviews offer customer contact editing. Missing-email repair returns to the same document. Updates check the reviewed customer version. |
| F03–F04 | Shared native dialogs protect edited forms on dismissal and workspace navigation. Settings sections retain mounted editors when collapsed. Busy saves block dismissal. Browser reload warns while unsaved work exists. Draft contents remain in memory; automatic disk persistence is not introduced. |
| F05 | Invoice follow-up uses shared stable-ID reminder creation, validates content, retains invoice/customer associations, and announces calendar changes. |
| F06, F10 | Quick/voice invoices load saved tax and payment defaults; new contact plus document is one atomic save, with a stable request ID. Standalone customer creation uses a retry UUID. |
| F07 | Job notes compare the original description, reject overwriting concurrent edits, retain failed edits, and recognize a previously successful retry. |
| F08 | Legacy administrator role is preserved during module changes. The database only permits retaining admin for an existing admin; it does not permit promoting another role to admin. |
| F09, F34 | Customer approval load errors offer Retry and replacement-link guidance. Decline names the document type and confirms the recorded decision. |
| F11, F25, F35 | Location creation supports stable-ID retries, inline Save & use location, and a selected-customer management link. Scheduled new jobs require an address or an explicit unspecified-address acknowledgment. |
| F12 | Shared line editor has persistent labels, distinct accessible names, a 50-line bound, and Undo removal. |
| F13 | Assistant handoff includes event/reminder intent, selected time, timezone and worker. The manual draft remains open underneath. Oversized handoffs explain how to continue manually. AI interpretation still requires review. |
| F14 | Standalone calendar entries offer confirmed Cancel event, with reviewed-version checking and a retained record. Linked work stays managed through Jobs. |
| F15 | Multiple-amount quick invoices offer Open full invoice form and carry the dictated request for manual charge review. |
| F16 | Selecting a saved contact makes its name read-only; switching to a new customer is explicit. Company name has a separate field. |
| F17 | Destructive document actions retain consistent dimensions with restrained danger styling. |
| F18–F19 | Email, assistant, navigation, calendar and scheduling dialogs use native focus containment, Escape handling and focus restoration. Mobile More exposes expanded/dialog semantics. |
| F20–F21 | Clipboard failure selects the link and provides manual-copy guidance. Valid approval links are reused within the current session after checking validity. New link creation warns before replacing earlier links. Tokens are not persisted to disk. |
| F22–F23 | Job completion/cancellation describes and confirms its consequence. Unquoted job-to-invoice entry starts from the job title, so internal notes/materials are not automatically copied into a customer-facing charge. Office review remains required. |
| F24 | Existing invoice-linked work has a direct Open linked job link; closing scheduling refreshes invoice context. |
| F26–F27 | Customers, payments and locations use bounded lists with complete-list search. Payments add date filters and unpaid-invoice search. Confirmed payments show a separate receipt state even if refreshing fails. |
| F28–F29 | Calendar disconnect explains published-event cleanup before proceeding; blocked-time removal identifies the worker/date and confirms availability impact. |
| F30–F33 | Company details save directly without optional-service steps. Creation actions say Save draft. Email success distinguishes provider acceptance from delivery. Customer job dates use business timezone. |
| F36–F40 | Duplicate attention filtering is reduced; financial drill-down and CSV export have clear scope labels; worker filter explains shared reminders; keyboard dictation guidance is device-neutral. |

## Verification limits

The report describes implemented behaviors, not a claim of live provider delivery, real-device voice validation, or complete mobile-store readiness. Existing provider and entitlement gates remain in force. Private access must remain enabled on finviant.com and www.finviant.com. External emails, payments and customer approval decisions are mocked in browser regression tests; staging database checks must roll back.
