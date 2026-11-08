# First-business onboarding release — November 8, 2026

Implemented the approved short business setup after account creation, email verification and agreement. Existing businesses retain access and their saved details.

1. **Welcome:** “Thank You for choosing Finviant!” Business name plus Email/Text/Both choice. No duplicate plan selection. This welcome is only in unfinished first-business setup.
2. **Business contacts:** Reply contact required for Email/Both; mobile required for Text/Both. Each explains its use. Account-email prefill is an explicit action. Legal name, website and address are collapsed, persistently marked optional and have muted optional placeholders. Home addresses are not requested as mandatory company details.
3. **Sending readiness:** Actual plan and sender activation are fetched separately from saved contacts. Personal-app configuration acknowledgments are available; no readiness is assumed from entering a number/email. Verified managed reply routing is displayed independently. Pro owner-mobile verification remains available inline or later. Pending services do not block opening the workspace and are not falsely marked activated. Existing sender, recipient, plan and provider checks continue to enforce actual sends. The sending acknowledgment remains required.
4. **Setup saved:** Server-confirmed completion precedes the success screen. Confirm saved required fields, show pending channels, offer Open my dashboard and links to existing logo/document setup and Company Profile (“Tell Fin about your business”).

The account agreement remains mandatory; its misleading “Step 2 of 2” label has been replaced. Branding, document appearance, AI business description, services preferences, sample personal-app drafts, team management and advanced sending configuration remain available in their existing Settings sections. No worker profiles, subscriptions or paid services are created by these selections.

## Persistence and security

A private RLS-enabled table tracks newly created businesses only, without backfilling existing workspaces. The public invoker RPC delegates to a narrow private helper requiring a verified signed-in member; only the creating owner can save or complete initial setup. It validates the selected channel and corresponding stored email/mobile before persisting completion. Anonymous execution and direct client table reads are denied. The client uses a stable business creation ID across retries and retains the created business for subsequent saves. Failure does not display completion. Contact-save and completion errors keep entered values; saved onboarding can resume after reload. Drafts before the first save are protected by the unsaved-change warning rather than silently stored.

Live beta migrations applied (initial flow plus explicit current-owner-role guard); role/trigger metadata checked. Actual new-business insert, channel save, completion and subsequent completion read verified in a rolled-back transaction under a verified beta test identity. No test business retained. An initial test using an account that already owned a business was correctly rejected by the existing one-business-per-account guard; the unused verified test identity passed.

## Checks and limits

- PGlite: legacy businesses unaffected, new flow gate/resume, email-only and both-channel validation, invalid phone rejection, idempotent completion; outsider, unverified, nonowner and anonymous denial.
- Rendered DOM: welcome, conditional required fields, explicit email prefill, phone validation, pending activation, failed final-save retry, completion and resumed flow with no duplicate creation.
- TypeScript, production build and 55 startup/deployment checks.
- New checks included in authentication CI.

Shared Chrome could not connect to the local preview server (connection refused); rendered DOM checks ran successfully in the executor. Real iPhone/Android visual acceptance and actual sender/SMS activation remain launch-readiness work, not certified by these tests. Authentication email SMTP remains separate and is not configured by this change. Additional sender registration data is requested by the relevant sending configuration; optional business address entry does not substitute for regulatory registration. Managed sender reply routing is not overwritten by a profile contact save.
