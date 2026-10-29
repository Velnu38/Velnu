# Finviant Platform Administration — secure development plan

**Status:** Planned only; **not implemented, deployed, enabled, or provisioned**.
**Scope:** Separate operator console for **Finviant** to manage **Finviant Office** SaaS.
**Repository:** Existing `Velnu38/Velnu` codebase, `feature/velnu-stage1` development branch.
**Backend for development:** Owedly-Test Supabase only. Do not touch production or customers.
**Priority:** Start the foundation before public paid launch; roll out read-only monitoring first.

## 1. Purpose, boundaries, and naming

The Finviant Platform Administration console is for the SaaS **operator**, not any subscriber company's owner, admin, office worker, technician or viewer.

- **Finviant** is the parent company/product brand; **Finviant Office** is the customer-facing business application.
- Suggested future hostname: `admin.finviant.com` (only after domain acquisition, DNS, and legal clearance). Staging must remain on an isolated nonproduction origin.
- The platform console needs its **own authenticated routes, server-side authorization and data access boundaries**. Hiding a navigation item or using an obscure URL is not security.
- Preserve the existing `business_members` roles and customer workspace behavior. Platform administrator rights must **never** be inferred from `business_members.role = 'owner'/'admin'`.
- Until designed, implemented and reviewed, there is **no platform admin login, self-service platform promotion, or public platform-admin link**. Never build a mock console that appears to offer live account controls.

## 2. Initial MVP — four read-only modules

| Module | Minimum first release | Data allowed | Deliberate exclusions |
|---|---|---|---|
| User management | Registered user count; searchable account identifier/email with minimization; account created/last sign-in when authorized; company association, membership role, invite/verification/account-status indicators; support ticket reference | Least-privilege identity metadata and workspace IDs/names only; mask emails by default in list screens | No passwords/tokens; no invoices, customer lists, recordings or private files; no silent impersonation; no arbitrary account takeover |
| Subscription monitoring | Free/Basic/Pro **actual entitlement** counts, trial states, next renewal and failed/paused/canceled states once implemented, provider ID/status, event-reconciliation and webhook error counts | Server-verified Stripe subscription metadata, masked identifiers, aggregated MRR where actually supported | No full card number/CVC, no direct charge/refund/cancellation in phase 1; do not treat `user_plan_preferences` as paid entitlement or invent revenue |
| System health | Build/deployment version, operational uptime checks, Supabase database/Edge Function health, request errors, latency, queue/email/AI status, webhook backlog and service-provider outage flags | Sanitized metrics, timestamps, event IDs and safe error codes | No application secrets, raw authorization headers, payment payloads, customer document bodies, prompt/voice content |
| Security center | Admin sign-in and MFA posture, failed privileged auth alerts, tenant/RLS check results, protected configuration health, audit log search and incident escalation | Protected security metadata and redacted actor/action/target IDs | No global raw user-data explorer, customer-record export, unrestricted SQL runner or unlogged administrative actions |

**Clear statuses:** show `Not configured`, `Not connected`, `Healthy`, `Degraded`, or `Unknown` based on verified backends. Never display mock revenue, paid entitlements, uptime or AI quota as actual live figures.

## 3. Privilege model

**Roles are separate from business roles** and checked on every platform API call:

- `platform_owner`: one or more explicitly bootstrapped, verified operator accounts. Manage admin membership through a *separate reviewed process*, not a user-editable profile field.
- `platform_support_reader`: masked account and workspace metadata plus support cases; no billing ledger, security secrets or customer content.
- `platform_billing_reader`: subscription state and aggregated/reconciled revenue (only after Stripe integration); cannot initiate transfers/refunds or edit customers' invoices and payments.
- `platform_security_auditor`: read-only security telemetry, role changes and audit events; cannot change roles or access customers' records.

At MVP, only `platform_owner` is needed. The other roles are **future least-privilege scopes**, not automatically created users.

**Mandatory controls:**

