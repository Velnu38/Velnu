# Velnu integration backlog and sequencing

Last reviewed: 2026-10-26. This is a **roadmap, not a claim of implemented or operational integrations**. All provider-connected features require a configured credential, tenant isolation, consent, staging tests, and release review. Do not switch on paid or customer-facing actions automatically.

## Separate development workstream: Finviant Platform Administration (planned)

**Roadmap only: no operator login or administrator dashboard is enabled.** See [the dedicated security-first plan](FINVIANT_PLATFORM_ADMIN_PLAN.md) for scoped roles, phases, acceptance gates and release dependencies.

- [ ] **User management:** minimal account/company status directory, masked identities, no private customer/financial records or impersonation.
- [ ] **Subscription monitoring:** actual verified Stripe subscription and entitlement state when available; selected plan preferences are not paid entitlements.
- [ ] **System health:** redacted deployment, Supabase, Edge Function and provider connectivity/error summaries with timestamps.
- [ ] **Security:** server-side platform roles separate from business membership, mandatory MFA, restricted endpoints, revocation, immutable-enough audit trail and alerts.
- [ ] **Sequence:** platform backend protections and role bootstrap first; read-only dashboard next; at least 1,000 staging permission/negative tests; controlled production approval only afterward.
- [ ] **Hard boundaries:** no default access to client invoices, charges, payments, customer contacts, employee data, uploaded files, recordings, AI prompts, credentials or unrestricted SQL.

Proposed future hostname: admin.finviant.com, conditional on domain clearance and architecture review. All provider secrets stay on the backend.
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

## Google API integration decisions and costs (checked October 26, 2026)

