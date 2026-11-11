# UX journey implementation — November 11, 2026

Baseline: `36fb3254a347381c581ff8f247f2ea1df97af976`, private-beta branch. Concurrent open PRs were checked before editing; no newer UX candidate superseded it. Original 28-package brief, latest handoff, current registry and approved component review remain the scope. No acceptance gate is closed by this candidate.

## Small batches and compatibility

1. Job next-action policy: unavailable/read-only, missing crew/materials, changes/tasks, future and remaining visits, completion, canceled and paid states. An authorized completion review stays reachable as a secondary action; its existing checklist, fresh-data check and override remain unchanged.
2. Home: reuse `get_job_management_page` with attention filter, ten jobs per page, authoritative total and checked time. Calendar and Financial Performance remain. Each job appears once; billing and waiting-for-customer queues remain distinct. Failed work queries do not appear empty. No schema migration.
3. Quick Links: Create versus Go to / Share groups retain all existing destinations, E-Business Card and Team Management. Existing page-level creation shortcuts remain.
4. Customer selection: retain shared picker, inline creation, bounded Jobs search and document/Fin matching. Expose document loading/failure/retry instead of false no-match results. Existing full document customer loading is retained because Fin matching/contact editing depend on it; a broader query conversion needs separate coverage rather than duplicate requests.
5. Documents: clarify draft preparation versus saved PDF review; retain exact renderer, stationery, revision checks and explicit delivery. No PDF design or financial calculation change.
6. Jobs directory retains List/Board/Overview and filters; Manage job and Job details identify their different purposes. First use opens directory; remember later tab choice using a versioned user/business key. Explicit URLs, new-document intents and customer scope win. Mobile groups: Summary (Overview), Work (Tasks, Schedule & Crew, Materials, Photos & Expenses), Billing (Billing, Changes), Records (Activity, Completion Report). Existing section IDs remain; report deep links now resolve explicitly.
7. Settings: group Business & team, Documents & delivery, Connections; existing URLs and plan/role checks remain. Worker profiles and account access are described separately. Existing configured/connected/enabled provider controls are retained, not replaced with assumed readiness.

## Journey and measurement

Customer/site → estimate scope → saved canonical PDF → explicit send/approval → existing approved-work handoff → visits/crew/tasks/materials → reviewed costs/changes → completion review → invoice/deposit review → explicit send → server-verified payment. Direct invoice and manual job paths remain.

Source baseline: Quick Links → chosen creation form is two actions and remains two. Directory had competing Manage/Open job labels; now Manage job/Job details. Mobile previously exposed nine peer sections; now four area choices with their existing sections. Completion guidance previously described remaining tasks but primarily offered completion; the primary action now opens the blocker and preserves a separate completion review. These are control counts/source facts, not measured physical-phone productivity gains. Browser journeys verify preservation and rendered fit; real timing and device acceptance remain open.

## Validation and rollback

Run build/startup, action-policy tests, existing management/execution DOM journeys, full CI, and new scoped WCAG axe/browser tests. A synthetic unnamed button proves the engine detects a fault. Capture synthetic Home and mobile job screenshots for review. Existing financial, role/tenant, concurrency, document and migration suites remain enabled. Local Chromium cannot launch in this environment (socket permission); browser acceptance must come from CI, never a claimed local pass.

Rollback: revert frontend/test commits or restore prior beta frontend. No migration, live records, provider settings, seats, worker entitlements or Edge function versions change. Hosted services retain existing metering; no paid commitment is introduced.

## Dependency decision

Reuse existing React components. `@axe-core/playwright` 4.14.0 and its axe-core dependency are development-only under MPL-2.0. Preserve upstream license notices and source availability when distributing covered code. No paid Deque service is used. CI execution/support effort remains a cost even though there is no license/subscription fee. References: https://playwright.dev/docs/accessibility-testing and https://github.com/dequelabs/axe-core-npm/blob/develop/LICENSE . Automated checks do not certify all accessibility or replace manual screen-reader/keyboard/device tests.

No SVAR, Gantt, crew timeline, Sentry or PostHog error-tracking activation is included. The timeline lacks demonstrated dispatch benefit; monitoring needs separately verified consent, scrubbing, retention, alerts and budget. GROW-02 expansion remains separate. Assigning a roster worker does not invite, notify, grant login, consume a seat or enable self-service.
