# Finviant calendar and daily dashboard

Implemented November 2, 2026. Stack: Node.js 24 / TypeScript, React / scoped Tailwind utilities, existing Supabase PostgreSQL, official Google Calendar and Microsoft Graph SDKs. This is one-way publishing from Finviant to the user's chosen Google and/or Outlook calendars.

## Delivery and release status

The code and migration implement the dashboard widget, document scheduling, OAuth routes, provider services, durable reconciliation worker, and automated tests. Live OAuth and provider behavior require configured Google/Entra applications, server secrets, a running worker, and real-account acceptance tests. Do not equate a successful mock test or build with verified production readiness. Private access and hidden billing remain in place.

## Product behavior

- The dashboard opens on today in the business's IANA time zone. A week strip and date picker show work overlapping the selected day; pending reminders due by that day include overdue work. Reminders can be completed from the dashboard by authorized writers. It reloads every minute while visible and on window focus; data is never fabricated for an empty day.
- Settings has separate Google and Outlook cards, authenticated OAuth connection buttons, connected email, writable calendar choices, a connected badge, the requested auto-populate toggle, retry and disconnect controls. Connections are per user **and** business. Auto-sync defaults off until the user saves it on.
- An estimate preview or invoice detail offers scheduling with title, calendar-safe description, start/end, and Scheduled, Planned (estimate only), or Cancelled status. Planned estimate work becomes publishable on `accepted`, the existing database's term for Approved. Approval without an actual time range never invents an appointment.
- Financial and scheduling states stay separate. Paid does not cancel scheduled work. Declined/expired estimates, void invoices, cancelled schedules, cancelled jobs, and cancelled/no-show appointments remove their published event.
- A job's appointments take priority over its summary dates. Documents already linked to a job must be scheduled in Jobs & schedule. Estimate conversion keeps the same schedule source key and updates the deep link to the invoice. An explicit invoice schedule supersedes its originating estimate schedule.
- Only Finviant-created mappings are deleted. Turning auto-sync off removes those published events. Changing target calendars removes old-target events before creating new-target events. Disconnect queues cleanup, then erases credentials. If consent is revoked, reconnect to finish cleanup or explicitly erase credentials and manually remove remote remnants.
- No attendees are supplied, so the service does not send invitations to customers. A shared calendar's existing audience can see its event descriptions; only put calendar-appropriate information in them.
- Changes made directly in Google or Outlook do not update Finviant. This does not check availability or prevent double bookings. Reminders remain internal; external publishing covers scheduled work.

## Database contract

Migration: `supabase/migrations/20261102144435_calendar_sync_dashboard.sql`.

| Requested entity | Finviant implementation |
| --- | --- |
| users | Existing `auth.users`, managed by Supabase Auth |
| organizations | Existing `public.businesses`; membership/role in `public.business_members` |
| client details and money | Existing `customers`, `estimates`, `invoices`, and item tables; exact numeric totals remain under existing financial rules |
| scheduled start/end/status | `public.document_schedules`, with composite tenant/document foreign keys, timezone validation, valid interval constraint, and financial-role RLS |
| estimates_invoices | `public.estimates_invoices`, a `security_invoker` compatibility view mapping existing financial and schedule states to Draft, Sent, Scheduled, Approved, Paid, Cancelled |
| calendar_integrations | `private.calendar_integrations`; provider, user/business, account/email, selected calendar, auto_sync, connection status and encrypted credentials |
| calendar_event_id | `private.calendar_event_links`, one mapping per integration/source/calendar; supports both providers and multiple users without overwriting a single document column |
| daily work projection | `public.calendar_work`, a `security_invoker` view that deduplicates job/appointment and estimate/conversion work |
| OAuth states | `private.calendar_oauth_states`; hashed state/browser nonce, encrypted PKCE verifier, 10-minute expiration and one-time consumption |
| background queue | `private.calendar_sync_queue`; revision, lease, retry deadline, attempts and dead-letter flag |

A single `calendar_event_id` on an invoice cannot represent both Google and Outlook plus multiple staff accounts. The normalized mapping is deliberately used instead. Likewise, replacing existing invoices with another money table would introduce divergent totals, so the combined entity is a view.

PostgreSQL `timestamptz` represents instants; UTC is used in API payloads and storage comparisons, while the IANA zone is retained for rendering and calendar metadata. Calendar day boundaries use calendar-day arithmetic, not an assumed 24-hour interval. The new schedule editor rejects nonexistent spring-forward times and ambiguous fall-back times; the latter can be entered through an API only with an explicit unambiguous offset. Existing schedule forms retain their existing browser-local behavior and label conventions.

## Modules and API