**Status: roadmap only.** Google Maps URLs already used in Velnu need **no API key**; a Google Map embedded in the app needs a Google Cloud project with billing, restricted Maps Embed API key, and the \`VITE_GOOGLE_MAPS_EMBED_KEY\` preview environment variable. Google Calendar, Google Sign-In and other Google account-linked features are **not yet connected to Velnu customer accounts**.

**There is no single "Google API subscription."** You can create a Google Cloud project at no upfront cost and enable only the services you need. Some APIs are no-charge or have monthly free usage caps; others bill per request or minute. Enabling Maps Platform billing requires a payment method, but does **not** require a $100+/month Maps subscription; choose pay-as-you-go for the MVP. Eligible new Google Cloud customers may receive $300 in credit over 90 days, subject to product eligibility and account rules.

| Integration | Business benefit | Current provider cost / cap (USD) | Velnu priority |
|---|---|---|---|
| Google Maps URLs | Open directions to jobs or properties in Google Maps | **$0 Google API charge; no API key** | **Already present** |
| Google Maps Embed API | Show a map for a customer or job address within Velnu | **$0 for unlimited Embed SKU usage**; Google Cloud billing + a restricted browser key still required | Optional now |
| Google Sign-In / OAuth | Sign up or sign in with a Google account | **No Google per-login API charge expected**; Supabase auth-plan limits and OAuth review/configuration still apply | After basic auth works |
| Google Calendar API | Sync Velnu appointments with a connected Google calendar | **$0 for standard API use within limits**; Oct 2026 published threshold is 1,000,000 requests/day/project, after which Google may charge later in 2026 (prices not yet published) | Basic/Pro future optional |
| Google Maps Dynamic Maps | Fully interactive maps, layers, markers, dispatch view | First **10,000 loads/month free**, then **$7 per 1,000** at the initial paid tier | Only after need is established |
| Google Places Autocomplete (New) | Suggest verified service addresses when typing | First **10,000 billable requests/month free**, then **$2.83 per 1,000**; session and details SKUs may differ | Optional later |
| Google Geocoding | Turn addresses into coordinates for maps/distance | First **10,000 requests/month free**, then **$5 per 1,000** | Optional later |
| Google Business Profile APIs | Let owners manage business listing information, posts/reviews when approved | **No Google API usage fee**, but developer approval is required and use is subject to eligibility/quotas | Optional add-on after launch |
| Gmail API | Allow users to connect their own mailbox, read mail or send as themselves | Standard API use presently **$0 within quotas**, with potential above-threshold billing later in 2026; restricted scopes can require security assessment and recurring external assessor fees | **Not needed for invoice sending**; keep Resend |
| Google Speech-to-Text v2 | Alternate speech transcription provider | Standard synchronous recognition **$0.016 per audio minute** in initial tier (about $16 per 1,000 minutes), plus storage/network where applicable | Do **not** add now; OpenAI already chosen |

### Lowest-cost launch choice

1. Keep **Google Maps URLs for navigation at no API cost** and the optional **Maps Embed** experience at no Embed usage charge. Enable the Embed key only if embedded maps are an important test feature.
2. Add **Google Calendar OAuth** after the internal appointment and employee-permission workflows work; start with one-way sync, then optional paid two-way sync.
3. Offer **Sign in with Google** for convenient signup only after current Supabase authentication and required user-agreement flow are stable.
4. Use **Resend**, not Gmail API, for Velnu's own branded invoice/estimate emails after domain verification.
5. Don't add Google Speech-to-Text on top of OpenAI unless testing demonstrates an accuracy or reliability improvement worth the extra integration.
6. Set **Google Cloud budget alerts and per-API quota restrictions**; budget alerts are notifications, not guaranteed hard spending caps. Avoid loading maps or invoking Places on every page render when not needed. Store OAuth refresh tokens only server-side. Do not submit sensitive customer or employee details to Google APIs without necessary consent.

### Google project setup checklist (when ready)

- [ ] Create Google Cloud project **Velnu-Staging** at https://console.cloud.google.com/ and enable billing only as required.
- [ ] Enable only the specific Google API(s) listed above.
- [ ] For maps, make a **website-referrer and API-restricted browser key** and set \`VITE_GOOGLE_MAPS_EMBED_KEY\` for **Vercel Preview** (not a secret; restriction makes exposure acceptable).
- [ ] For sign-in/calendar, configure a separate **Google OAuth consent screen**, authorized redirect URI, and least-privilege scopes. Store OAuth client secret and users' refresh tokens securely on the backend, never in browser variables.
- [ ] Set pricing alerts, API quotas, and staging tests before opening any paid Google API to users.
- [ ] Validate owner/customer data isolation, consent revocation, quota failures, retries, timezone handling, and disconnected Google accounts.

**Official sources (recheck before activation):**

- Maps pricing and free SKU caps: https://developers.google.com/maps/billing-and-pricing/pricing
- Maps billing, pay-as-you-go vs fixed subscriptions: https://developers.google.com/maps/billing-and-pricing/overview
- Calendar API pricing and limits: https://developers.google.com/workspace/calendar/api/guides/quota
- Gmail API usage and pricing: https://developers.google.com/workspace/gmail/api/reference/quota
- Google Business Profile API pricing/access: https://developers.google.com/my-business/content/pricing
- Speech-to-Text pricing: https://cloud.google.com/speech-to-text/pricing
- Google Cloud trial: https://docs.cloud.google.com/free/docs/free-cloud-features
- Restricted OAuth scope security assessment: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

## Release dependencies and acceptance gates

The current Velnu Schedule page supports internal appointment/job scheduling, status changes, and a list view. **It does not yet connect Google Calendar, Microsoft Calendar, or employee accounts.** Keep calendar connection controls hidden or explicitly "Coming soon" until OAuth and synchronization are working.

Required evidence before launch: signed-in owner authorizes a provider, creates a test appointment in Velnu, event appears exactly once in the selected external calendar, changes and cancel propagate, staff only see permitted assignments, provider tokens stay server-side, disconnect stops all future access, and no unrelated customer data is disclosed.

Provider technical references:
- Google Calendar API: https://developers.google.com/workspace/calendar/api/concepts/sharing
- Microsoft Graph shared/delegated calendars: https://learn.microsoft.com/en-us/graph/outlook-create-event-in-shared-delegated-calendar
- Microsoft Graph create event: https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0
