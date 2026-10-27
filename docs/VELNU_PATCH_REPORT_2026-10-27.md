# Velnu consolidated patch report — October 27, 2026

**Scope:** `feature/velnu-stage1` only, with paired schema changes in the Owedly-Test Supabase environment. This is not a production release or a certification that the application is ready for paying customers. Customer emails/approval links remain disabled until sender-domain setup and controlled delivery tests are complete.

**Review baseline:** `a52360261fe18970b57dfafb21a0d0e0115a1921` (prior passing Velnu beta branch). Subsequent commits implement the changes below. Use GitHub's compare view to review every source change.

## Applied patches

### 1. Preserve company branding on issued documents
- DB patch: `supabase/patches/2026-10-27-freeze-issued-document-issuer.sql`.
- Adds `issuer_snapshot` to invoices, estimates and change orders.
- Trigger freezes company name, address, public contacts, logo path, document color and footer when a document transitions from draft to issued.
- Blocks clients from rewriting a captured issuer snapshot.
- Invoice print, estimate print/preview and customer approval pages now use the issued snapshot instead of mutable current company settings.
- Older issued documents without a historical snapshot must fall back to the current profile; their earlier identity cannot be reconstructed accurately.

### 2. Enforce user acceptance at the database boundary
- DB patch: `supabase/patches/2026-10-27-require-agreement-for-workspace.sql`.
- Workspaces are inaccessible to new users who have never accepted a Velnu agreement, even if they bypass the React onboarding UI and call the data API.
- Keeps historic V1 acceptances valid while the app presents the newer V2 agreement.
- New acceptance records must match V2, include affirmative AI and electronic notice consents, and match the saved plan preference.
- Existing owner read/write access was verified; a user without acceptance was denied.

### 3. Restrict financial changes by employee role
- DB patch: `supabase/patches/2026-10-27-financial-employee-permissions.sql`.
- Only owner/admin/office may mutate invoices, estimate records and lines, payments, change orders and lines, and bookkeeping entries.
- Technician can continue field-work updates but cannot bypass UI restrictions to create invoices through a database RPC.
- Updated financial action buttons and quick-invoice saving to use a dedicated `canManageFinances` role helper.
- Field-role permission matrix should be revisited when multi-user team plans launch.

### 4. Protect ownership from administrator escalation
- DB patch: `supabase/patches/2026-10-27-prevent-role-escalation.sql`.
- An administrator cannot promote themself to owner.
- The owner account cannot be removed, demoted, or reassigned through ordinary member editing.
- Preserves automatic owner creation for a new workspace.
- A dedicated transfer-ownership workflow is **not** implemented.

### 5. Correct Basic logo rights
- Updated `src/components/BusinessProfileEditor.tsx`.
- Activated Basic **or** Pro can upload a business logo when the backend grants a positive logo byte allowance. Free remains text-branding only; choosing a paid *preference* does not unlock storage.

### 6. Make change order statuses explicit
- Updated `src/pages/ChangeOrdersPage.tsx`.
- Replaced reversible draft/sent/void dropdown with confirmed, one-way user actions.
- "Mark sent manually" records an external send without implying Velnu emailed the customer.
- Void is confirmed and no emailed customer action is available from a terminal document.
- Customer acceptance remains on the separate, explicit acceptance flow.

### 7. Query performance and regression tests
- DB patch: `supabase/patches/2026-10-27-core-query-indexes.sql`.
- Seven targeted indexes improve tenant-scoped document details, payment history, recent documents, and customer jobs.
- Added browser tests for historical issuer branding, activated Basic logo upload, financial controls for technicians, and safe change-order status transitions.
- Continued using existing mocked browser suites for onboarding, estimate acceptance, manual payments, marketing/pricing, legal agreement, voice capture, Google Maps and bookkeeping. Mocked tests cannot prove real vendor delivery.

## Verification conducted

- Supabase transactional tests completed without errors. Temporary test customer, document and employee role mutations were rolled back.
- Issuer identity froze when an estimate was marked sent, stayed unchanged after the company name changed, and rejected tampering.
- A non-accepted user had no business/member write access; the previously accepted owner retained their membership and writer rights.
- A temporarily simulated technician retained field permission but was refused invoice creation; the original owner role was restored by rollback.
- A temporarily simulated administrator was refused owner self-promotion; original owner status restored by rollback.
- The GitHub TypeScript/Vite build and preview deployment were confirmed on the relevant commits. See the latest GitHub Actions runs for definitive browser test status.

## External and launch blockers — not fixed by code patches

1. **Resend:** Sending-domain DNS verification has failed. Customer email and outbound approval-link actions must stay disabled until verified and tested with real inboxes. Legacy sender identity must be replaced with verified Velnu branding.
2. **OpenAI:** A funded, working API key and real-device transcription/command validation are required. A server function is not proof a transcription API call succeeded.
3. **Authentication:** Supabase's security advisor still reports leaked-password protection disabled. Enable it in Authentication settings.
4. **Legal:** Draft agreement, AI disclosures, privacy notice and estimate acceptance terms require review by an attorney, correct legal-entity/operator name, contact information and jurisdiction-specific disclosures before public launch.
5. **Billing/entitlements:** Free, Basic, Pro and à la carte prices are proposals. No live paid checkout, subscriptions, verified webhook entitlements, or purchased add-on activation are in place; selecting a plan remains a preference only.
6. **Live QA:** Run actual iPhone and Android browser, microphone, printing, account recovery, tenant isolation, recipient approval, real email, and payments testing before production launch. Store immutable *recipient/terms* snapshots and signed PDF receipts if formal contract evidence is required.
7. **Performance lint:** Some remaining foreign-key indexes are optional and should be prioritized with real workloads rather than created blindly.

## Important deployment boundary

All UI code changes were pushed to the GitHub development branch, automatically creating Vercel **preview** builds. SQL changes were applied only to staging Supabase. **Do not deploy this branch to production without release review, completed external setup, and actual-device testing.**