1. **Out-of-band bootstrap** of initial platform owner, with authenticated identity and validated MFA. No public signup flag, hard-coded email allowlist, query string, app role or `user_metadata` can confer platform privileges.
2. Keep platform roles in a protected server-side source of truth (e.g. locked `private` schema with strictly controlled grants). If using Supabase `app_metadata`, it must be set only by a privileged server and checked for session freshness/revocation. Never derive authorization from editable client state.
3. Server/Edge Function endpoints must validate authenticated user and current active platform role. Fail closed on missing, expired or insufficient privileges. **Require phishing-resistant MFA where supported, otherwise TOTP MFA, at least AAL2 for privileged access;** confirm actual Supabase support before implementation.
4. Prefer separate, narrowly scoped read models or audited backend queries rather than a generalized service-role data API. Service-role/Stripe secret keys **never** enter browser bundles, logs or local storage. Protect all privileged backend functions against bypass of RLS.
5. No customer business data is visible by default. Any future break-glass access needs a documented customer support case/legal basis, scoped business/record/time, explicit operator action, additional authorization, strong audit evidence, and business/legal notice when required. Break-glass is **out of scope** for initial release.
6. Append-only, tamper-resistant audit trail (including denials) for authentication, data reveals, exports, operator role changes and attempted state changes. Restrict who can read/delete; define retention according to approved privacy/legal policy, not an unverified promise.
7. Rate-limit privileged APIs, enforce pagination and safe search, apply security headers and CSRF protections where session/cookie model requires, protect against IDOR by testing every endpoint under unauthorized identities.
8. Sensitive actions in future releases (suspension, refunds, grants, plan overrides) require explicit confirmation, reason and higher assurance; provide reversible or dual-control workflows where feasible.

## 4. Data model and integration contract (proposed, not deployed)

- Platform identities and roles: protected operator membership/permission table; no exposure through `business_members`; separate privileges from subscriber tenancy.
- Sanitized `platform_admin_audit_events`: event ID, acting admin, action, minimal target identifier, reason/case, result, request ID, timestamp; **no content, keys, card data or tokens**. Partition/retention later.
- Subscription summary: read-only projection from **validated Stripe webhook** state + verified reconciliation; ensure tenant mapping, idempotent event handling, replay safety, and event ordering. Billing source of truth is not the browser or plan preference.
- System status: server-created operational aggregates. Provider details (Stripe, Supabase, Vercel, Resend, OpenAI) displayed only where configured and verified. Never query provider admin APIs directly from customers' browsers.
- Security alerts: redacted events from auth and security monitoring, actor-safe correlation IDs, alert status.
- Recommend a standalone admin interface deployable independently of the customer bundle, with own CSP/auth/session configuration and independent rollout/kill switch. Choose hostname and deployment design after domain and security review.
- **No production schema migration, service-role access expansion, Stripe billing activation, or admin user creation is authorized by this roadmap.**

## 5. User experience / navigation

Console landing view: four modules (Users & Businesses, Subscriptions, System Health, Security), each explicitly labeled with its verified data freshness. A top bar displays staging/production environment, signed-in operator, MFA state, last refresh and a clear sign-out action. Never show real customer invoices or financial transactions.

1. **Users & Businesses:** count, paginated directory, masked identity, email verification status, membership roles, created date, provider auth status, safe support-reference lookup. Access or correction requests routed to auditable support workflows, not direct editing initially.
2. **Subscriptions:** status counts and server-reconciled trial/plan data; provider payment events summarized by ID and timestamps only, with direct links to the authorized Stripe dashboard for any financial action. Show `Not activated` while paid checkout remains disabled.
3. **System Health:** health indicators, recent deployment, API error rates, latency percentiles, provider connectivity, last successful webhook/edge runs, stale-data warnings and incident notes.
4. **Security:** verified MFA posture, unsuccessful admin logins, recent privileged activity, RLS/tenant checks, audit entries and recommended remediation. No buttons to disable RLS or relax security.

## 6. Implementation sequence, dependencies, acceptance criteria

### Phase A — security foundation (must pass before any admin console is exposed)

