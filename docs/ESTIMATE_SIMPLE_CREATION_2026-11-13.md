# Simplified estimates — November 13, 2026

Owner approved the four-screen proposal and requested deployment to Finviant beta. The separate estimate branch follows the invoice implementation and preserves estimate-specific approval, expiry, scheduling and billing rules.

Create estimate remains a single prominent action at the top, full width on phones. Pending estimate value is a noninteractive summary of draft and sent estimates only. One Customer approval disclosure combines awaiting and approved counts without combining their monetary values; its filters preserve the distinct statuses, including converted records within approved. General filters retain All, Draft and Declined / Expired.

The creator shows customer, description and amount, quantity initially one, and one Add item chooser for manual items, saved services or packages. More options contains validity (one custom-date input only when needed), issue date, tax and item overrides, customer reference, internal note, customer-facing terms and service property. Existing thirty-day validity defaults are preserved. Internal notes and customer terms remain separate. Save draft bypasses review and needs no delivery contact.

Review publishes one canonical saved draft, displays estimate number, total, validity and customer-facing terms, and offers available direct Finviant Email/SMS actions. It retains PDF/export, personal-app fallback, recipient verification, stable send operation/revision and SMS consent. Opening review never sends. Going back edits the same draft. Server permissions and provider readiness remain authoritative.

Saved estimates retain one lifecycle-based main action. Activity and Photos & expenses are reached through their existing tabs; duplicate action-menu/phone shortcuts are removed. The linked job is reached once through the main Open job action or More actions when another action has priority. Draft/sent delivery is reached through Send estimate / Follow up, without a second Sending options entry. Approval links, manual acceptance, revision, change orders, deposit accounting and explicit final-invoice creation remain distinct. Scheduling retains its existing Schedule job label and actual scheduling review, rather than pretending job creation alone books an appointment.

Validation uses synthetic service responses and Chromium/WebKit automated review. Physical-device, owner and live-provider acceptance are separate gates. No migration, hosted data change, provider activation or real customer send/charge is part of this release.
