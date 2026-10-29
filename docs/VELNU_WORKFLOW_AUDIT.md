# Velnu workflow review — staging

Scope: the mobile-friendly Vite/React Velnu preview, backed only by **Owedly-Test** (Supabase project \`xvybcmyoblfgzokaifsx\`). This is not a production certification.

## Intended owner journey

1. **Account:** sign up, verify email, sign in.
2. **Initial company setup:** enter company name and optional phone, business email, mailing address and website; optionally upload PNG/JPG/WebP logo (max 2 MB), select document accent and footer; optionally describe services, service area, size and team responsibilities.
3. **Dashboard:** owner sees summary and the next actions. Owners of older workspaces receive a "Complete your company profile" prompt until they save the profile in **Company settings**.
4. **Customers / jobs:** create and manage records belonging to the signed-in business only.
5. **Estimate:** choose a customer, add priced line items and optional expiry, save draft, inspect branded preview, then print or save to PDF. Conversion to invoice follows an accepted estimate.
6. **Invoice:** choose a customer, add priced line items, save draft, inspect branded document, print/Save PDF. Optional quick command/keyboard dictation supports one-line invoices after explicit owner review; a multi-price command does not silently merge charges.
7. **Approval and payment:** external estimate/change-order approval links and customer emails require verified sender domain and a publicly accessible app URL. These actions are disabled in the current private preview. Payments are recorded only following a deliberate action.
8. **Settings:** the business owner/admin can edit company contact details, logo and business context later.

## How business context works

The profile is a per-business database record. It **does not train or fine-tune an AI model**. The staging \`ai-command\` Edge Function has been updated to include company services, territory, team size and responsibilities as **untrusted reference data** when interpreting future commands. It instructs the model not to follow instructions embedded in that data or invent prices, staffing availability or customers.

Cloud speech transcription and advanced AI actions remain **unavailable** until their separate API credentials and model integration are configured and tested. Basic browser/keyboard dictation may work, depending on browser support.

## Changes made in staging

- Existing \`businesses\` table extended with optional business-profile and document-branding columns.
- Public \`velnu-business-logos\` bucket added, with 2 MB PNG/JPEG/WebP size/type restrictions. RLS restricts writes to the business owner or admin. Logos are public-facing assets; private employee or customer data must not be uploaded there.
- Reusable company-letterhead component used for invoice print view, estimate preview and customer approval pages.
- Internal invoice notes hidden from printed customer documents.
- Company Settings accessible in desktop navigation and mobile "More".
- Vercel preview and GitHub development branch remain separate from original \`main\` production source.
- Customer emails and approval link generation disabled by default by \`VITE_ENABLE_CUSTOMER_ACTIONS\`; the mock browser tests explicitly set this flag to true to test the send-confirmation code, not live mail.

## Remaining launch gates / known limitations

- **Email:** \`owedlyworks.com\` was not verified in Resend and should not be used as a live sender. Existing email functions still reference legacy sender infrastructure. Verify an appropriate new domain and server sender, point approval links to a public working URL, then explicitly enable \`VITE_ENABLE_CUSTOMER_ACTIONS\`. Run controlled inbox-to-inbox delivery and idempotent retry tests.
- **AI transcription:** staging \`transcribe-voice\` and \`ai-command\` require an \`OPENAI_API_KEY\` that is not yet configured. No production AI behavior or AI cost assumptions have been validated. Do not claim all voice intents work end to end.
- **Document history:** invoice/estimate previews currently read the **current** company branding. Before issuing real accounting documents, store an immutable issuer/contact/logo snapshot on send so historical issued documents do not change when business settings change.
- **True E2E verification:** GitHub browser tests use mocked backend services. Manually test a signed-in account creating a customer, a draft estimate, an invoice, a logo upload and printing on iPhone Safari; validate tenant isolation with two distinct business accounts. Test sender domain, delivery and approval links only after they are safely configured.
- **Security:** Supabase security advisor reports leaked-password protection disabled. Enable it before public signup. Add missing foreign-key indexes as traffic grows; keep RLS and tenant-scoped server checks.
- **Employee data:** MVP stores team size/roles as descriptive context only; employee accounts, assignment permissions and HR records are not yet implemented. Avoid collecting payroll, government IDs or personal employee addresses.
- **Brand:** "Velnu" is a working name; trademark/domain clearance not completed.
- **PWA:** add-to-home-screen and print layout need device QA. Do not claim Apple App Store deployment.

## Acceptance criteria before public beta

- Saved company settings persist after reload and appear in invoice/estimate preview and approved customer-facing documents.
- Logo upload succeeds for the owner, is denied to other businesses or unauthorized users, and is displayed only in intended places.
- Printed invoice/estimate includes the company contact data and excludes internal notes; totals match the server-calculated database totals.
- A draft is never emailed without explicit owner confirmation, and no missing prices or employee assignments are invented.
- Real voice transcription and advanced AI remain explicitly marked unavailable until configured; user-facing errors explain failures.
- Outbound links/emails become available only with a verified sender and public app URL; provider receipts and activity records are checked for real deliveries.
- Security advisory issues are triaged and addressed before onboarding paying customers.


## Web app, optional modules, and shared scheduling roadmap

See [INTEGRATION_BACKLOG.md](./INTEGRATION_BACKLOG.md) for the maintained integration list. It now tracks the custom Velnu domain, the same full-featured web app on desktop/mobile and as an optional PWA, a la carte paid add-ons and Stripe-style entitlement controls, plus **Google Calendar**, **Microsoft Outlook/Microsoft 365 Calendar**, and owner-controlled calendar sharing with employees.

**Current status:** the Schedule page has internal job/appointment records. Neither external calendar sync nor employee logins/permissions are live. The recommended order is calendar export/invitations, single-calendar one-way sync, employee role and assignment controls, and finally advanced two-way provider synchronization after permission and conflict-resolution tests.
