# Calendar connection resilience and acceptance

Step 16 continues from the verified private-beta release f82f9901daf3c21edf6e37efd57cae4b9bc249a7. All five workflows triggered for that release completed successfully, including complete automated checks. Beta migration inventory contains 145 versions through 20261110205954. This change requires no migration, OAuth scope change, credential edit or provider activation.

## Confirmed defects and correction

Microsoft Graph SDK 3.0.7 attaches response headers directly to GraphError. The classifier previously inspected only Google's response.headers shape, so a Microsoft 429 with a 450-second Retry-After could become the default 60-second delay. The classifier now reads both SDK shapes. The worker regression uses an actual Graph-shaped error and verifies the queue waits at least the requested interval and the next invocation makes no provider call. Invalid dates fall back safely and the existing one-day maximum remains.

Both writable-calendar selectors previously relied on the count of returned writable items to bound pagination. Repeated or endlessly empty pages could therefore keep making requests. They now detect repeated cursors and cap each listing at 20 pages, failing with a clear error rather than returning an incomplete list. Outlook also requires its next link to remain on the exact approved calendar collection, with no URL credentials or fragment. Opaque cursor query bytes are preserved. Tests cover empty pages followed by valid data, writable filtering, repeated cursors, nonrepeating empty pages and foreign/unrelated routes.

## Scheduling semantics

Finviant publishes scheduled work to the selected external calendar and displays the signed-in user's selected calendar events for reference. Imported personal events are scoped to both user and business and do not become shared jobs or crew availability. Existing outbound work is excluded from imported events to avoid showing duplicates. External edits do not update Finviant jobs/invoices.

Customer appointment options are checked against Finviant working hours, dated time off, crew assignments, appointment conflicts, notice and buffers. They do not include external personal-calendar busy time. Settings, the connected-events view and owner booking review now state this explicitly. This change does not claim conflict-free combined availability or broaden access to coworkers' personal calendars. An external busy-time integration needs a separate approved worker/account mapping and fail-closed freshness design before it can be advertised as part of server booking enforcement.

## Observed beta state and validation

Read-only review found one Outlook connection, auto-sync enabled, no recorded error and last successful sync 2026-11-10T23:26:00.189119Z; no Google connection. The calendar queue has zero pending, leased or dead entries. This confirms the earlier worker recovery, not a new consent/reconnect/revoke exercise or proof of event delivery for this change.

Local calendar TypeScript, application build/startup and calendar build checks passed; all 45 calendar tests, 89 deployment tests and eight assessment tests passed. The local browser run could not launch: the Playwright headless binary was absent, and installed Chromium failed its Unix-socket sandbox check (EPERM). Those 22 attempted browser scenarios are not counted as passed locally; they must run in CI. The release must also pass the complete CI candidate, including calendar and guided scheduling checks at desktop/mobile widths, before merge. Synthetic provider responses are not live-provider certification. The review branch is excluded from automatic hosted deployment and blocked by the environment guard.

Remaining CAL-01 acceptance includes owner-controlled Google client configuration and consent, separate live provider calendars/accounts, refresh/reconnect/revoke and external-event behavior on actual devices. SMS readiness is separate and remains blocked; no email/SMS was sent in this calendar work.

## Release and rollback

Merge only the validated candidate into ux/private-testing-20261029 and verify the exact READY deployment, both domain aliases, unchanged private-beta restrictions and calendar queue state. No hosted database changes are needed. Roll back to the preceding compatible frontend/server deployment if needed; preserve credentials, mappings and queues, and never force recreation of uncertain remote events.

Official references checked November 10, 2026:
- https://learn.microsoft.com/en-us/graph/paging
- https://learn.microsoft.com/en-us/graph/best-practices-concept
- https://developers.google.com/workspace/calendar/api/guides/pagination
- Installed @microsoft/microsoft-graph-client 3.0.7 GraphErrorHandler and GraphError declarations (top-level response headers).