- [ ] Document operator identity and platform scope; design protected schema/API and audited role bootstrap.
- [ ] Implement platform-only authentication with enforced MFA and server-side authorization; default deny.
- [ ] Verify token/session lifecycle, logout, role removal/revocation and protection from business-owner/admin privilege escalation.
- [ ] Add a separately deployed admin origin (or equivalent isolated deployment architecture), protected route and feature kill switch.
- [ ] Add immutable-enough audit logging and safe structured errors; no secrets or customer content.
- [ ] **Gate A:** a user or business owner cannot reach any admin API or summary; unknown/unverified operator, MFA bypass and role downgrade all fail; no leaked credentials or PII.

### Phase B — read-only MVP (four requested areas)

- [ ] Build Users & Businesses directory with safe pagination and protected minimal metadata.
- [ ] Build Subscription monitoring showing *actual* status; display `Not configured` while Stripe webhooks, subscriptions and reconciled entitlements are absent.
- [ ] Build health overview with timestamped aggregate checks and no source payload leakage.
- [ ] Build Security page with authentication, audit, privileged role posture and alerts.
- [ ] **Gate B:** counts reconcile with controlled staging fixtures; roles see only approved fields; no customer invoices/payments/files/messages visible to operators by default; no payment API write path.

### Phase C — staging QA and operational readiness

- [ ] Create two independent test customer businesses plus separate unauthenticated, customer owner/admin, support-reader, billing-reader, security-reader, and platform-owner test actors.
- [ ] Verify **server-side** permission matrix for GET/POST/PATCH/DELETE and guessed IDs, including off-tenant and revoked operators; all forbidden access fails (including raw API calls).
- [ ] Run at least **1,000 synthetic permission/input cases** across account search, status filters, pagination, stale state, error/retry, resource exhaustion and role-change races. Do not send live emails or real charges.
- [ ] Verify MFA expiry, session theft/revocation scenarios, audit coverage, throttle limits, masked UI and output sanitization.
- [ ] Verify Stripe webhook replay and out-of-order events with test-mode fixtures only, once billing exists; zero money movement.
- [ ] Run responsive Chromium + iPhone WebKit + actual mobile acceptance; accessibility checks; performance and observability checks under bounded load.
- [ ] **Gate C:** all critical security scenarios pass, zero unauthorized disclosures or mutations, build and regression tests green, human security review approves.
  
### Phase D — controlled release (separate approval)

- [ ] Verify legitimate Finviant domain and support/legal details, least-privilege Vercel/Supabase/Stripe configuration, DNS/HTTPS and monitoring.
- [ ] Owner explicitly authorizes **each** production migration and rollout. Test release/rollback process.
- [ ] Enable an initial platform owner only after MFA, policy, logs, privacy review and incident runbook are complete.
- [ ] Keep subscriber-facing finances and customer records inaccessible from admin console by default.
- [ ] Defer administrative writes (suspend user, disable workspace, refund, upgrade/downgrade entitlements, manage staff roles) to a separate, explicit reviewed release.

## 7. Release blockers and dependencies as currently observed

- The current Velnu/Finviant codebase has **per-business owner/admin/office/technician/viewer roles**, not a secure platform-operator role.
- `user_plan_preferences` represents selected Free/Basic/Pro interest, **not** live paid subscription entitlement. Stripe payments/subscriptions are not considered activated by this plan.
- Email sender domain verification, real provider delivery and AI staging configuration have not been proven release-ready; do not label these as healthy.
- Existing Supabase leaked-password protection warning and any other security advisor findings must be reviewed before launch.
- The ongoing **Finviant brand transition** should not silently change authentication redirects, sender domains, provider credentials, or prior accepted legal agreements.

## 8. Out-of-scope / do not build without explicit authorization

- Customer invoice, payment, estimate, note or document browsing by platform admins.
- Generalized impersonation, unrestricted SQL console, raw production data export.
- Direct refunds/payouts, plan entitlement overrides, manual payment capture, payment-method access.
- Secret-key viewing, customer audio/prompt access, bulk messaging, or account deletion through the platform console.
- Silent privilege changes or hidden support access.

**Definition of done:** a distinct, authenticated and MFA-protected Finviant Platform Administration workspace can present **truthful, read-only, least-privileged user metadata, subscription state, health metrics and security telemetry**, with audited access and passing staging isolation tests. No direct access to subscribers' private financial transactions or customer records. This document creates a roadmap **only**.
