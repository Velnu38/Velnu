# Velnu integration backlog and sequencing

Last reviewed: 2026-10-26. This is a **roadmap, not a claim of implemented or operational integrations**. All provider-connected features require a configured credential, tenant isolation, consent, staging tests, and release review. Do not switch on paid or customer-facing actions automatically.

## Priority 0: Establish a complete web app and hosting model

- [ ] **Public custom domain**: decide and validate the Velnu business/domain name; add DNS, HTTPS, canonical host, legal sender/support address, SEO, and clear marketing-to-signup flow.
- [ ] **Same app on the website**: a user should use the full authenticated Velnu web experience directly from the website (desktop and mobile). They should not have to download a separate phone app to use core functionality.
- [ ] **Optional installable PWA**: provide an obvious "Add Velnu to your phone" guide or browser install prompt where supported. PWA installation saves the web app to the home screen; it is not an App Store download and must not imply an iOS/Android binary exists.
- [ ] **A la carte catalog and entitlements**: show Free, Basic, and Pro packages plus optional add-ons to purchase individually (e.g., AI minutes, calendar sync, advanced approvals). Show total price before checkout. Packages and add-on prices remain TBD.
- [ ] **Billing and account-level permissions**: integrate a billing provider (Stripe is a candidate) with server-verified webhooks, payment idempotency, provisioning and revocation, trial and cancellation rules, tenant-level entitlements, usage metering, spending caps, and accounting support. Do not expose payment secrets in the web frontend.
- [ ] **Account acceptance**: versioned user agreement, AI disclosure, privacy notice, affirmative opt-in, and up-to-date customer-facing estimates acceptance terms.

## Priority 1: Reliable fundamental integrations

- [ ] **OpenAI voice-to-text and assistant**: owner-controlled server credentials; verify real recordings on iPhone; choose supported models, check billing, transcription errors, retention and per-tenant usage limits; preview all AI financial actions.
- [ ] **Resend email**: verify a legally controlled Velnu sender domain (DKIM, SPF and return path), use a valid from/reply-to address, configure a customer-accessible app URL, test delivery and safe retries before enabling customer document emails.
- [ ] **Customer estimate approval**: full branded estimate, explicit statement agreeing to the estimate/terms, positive customer action and audit evidence, accurate accepted/declined state, expiration and revision rules. **Do not treat opening a link as acceptance.**
- [ ] **QuickBooks Online**: optional separate read-only connection and transaction import (staging scaffolding documented in QUICKBOOKS_WORKBOOK.md); finish Intuit developer credentials, sandbox OAuth, sync reconciliation and costs before launch.

## Priority 2: Google Calendar and Microsoft Outlook Calendar (NEW)

**Goal**: Let business owners schedule jobs once in Velnu and optionally keep selected company and employee calendars consistent. The same scheduling functionality must work on the Velnu website and its installed PWA.

### User-facing options

