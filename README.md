# Velnu (working name)

Voice-first business assistant for very small service businesses. This is the **development preview**, based on the existing Owedly codebase. "Velnu" is a provisional public-facing name pending domain and trademark clearance. Keep all external infrastructure, existing domains, database table names and secret names unchanged until a controlled migration is approved.

## First release: keep it simple

One flow: customer -> job -> invoice/estimate -> owner approval -> send -> follow-up. The owner can speak or type job details, but missing prices, customers or dates must be clarified, not invented.

Prioritize: (1) login/business isolation, (2) customer creation, (3) job/invoice/estimate drafts, (4) invoice-email delivery, (5) voice capture with review, (6) owner reminders and mobile PWA. Do **not** add employee dispatch, payroll, automatic outbound AI calls, SMS conversations, or two-way Apple Calendar sync to version 1.

## Current implementation

- React 19 + TypeScript + Vite (not SwiftUI or Next.js)
- Supabase Auth, Postgres with RLS and Edge Functions for server-side logic
- Resend for invoice email via the existing `send-invoice-email` Edge Function
- Existing browser tests use mocked Supabase; those passing would **not** prove email was delivered to a real inbox

## Development isolation

- GitHub development branch: `feature/velnu-stage1`
- Staging backend: **Owedly-Test** (`xvybcmyoblfgzokaifsx`), active as of 2026-10-26
- Original backend: **Owedly** (`mntucevxsztpcggfdkhg`), reported inactive as of 2026-10-26
- The `.env.example` on this branch points to staging using a browser-safe publishable key. `RESEND_API_KEY`, service-role credentials, and payment secrets must **never** be committed to Git or exposed in the browser.
- Existing verified sending domain remains `owedlyworks.com` until a replacement domain is legally and technically ready. Do not change the sender email to an unverified Velnu domain.
- No live Vercel project was visible in the currently connected Vercel account during the audit; deployment remains to be established/confirmed.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Run `npm install` and `npm run dev`.
3. Run `npm run build` before merging.
4. Run browser regression tests with Playwright in the existing trial workflow. These tests mock external services.

## First end-to-end acceptance check (staging only)

1. Create a fresh test user and business in staging.
2. Create a test customer with a controlled recipient email address.
3. Create a draft invoice with two items; verify server-calculated totals and that a second business cannot read it.
4. Confirm owner approval is required before send. Email through the deployed `send-invoice-email` function with a valid staging-only `RESEND_API_KEY` configured server-side. Never send unsolicited emails to real customers.
5. Verify the actual email inbox, provider ID, `messages` record, and invoice status. Test error messages and a safe retry without duplicate delivery.
6. Test voice transcription and draft/clarification flow on a real iPhone Safari session. Verify no automatic external actions without review.
7. Only after these checks pass, configure a staging Vercel preview and test installation as an iPhone Home Screen web app.

## Release gates

- Build and tests passing; cross-business access denied by RLS
- No client-exposed private secrets; backend status confirms actual results
- No external customer-facing actions without explicit approval
- Domain/trademark clearance before public brand launch
- Private beta with real owner-operated service businesses before expansion
