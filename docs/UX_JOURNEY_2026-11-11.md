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

### Focused stack comparison

| Option | Fit, maintenance and rights | Authorization, data and lock-in | Running/support cost and decision |
| --- | --- | --- | --- |
| Existing React components, record tabs, customer picker and Supabase queries | Already implement the operational records and role-filtered views. Reuse preserves commercial product behavior and existing dependency licenses. Mobile grouping needs browser and device testing, not a new grid engine. | Existing server authorization remains authoritative. No new data processor or export format. | Existing hosting/database metering and application maintenance. **Selected for UI implementation.** |
| Deque axe Playwright 4.14.0 | Maintained dedicated accessibility engine; official package supports Node >=22.12.0. MPL-2.0 permits commercial use subject to its terms; preserve notices and covered-source obligations when distributing. Matches existing Playwright stack. | Runs against synthetic local browser pages in CI; no tenant credentials, new permissions or hosted Deque account. Results are ordinary JSON; remove the adapter without changing product records. | No license/subscription charge; CI time and false-positive/manual review effort remain. **Selected bounded development-only check**, with negative control; cannot certify keyboard, screen-reader or physical mobile usability. |
| SVAR React Gantt core | Official free core is MIT; advanced resource planning and scheduling are PRO. A timeline component alone does not prove a dispatch problem is solved or meet mobile/accessibility acceptance. | A frontend chart would still need our tenant-authorized adapters and canonical records. Export, keyboard and touch behavior would need a bounded prototype before selection. | Core license is free, integration/support are not; advanced features may introduce paid commitments. **Deferred: no demonstrated benefit over existing visits/crew views.** |
| Existing PostHog SDK error-tracking expansion | `posthog-js` 1.438.21 is already installed for tightly allowlisted consented analytics. Current code disables autocapture/session recording and rejects unlisted events; SDK presence is not active error monitoring. | Errors could expose URLs, tokens or customer details. Require an explicit scrub/retention/access/export design and verification of account settings before activation. SaaS retention/export and processor terms require review. | Existing SDK reuse avoids another runtime dependency, but hosted event usage, retention and alert support are not assumed free. **Deferred activation**, pending measured monitoring gap and owner-approved limits. |

Primary references checked November 11: https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/package.json ; https://github.com/dequelabs/axe-core-npm/blob/develop/LICENSE ; https://svar.dev/react/gantt/ ; https://posthog.com/docs/privacy . Candidate and package licensing must be checked again for any future selected version. No new hosted integration or permission was accepted in this batch.

Initial CI candidate `7791f08c3eb24cb27f44454efc9572c0c6f8512b`, full run `43045332828`: migration replay and four DOM shards passed. One WebKit shard found a partial accessible-name selector matching both attention regions; corrected to exact matching with all injection assertions retained. Home run `43045332582` found its old three-card expectation; updated to include the new fourth card while retaining surface, typography and overflow assertions. Full Node/browser jobs failed before tests on Ubuntu Azure mirror DNS while installing Poppler. CI now uses the official signed Ubuntu archive directly with bounded network retries and verifies both PDF utilities; no test is skipped. New Home fixtures also explicitly handle CORS/preflight and cover failure/retry. Final candidate validation remains pending.

### Job state → next action

The first applicable condition wins; existing permissions and completion override checks remain authoritative.

| State | Primary action |
| --- | --- |
| Work data unavailable | Disabled review guidance and retry; never imply readiness |
| Canceled | View history |
| Completed, billing allowed | Review charges, draft invoice, outstanding balance or paid history according to linked invoice state |
| Completed, billing restricted | View history |
| Read-only job access | Review work plan |
| Unbooked work | Schedule visit if permitted; otherwise review visits |
| No assigned crew | Assign crew if scheduling is permitted |
| Outstanding materials | Review materials |
| Pending/unbilled changes | Review changes for authorized billing users |
| Scheduled future visit | Review visit |
| Scheduled work ready to start | Start job |
| In progress with unfinished tasks | Review tasks |
| In progress with remaining visits | Review next visit |
| Work ready for completion review | Review completion; existing blockers and explicit override remain |