| File | Responsibility |
| --- | --- |
| `server/calendar/google.ts` | Official `googleapis` calendar client, access-token refresh/persistence, stable-ID insert/update and delete |
| `server/calendar/outlook.ts` | Official Graph client and MSAL Node encrypted cache, refresh/rotation, writable calendars, event CRUD and lost-response recovery |
| `server/calendar/api.ts` | OAuth connect/callback, settings, list calendars, reconnect and disconnect |
| `server/calendar/crypto.ts` | AES-256-GCM encryption with independent nonce and authenticated integration context; key rotation via key IDs |
| `server/calendar/worker.ts` | Queue claims, provider routing, reconciliation, bounded work, retries and structured logs |
| `server/calendar/run.ts` | Standalone queue consumer with graceful shutdown |
| `api/calendar.ts` | Same-origin Vercel HTTP methods |
| `api/calendar-worker.ts` | Secret-authenticated scheduler endpoint |
| `src/components/calendar/DailyCalendar.tsx` | Daily work and reminders widget |
| `src/components/calendar/IntegrationSettings.tsx` | Google and Outlook connection cards |
| `src/components/calendar/DocumentSchedule.tsx` | Scheduling controls in document details |

`GET /api/calendar?businessId=…` lists sanitized integration metadata. `POST ?action=connect` creates an OAuth request. `GET ?action=callback&provider=…` consumes the callback state and code. `GET ?action=calendars&businessId=…&integrationId=…` lists writable calendars. PATCH saves calendar/autoSync; DELETE queues disconnect; POST `?action=retry` requeues a failed sync. Every non-callback user route verifies the Supabase access token with Auth and verifies the current business membership. All integration lookups constrain integration ID, business ID, and user ID. Mutations require the exact configured Origin. Tokens are never returned to React.

Google requests offline consent with calendar-events write and calendar-list read scopes. Outlook requests delegated User.Read, Calendars.ReadWrite, and offline_access; MSAL retains its refresh-token cache encrypted as one envelope. The app never uses application-wide Microsoft calendar permissions.

Outlook uses `/me/events` for the default calendar, `/me/calendars/{id}/events` for an explicitly selected calendar, and `/me/events/{id}` for PATCH/DELETE. Payloads use UTC ISO dateTime values with `timeZone: UTC`; this preserves the exact instant across Windows/IANA differences and daylight saving transitions. Immutable IDs are requested. Google supplies UTC RFC3339 instants plus the IANA timezone.

## Event flow and reliability

1. An estimate, invoice, schedule, appointment, or job transaction updates its normal database rows.
2. An AFTER trigger writes a compact queue entry in that same transaction and increments its revision. It never calls a provider. `ESTIMATE_STATUS_CHANGED`, `INVOICE_STATUS_CHANGED`, and `WORK_CHANGED` identify the trigger source. A failed business transaction rolls back its queue write.
3. A worker claims an available integration using `FOR UPDATE SKIP LOCKED`, commits the five-minute lease, and reads current integration/work records. It serializes token refresh/settings operations with the integration row lock, separate from the invoice row lock.
4. It reconciles the **latest** state, not a historical payload. Hashes avoid unchanged API writes. Source IDs, calendar IDs and generations give Google stable event IDs and Microsoft correlation properties plus transaction IDs. This recovers from remote creation succeeding before a local transaction crashes.
5. The worker processes up to eight changes per invocation with a time budget, persists mappings, and leaves remaining work queued. A revision change during processing always causes another pass. Leases recover crashed consumers; failed provider calls do not roll back the user's invoice.
6. 429 / rate-limit responses honor Retry-After and exponential backoff with jitter. Revoked grants request reconnection. Permission/configuration errors stop automatic retry. Transient failures stop after 12 attempts and remain reviewable. Retrying is explicit in Settings. Only safe reason codes and opaque IDs reach `sync_initiated`, `sync_success`, and `sync_failed` logs.

Delivery is at-least-once with idempotent reconciliation, **not** a claim of transactional exactly-once writes across two vendors. Old event mappings retain generation counters after deletion so repeated cancellations and later reactivation do not reuse a Google deleted-event tombstone.

## Configuration and deployment

These are server environment variable **names**, not values to put in browser code:

| Variable | Purpose |
| --- | --- |
| `CALENDAR_SYNC_ENABLED` | `true` only after all configuration and worker setup is complete; absent fails closed |
| `CALENDAR_APP_ORIGIN` | Canonical HTTPS origin, e.g. `https://finviant.com` |
| `CALENDAR_DATABASE_URL` | Supabase transaction-pooler connection for the server worker role |
| `CALENDAR_DATABASE_CA` | Optional PEM certificate authority if required by the database certificate chain; TLS verification stays on |
| `CALENDAR_TOKEN_KEYS` | JSON object of key ID → base64 32-byte encryption key; retain old keys while rotating |
| `CALENDAR_TOKEN_KEY_ID` | Active key ID, e.g. `v1` |
| `CALENDAR_WORKER_SECRET` | Long random scheduler bearer token |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google OAuth Web application |
| `OUTLOOK_CALENDAR_CLIENT_ID`, `OUTLOOK_CALENDAR_CLIENT_SECRET` | Microsoft Entra confidential Web application |
| existing `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public client configuration, also used for server token validation; these are not privileged secrets |

Register these exact redirect URIs on the providers for the canonical hostname:

- `https://finviant.com/api/calendar?action=callback&provider=google`
- `https://finviant.com/api/calendar?action=callback&provider=outlook`