- [ ] **Connect Google Calendar** via Google OAuth and Google Calendar API.
- [ ] **Connect Microsoft Outlook / Microsoft 365 Calendar** via Microsoft OAuth and Microsoft Graph Calendar API. Consider personal Outlook.com and organization accounts; permissions and admin consent differ.
- [ ] **Calendar account settings**: each business owner can choose Google, Outlook, neither, or (later) both. Clearly display account identity, connected calendars, last sync, permission scope, and disconnect option.
- [ ] **Select sync target**: choose an owner calendar, designated company scheduling calendar, or authorized employee calendar. Never silently publish to every personal calendar.
- [ ] **Phase A: export/share** appointments as downloadable .ics and/or provider-specific Add to Calendar links, without requiring account access. Add invitation emails only once sender verification works.
- [ ] **Phase B: one-way sync from Velnu to chosen calendar**: create/update/cancel the external event after the owner saves an appointment. Store provider IDs, remote ETags, sync status and errors. Retries must not duplicate events.
- [ ] **Phase C: two-way sync (optional paid feature)**: imports/free-busy lookup, delta synchronization, conflict-resolution rules, provider webhooks/polling, timezone and DST correctness, refresh token lifecycle and disconnect/revoke handling.
- [ ] **Staff sharing**: owners invite employees by email; assign roles (owner/admin/scheduler/technician/viewer); optionally share jobs or team calendar with each employee. Employees see only assigned schedules or authorized team calendars, and can acknowledge, accept/decline, or mark jobs complete as allowed.
- [ ] **Employee calendar choice**: employee can opt into receiving assigned events as calendar invitations, connect their own Google/Outlook account if they want sync, or simply view assignments in Velnu without connecting a calendar. Respect personal calendar privacy.
- [ ] **Team dispatch view**: day/week views grouped by employee/team, availability/free-busy (where permitted), collision warnings, reassignment, cancellation, and notification to affected employees. Do not confuse simple calendar-sharing with a full workforce-management/dispatch product.
- [ ] **Notifications**: employee notifications and customer appointment reminders only with explicit business authorization and verified delivery channels. Avoid disclosing customer address/phone to unassigned staff.
- [ ] **Security**: encrypted refresh tokens server-side only, OAuth CSRF state + PKCE, tenant-scoped event mappings, least-privileged calendar permissions, private-event redaction, rate limits, audit logs, webhook verification, employee offboarding and disconnect.
- [ ] **Testing**: two test companies; Google and Microsoft sandboxes/test accounts; read-only and write permissions; employee reassignment and revocation; DST transitions; daylight time changes; sync retries, race conditions and provider outages; mixed-provider teams.

### Implementation recommendation

Velnu's **Supabase appointments** remain the source of truth for a service visit, including business ID, customer, job, start/end and assigned employee(s). Calendar providers are connected views/delivery channels and may not silently overwrite important job details. Start with one-way integration; add true two-way sync after conflict policy and employee permissions are proven.

Google Calendar sharing supports dedicated team calendars with access-control roles (free/busy, reader, writer). Microsoft Graph supports Outlook shared/delegated calendars and event creation when the connected user is permitted. Some Microsoft 365 business tenants require administrator consent. Use official Google and Microsoft API integrations embedded in Velnu rather than assuming a ChatGPT Calendar plugin grants access to every Velnu customer.

### Possible development helpers vs customer integrations

- ChatGPT **Google Calendar** connector: available but not necessarily connected to this ChatGPT account; useful to test personal calendar-related workflows when explicitly connected.
- ChatGPT **Outlook Calendar** connector: available; useful for assistant-led calendar tests after connection.
- ChatGPT **Calendly** plugin: can help test external booking links, event types and availability. Optional future appointment booking add-on, not a substitute for Velnu employee/job permissions.
- Microsoft Bookings or other dedicated scheduling services can be evaluated later if customer-facing self-booking becomes a high-priority feature.
- **Important**: these ChatGPT plugins are separate from the OAuth integrations we must build into the Velnu SaaS for its customers.

### Pricing packaging proposal (not final)

- Free: Velnu internal scheduling and optional manual calendar export (.ics) if implemented.
- Basic: single connected Google or Outlook calendar and automatic one-way sync, subject to stated limits.
- Pro / a la carte add-on: company shared calendar, employee invitations/assignments, per-employee sync, team dispatch and eventual two-way sync.
- Publish fixed prices, seats and usage limits only after expected provider, authentication, message, and ongoing maintenance costs are modeled.

## Release dependencies and acceptance gates

The current Velnu Schedule page supports internal appointment/job scheduling, status changes, and a list view. **It does not yet connect Google Calendar, Microsoft Calendar, or employee accounts.** Keep calendar connection controls hidden or explicitly "Coming soon" until OAuth and synchronization are working.

Required evidence before launch: signed-in owner authorizes a provider, creates a test appointment in Velnu, event appears exactly once in the selected external calendar, changes and cancel propagate, staff only see permitted assignments, provider tokens stay server-side, disconnect stops all future access, and no unrelated customer data is disclosed.

Provider technical references:
- Google Calendar API: https://developers.google.com/workspace/calendar/api/concepts/sharing
- Microsoft Graph shared/delegated calendars: https://learn.microsoft.com/en-us/graph/outlook-create-event-in-shared-delegated-calendar
- Microsoft Graph create event: https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0
