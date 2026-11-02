# Owner settings, team access and invoice payment options

The private testing workspace keeps five Pro seats: the primary owner and four additional named users. This release adds separate Settings destinations for Company profile, Team & access, Invoice & estimate setup, Calendar connections, and Subscription.

## Team and access

Only the original business creator with an active owner membership can manage members or invitations. Administrators cannot manage users. Browser membership writes are revoked; authenticated database functions enforce primary ownership. The owner's identity cannot be changed by these functions.

Invitation creation and acceptance lock the business row. Active members plus unexpired invitations cannot exceed five. Invitations expire after seven days; canceling an invitation releases its reserved seat. Resending creates a new token and invalidates the previous link. Only a SHA-256 hash is stored. Acceptance requires the invited email to be confirmed, agreement acceptance, a valid invitation, and a current Pro entitlement. Existing users join without buying another subscription or creating a second business. Invitation acceptance is safe to retry. Removing a member preserves their records and revokes future workspace requests.

Office staff can be given Calendar & reminders, Jobs, Estimates & invoices, and Financial performance & expenses. Field and read-only roles remain subject to their existing role limits. Customers and locations remain shared reference data. Module restrictions apply to direct REST requests, document/financial tables, parent-linked photos/expenses, assistant access, calendar synchronization, and QuickBooks endpoints. The assistant requires all four areas because its queries and actions can span them. Database access changes apply immediately; the UI refreshes access on focus and every 30 seconds. Already downloaded content cannot be recalled; photo URLs expire after 60 seconds.

Invitation email is dispatched by `team-management` through the existing Resend configuration. If delivery is unconfirmed, the owner receives an expiring copyable link and the UI states that email delivery is unconfirmed. No test suite sends real emails. Private Vercel access remains enforced, so test invitees also need authorized access to the private site.

## Document setup

Tax defaults apply to new manual invoice/estimate lines and can be overridden per line, including zero for exempt items. Existing and converted documents retain their saved amounts. Calculations remain subject to the existing atomic document functions, decimal validation, and calculated-total guards.

The owner selects HTTPS business payment links for Venmo, PayPal, Stripe, and Cash App. Existing database destination validation rejects unsupported providers, duplicate providers, unsafe schemes, lookalike hosts, and control characters. Only the owner may change saved payment destinations. New invoices snapshot the current links through the existing document creation/conversion functions. Issued payment details remain immutable. Buttons appear on invoice previews/printouts and invoice emails, never estimates. Clicking a payment button never records a payment. The business verifies payment with its provider and records it separately. Fixed-amount external links must match the invoice balance.

The application does not collect, route, or guarantee payment and charges no platform processing fee. Businesses contract with and pay their chosen providers directly. An optional owner-controlled percentage adjustment can be applied to new invoice line prices before issuance. It applies equally regardless of payment method and is off by default. It is not a PayPal/card-specific surcharge and does not guarantee exact fee recovery. Converted accepted estimates retain their agreed prices. Do not use the setting to disguise a prohibited payment surcharge.

Provider references reviewed November 2, 2026:
- https://www.paypal.com/us/legalhub/paypal/useragreement-full (No surcharges)
- https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf

## Subscription cancellation

Settings includes a primary-owner-only cancellation option. During private testing, no billing mapping means “No paid subscription is active,” and cancellation is disabled. This release does not activate subscriptions, create charges, or modify actual external subscriptions during deployment/testing.

`subscription-management` reads the verified server-side `private.business_billing` mapping, retrieves current Stripe status, validates the customer and live/test mode, and requests `cancel_at_period_end=true` only after the user confirms. Errors never claim a successful cancellation. No client-supplied customer or subscription ID is accepted. Records and external merchant accounts are retained.

Before paid billing is activated, provision verified business/customer/subscription mappings, store a least-privilege `STRIPE_BILLING_RESTRICTED_KEY` in Supabase secrets, and set `FINVIANT_BILLING_LIVE` only for the appropriate environment. Existing Stripe ingestion is sandbox-only and does not grant entitlements. A verified production subscription lifecycle webhook and entitlement reconciliation, including expiration at cancellation, remain prerequisites to enabling paid plans; this Settings feature does not bypass that release gate. Subscription sales tax also needs a separate registration/tax decision before paid billing launch.

## Validation

- PGlite executes the actual migration and tests owner/admin/outsider boundaries, seat reservations, acceptance/replay, removal, module isolation, destination controls, and subscription ownership.
- Request handler tests cover authentication, hashing, email uncertainty, billing ownership/mode mismatch, cancellation, and provider failure.
- Browser regression coverage includes desktop/phone Settings, invitation controls, five-seat capacity, restricted navigation, tax/price previews and payloads, external invoice buttons, cancellation confirmation, and invitation onboarding.
- Existing calendar, record resources, financial service, and dashboard browser checks run alongside this suite.
