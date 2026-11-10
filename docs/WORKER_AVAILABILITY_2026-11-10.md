# Worker availability: isolated review

Manager-operated scheduling UI improvements, based on release 6cacfe7cfc1f9b02c3eec2a9d9ed1e53e78504b1. This branch does not include the customer-reminder branch or multi-visit PR69. PR69 head373fba6 was reviewed for changed-file overlap: it does not modify the worker/availability settings components or their existing service contracts.

## Workflow

Settings → Team Management → Availability puts worker selection, normal weekly hours and time-off exceptions in one place. An all-worker date summary and a seven-day business-time-zone calendar show normal hours and saved time-off blocks, with quick selection of a date for an exception. Worker-specific weekly hours use existing worker profiles and optimistic concurrency; business defaults and the existing scheduling constraints remain authoritative.

The calendar is a roster view, not a promise that a time is bookable: existing appointments, jobs, buffers and other constraints are still checked by the scheduling backend when booking. The existing context only returns upcoming time off within 60 days, so navigation must remain within that supported window. Partial-day exceptions and DST must not be represented as whole-day leave or fixed UTC days.

No employee invitation, self-service leave approval, leave balance/accrual, paid service, notification, database migration or permission expansion is introduced. Existing manager rights and plan limits remain in place. Worker profiles remain separate from account users.

## Acceptance boundaries

Local pure-logic, DOM, scheduling regression and TypeScript/build receipts belong in the companion evidence file after execution. No live deployment or physical-device acceptance is implied. Responsive layout and keyboard/label semantics are appropriate for the future iOS/Android wrapper, but App Store/Play packaging, native notifications and store privacy declarations remain separate work.

Before integration, reconcile the assessment-registry entries with other open branches instead of overwriting them. Recheck release/PR69 head and signed-in mobile behavior before live rollout.

The installed Chromium browser could not launch in this executor because its process socket was denied. The optional layout test is prepared, but browser screenshots and overflow assertions are not claimed as passed.

Independent review passed the five new logic tests, three existing worker API tests and focused DOM journeys. Dirty drafts survive unrelated saves and read failures; stale worker edits use the original expected timestamp. Business-wide preferences retain their existing API without optimistic revision checking. The old Team Management DOM test has an unrelated exact-link-text mismatch, reproduced on untouched release6cacfe7.
