# Finviant Admin Dashboard — internal testing release

The administrator opens `/admin`, or **Settings → Open Finviant Admin Dashboard**. The initial operator is bootstrapped privately to the existing verified Finviant owner account; business-owner/admin status alone cannot confer platform privileges. The administrator must enroll/verify an authenticator before any platform data loads. Do not record or share enrollment QR codes. Operator activation, session validity and AAL2 are checked on each request; removing the operator or session denies subsequent access. The feature defaults off and is enabled only on the staging project.

## Delivered scope

- Overview of registered logins against the ten-account limit, actual Pro entitlements, unresolved support cases, database connectivity and email queue counts.
- Searchable, paginated accounts with masked email, verification/MFA posture and company membership metadata. No password, token, invoice, customer list, recording or private file access.
- Customer issues queue with status/priority filters, chronology, internal notes and customer-visible replies. Case updates compare record versions; conflicts preserve the draft note. Stable request IDs prevent duplicate posts after lost responses.
- Append-only access/action audit visible through a paginated read model. Browser roles have no direct table access; denied and MFA-required requests are recorded with minimal identifiers, not message contents.
- Customers use **Settings → Help & support** to create cases and follow their own case replies. Other users/tenants cannot open their cases. Internal Finviant notes are excluded server-side. Replying to a resolved/closed case reopens it. No external email or SMS is sent by support forms.

This MVP does not offer account deletion/suspension, refunds, payment capture, arbitrary plan overrides, impersonation, SQL execution or editing subscribers’ financial documents. No production/public rollout is included. Stripe/Twilio/AI credentials and real provider testing remain separate; the console does not label unverified providers healthy or invent subscription revenue.

## Verification

Database regression checks cover independent operator/session/MFA requirements, missing AAL claims, role revocation, nonoperator denial, tenant/reporter isolation, internal-note exclusion, retries, stale case versions, masked account metadata and audit access. Browser scenarios cover denied access, the MFA gate, case notes/status updates, mobile fit and failed support submission recovery. Add final CI and deployment identifiers after completion. Actual authenticator enrollment remains an operator action after deployment; no private QR code is saved as evidence.