Completion review remains independently reachable for authorized in-progress work when the primary action opens a blocker. No action sends a message, assigns a login or automatically charges a customer.

## Final source review receipt

Functional candidate: `2b2de93301164790ddda08a21f96e9c5cdafbbd5`, PR93. Final Home run [43050923483](https://github.com/Velnu38/Velnu/actions/runs/43050923483) passes 49 existing regressions and all seven focused UX/accessibility tests. Synthetic desktop/mobile Home and mobile Jobs screenshots were inspected; the new work card follows the retained Financial Performance/attention pair, has consistent padding, and all four mobile group labels fit. Artifact `13870190080`, SHA256 `d2f4be9ca079bcf580e622df5d84d5bd28bf6bc241da1286056bc656ee9d9ad8`. Earlier failed visual/contrast assertions remain in run history; no rules were disabled.

Final build and 95 startup checks pass. Full local TypeScript suite: 648 passed, zero failed, one existing optional dedicated-PostgreSQL check skipped; later material-count wording passed the three focused policy tests. Existing management/execution/component DOM journeys and supplementary compact groups/completion/report-link checks pass. Assessment synchronization, eight tests and consistency validation pass.

**Not merged or deployed.** Full CI run `43050923668` has not passed. Prior attempts failed before PDF tests because runners could not resolve Ubuntu package repositories, including a direct official archive attempt (`43046845993`); full tests remain enabled. Local browser execution is also unavailable due to socket restrictions. No new migration, Edge deployment, provider activation or physical-device certificate. Live domains remain on `36fb325` / `dpl_9FNK5BTXgwpe5qxpcmPG2mWEgFSb`; beta branch rechecked unchanged. No charges, sends, permissions, seats or paid commitments changed.

Machine-readable stage distinctions, rollback and next batch: `docs/evidence/2026-11-11-ux-journey.json`. Restore CI package access, run the complete required checks on the release candidate, then merge and verify the private-beta frontend deployment. Keep provider, physical-device and public-launch gates open. This documentation-only receipt follows the repository assessment publisher's `[skip ci]` convention; it is not a CI pass and does not authorize release.

### CI infrastructure follow-up

Commits `31c47876d1eb94a6cb56c0900c83702c89572fe7` and `01d76a83c42e4f28f5d5cc095ad827b4625eabe5` preserve the supplied runner proxy through signed apt installation, make update errors fail immediately, and reuse the existing pinned Playwright image for native handoff, pricing and customer-prediction workflows. All tests remain enabled. These changes require no application, database, provider or account-setting changes; revert the workflow/helper commits to roll back. Hosted validation remains pending.

Supplemental local JavaScript release checks at `31c4787`: 212 passed, zero failed/skipped. The initial direct invocation lacked the generated recovery build and failed three imports; running the repository prerequisite `npm run test:recovery` passed 72 recovery tests, then all 212 JavaScript tests passed. This does not replace full hosted/browser acceptance. Beta branch and live frontend were independently rechecked at `36fb325` / `dpl_9FNK5BTXgwpe5qxpcmPG2mWEgFSb`; PR93 is unmerged and the UX candidate is undeployed.

### Browser regression selector repair

Full run `43112291926` finished with successful package installation. Browser shards 5/6 and 6/6 found three Settings assertions still scoped to the removed Setup and connections group and one completion assertion still using Mark complete. Tests now exercise the approved groups and Review completion, retaining tier visibility, completion confirmation, exact invoice handoff, single completion mutation and no-send assertions, with additional exact Settings destination checks. No application behavior or acceptance criterion was removed. Local Chromium was attempted but failed before test execution on process-singleton socket permissions; hosted browser validation is required. Repaired candidate is not yet merged or deployed.
