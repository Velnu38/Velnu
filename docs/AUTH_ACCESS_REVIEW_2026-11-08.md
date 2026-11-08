# Finviant authentication and account recovery review

Reviewed: November 8, 2026 (America/New_York). Scope: active finviant.com beta project xvybcmyoblfgzokaifsx, application routes/forms, database access guards, provider settings and targeted regression tests.

**Verdict: improved controlled beta; not yet certified for unrestricted public signup.** This is an engineering review, not a penetration-test or compliance certification. AUTH-01 and SEC-01 remain open in the canonical assessment. Configuration on the separate production project must be verified at cutover.

| Area | Finding and disposition | Evidence / remaining acceptance |
| --- | --- | --- |
| Public access point | finviant.com uses application authentication; customers do not need Vercel identities. /auth supports signup, signin and direct reset mode. | Prior unauthenticated domain HTTP checks; no assumption that Vercel preview access grants app access. |
| Account email redirects | Obsolete preview Site URL and empty allowlist caused the observed recovery 404. Corrected to https://finviant.com and domain-scoped https://finviant.com/**. Client now also canonicalizes hosted auth email redirects to owned domain. | Provider saved UI and redirect regression. Existing email links retain old destinations; request fresh links. |
| Sign-in | Email trimmed/lowercased; existing shorter passwords remain accepted at login. Password-manager autocomplete, show/hide control, disabled pending forms and accessible status messages. | DOM form regression; no passwords requested or changed for customers during review. |
| Signup | Confirm-email enabled. New-password minimum 15, confirmation field, passphrase guidance and 72-byte bcrypt bound in client. Existing-user guidance routes to sign-in/reset without identifying whether an account exists. | Provider saved policy and mocked signup tests; real new-user/inbox acceptance pending. |
| Weak/compromised passwords | Enabled provider leaked-password rejection; security advisor warning disappeared. No arbitrary composition rules or routine forced rotation introduced. | Provider UI, screenshot and advisor. Actual rejection of controlled compromised test password still pending. |
| Email identity changes | Secure email change enabled: old and new addresses both confirm. Manual identity linking and anonymous sign-ins disabled. | Provider configuration inspection. Real change/revert flow pending. |
| Recovery | Uses provider reset links, one-hour email-link expiry and newest-link instructions. Invalid/missing-session links show reset-request form. A fresh-link action is available and direct /auth?mode=reset remains usable even with an existing session. Password mismatch blocked; passwords cleared on success. | DOM tests. Expiry, one-time replay, email scanner behavior and cross-device inbox checks still required. |
| Password change | Enabled secure password change (recent session or reauthentication required); stale-session errors request fresh recovery link. No requirement to know old password added to forgotten-password flow. | Saved provider settings; old-session API behavior needs controlled real-user test. |
| Logout after reset | Global sign-out requested; failure explicitly shown with retry. Continue disabled until provider confirms sign-out. | DOM failure/retry test. Global sign-out revokes refresh access; issued access JWTs can remain valid until expiry (currently up to one hour), except endpoints with explicit live-session checks. |
| Session lifetime | Changed unlimited sessions to 30 days absolute / 7 days inactivity. Multi-device access retained. Refresh reuse detection on, 10-second grace; access JWT 3600 seconds. | Persisted settings verified after reload. Limits enforced on refresh; not instantaneous session destruction. Device/long-idle tests pending. |
| Brute force / spam | Provider IP limits: 30 signup/signin and 30 token verifications per 5 minutes; 150 refreshes per 5 minutes. Rate-limit messages are actionable. | Configuration read; no abusive traffic or load generated. Distributed attack controls/CAPTCHA and legitimate shared-IP tests still need evaluation. UI disabling is not a security rate limiter. |
| Auth email sender | **Public-launch blocker:** built-in Supabase sender; custom SMTP warning visible. Existing Resend document email setup does not configure Auth SMTP. | Configure verified production sender, branding, logs, quotas, and actual mailbox delivery. Do not imply sender is ready because invoices deliver. |
| Security notifications | Password/email/MFA-change notification switches disabled. | Enable and test with dedicated authentication email delivery so notifications do not exhaust built-in email limits. |
| Beta authorization | Registration allowlist, ten-account slots and confirmed email gate separate from Vercel approval. Existing-account access is not revoked by stopping new registrations. | Database trigger/RPC source and targeted database regression suites. Maintain distinct account suspension process. |
| Workspace authorization | Business membership and RLS provide data authorization; client route gates alone are not security boundaries. No service-role key introduced in browser. | Source inspection and targeted tests; broad independent tenant isolation remains SEC-02. |
| Platform administration | Active operator + confirmed email + live session + AAL2 and verified MFA checked by server. TOTP manual setup key plus QR; key held in component state, removed after verification. | Admin database and DOM regression. Business owner role alone does not grant platform administration. |
| Ordinary user MFA | No end-user MFA settings/challenge journey implemented. Do not advertise all-account MFA. | Evaluate optional owner/team MFA and role-sensitive enforcement after real enrollment/recovery testing. |
| Emergency recovery | No tested identity-verification/runbook for lost mailbox or administrator lost authenticator. | Name backup operator/developer, evidence requirements, escalation and audit trail. Never delete/recreate accounts or disclose reset tokens as routine support. |
| Browser/token exposure | TLS hosting, no-referrer, frame denial and partial CSP configured. Persistent browser sessions remain exposed to same-origin XSS. | Full CSP/script controls and token-safe monitoring remain SEC-02; do not log query/hash/session/reset credentials. |
| Operational visibility | Auth audit SQL returned no last-24-hour entries; not proof of no events or no incidents. | Configure provider logging/retention, alert on failures and suspicious resets, test alert routing and scrub PII. |

## Verification scope

Targeted rendered form tests cover invalid credentials messaging, email normalization, reset redirect, signup password policy and confirmation, invalid recovery links, mismatch rejection, global sign-out failure/retry, and administrator manual MFA setup. Pure policy tests cover canonical hosted redirects, Unicode/byte bounds and error privacy. Build includes TypeScript and deployment/startup regressions. Database suites exercise beta/customer and platform access guards. These tests use controlled local mocks/PGlite where applicable and do not certify actual inbox delivery, physical devices, abuse resistance or an independent security review.

## Required before public release

1. Finish dedicated authentication email delivery and security notifications, with safe sender configuration and actual mailbox tests.
2. Run new-account through agreement/business creation and reset/sign-in on real iPhone/Android, separate browsers and expired/replayed links.
3. Test provider password rejection, session expiry/revocation windows, operator MFA and lost-factor recovery with disposable authorized test identities.
4. Test abuse controls, shared-IP access, independent tenant isolation and monitoring alerts; finish incident/access-recovery runbooks.
5. Revalidate the same settings against the final production backend and final immutable release.

References: Supabase password security https://supabase.com/docs/guides/auth/password-security ; sessions https://supabase.com/docs/guides/auth/sessions ; email templates https://supabase.com/docs/guides/auth/auth-email-templates ; audit logs https://supabase.com/docs/guides/auth/audit-logs .