Use separate provider apps/redirects and encryption keys for staging versus production. The initiating browser and callback must use the same hostname because OAuth is bound to a Secure, HttpOnly, SameSite=Lax `__Host-` cookie. If using `www`, redirect it to the canonical host before enabling OAuth, or configure the canonical origin to that hostname consistently. Vercel SSO remains enabled; authorized testers need their existing Vercel sign-in session to reach the callback.

Enable Google Calendar API and configure test users/consent-screen verification as applicable. Register Entra redirect type **Web** (not SPA) with the intended work/personal account types and delegated permissions. Do not paste provider secrets into chat, git, or VITE-prefixed variables.

Database role: use a dedicated server login with BYPASSRLS (required to reconcile authorized users in a background process), restricted to USAGE on public/private, SELECT on businesses/business_members/jobs/appointments/estimates/invoices/document_schedules/calendar_work, and SELECT/INSERT/UPDATE/DELETE on the four private calendar tables. It needs no financial write permissions. Provision its password through a secret manager; this migration does not create or expose a password. The API independently checks caller membership and ownership, and the worker rechecks membership before exporting. The admin migration connection is not the intended long-term runtime credential.

Apply migrations to staging first. Run `npm ci`, `npm run typecheck:calendar`, `npm run test:calendar`, `npm run build`, and `npm run build:calendar`. Start a managed worker using `npm run start:calendar`, **or** invoke the protected `/api/calendar-worker` endpoint on a regular schedule using `Authorization: Bearer <CALENDAR_WORKER_SECRET>`. Never start a fire-and-forget loop inside a serverless request. A standalone worker drains at full speed and polls only when idle; a scheduled HTTP invocation handles one bounded batch, so size its frequency for queue depth.

Vercel preview deployments do not automatically get production Cron Jobs. For this private-testing branch, configure a staging scheduler with its own protection bypass header and worker secret, or use the standalone worker. Do not turn off SSO to make scheduling work. This commit intentionally does not create a paid hosting service or send calendar requests before account setup.

## Validation and operational checklist

Automated local coverage includes schema application in embedded PostgreSQL, RLS cross-business reads/writes, inaccessible credentials, interval constraints, DST/leap-day boundaries, scheduled/approved/paid/cancelled transitions, conversion deduplication, atomic outbox rollback, duplicate sync, rescheduling, cancellation, membership removal, revoked tokens, retry deadlines, provider payloads, OAuth state rejection, and worker authorization. Provider tests use fakes; they do not prove live account consent or provider transport behavior.

Browser tests cover daily work/reminders, reminder completion, date selection, settings/toggle submission, and phone overflow. Run them in CI with installed Chrome. The local runtime could not download the Chrome archive, so local visual acceptance was not available.

Before enabling for real customers:

- Verify real Google and Microsoft consent, refresh after expiry, revocation/reconnect, target-calendar changes, cancellation and disconnect against disposable calendars.
- Run two simultaneous workers to verify real PostgreSQL locking and crash/retry recovery under deployment timeouts; unit/embedded tests are not a concurrent production load test.
- Check queue age/dead rows, last_error, provider quotas and safe exception logs. Alert on dead work or sustained lag. Document recovery, credential rotation and provider outage handling.
- Confirm current timezone data on the database. Staging was observed on PostgreSQL 17.6.1.166; Supabase's October 30 advisory recommends 17.11.0.003+ for corrected Vancouver/Edmonton/Casablanca rules. Do not upgrade a database implicitly during a feature deployment.
- Complete remote cleanup before deleting an entire business or auth account. A hard business cascade cannot delete events from an external provider after its credentials are gone.
- Keep scopes, retention, privacy disclosure, and shared-calendar visibility aligned with actual use. Event descriptions include only explicitly provided calendar text, job title and a gated app link.

## Primary references

- Google official Node client: https://github.com/googleapis/google-api-nodejs-client
- Google event IDs and event creation: https://developers.google.com/workspace/calendar/api/guides/create-events
- Google web-server OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- Microsoft Graph event creation and timezone payload: https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
- Microsoft authorization-code/refresh flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Supabase row-level security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Vercel Node functions: https://vercel.com/docs/functions/runtimes/node-js
