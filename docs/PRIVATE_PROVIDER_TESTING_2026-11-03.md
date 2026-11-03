# Private Stripe and Twilio testing — November 3, 2026

Finviant remains an internal testing website. Keep Vercel Authentication enabled for **all deployments**. A temporary share link grants access to people holding that link; it is not a public release. Testers still need a Finviant account and authorized business membership. Do not reuse the owner's login for testers. Use separate test businesses when testing tenant isolation. No invitations or SMS were sent during this implementation.

## What this change provides

Primary owners can open **Settings → Integration testing** in staging. The server separately restricts use to approved business IDs; Barone Landscaping is the initial approved business. The panel supports:

- Stripe-hosted Basic/Pro subscription checkout with test prices, followed by a signed confirmation and a test Customer Portal for billing history, payment-method changes and cancellation.
- Stripe Accounts v2 merchant onboarding and a direct-charge invoice checkout on that business's test merchant account. The invoice's amount comes from the server, never the browser.
- A fixed Twilio text to an approved tester number after explicit permission confirmation. Real Twilio delivery can incur costs; this is not a simulated SMS.
- Recent operations with timestamps. Stripe payment confirmation and Twilio delivery confirmation are distinct from request acceptance. Retry identifiers are preserved without storing phone numbers or message content in browser storage.

Test receipts are kept separately from normal business payments and paid-plan entitlements. They intentionally do **not** mark invoices paid or enable paid Pro. This is a provider-testing harness, not live merchant activation or finished public subscription billing. Existing public purchase prompts and customer communications stay gated. Regular invoice/estimate SMS, recurring collection campaigns, refund reconciliation, automatic subscription entitlements, and real-money activation remain later implementation/release work.

## Existing account configuration completed

Stripe account: `acct_1UEz2sRuE7Wioad5`, test mode only.

| Item | Identifier |
| --- | --- |
| Basic monthly test price — $9.99 | `price_1UXnb7RuE7Wioad5qoWtAJan` |
| Pro monthly test price — $24.99, intended five-user package | `price_1UXnb8RuE7Wioad5ks1z8M5F` |
| Basic lookup key | `finviant_test_basic_monthly` |
| Pro lookup key | `finviant_test_pro_monthly` |
| Test cancellation/billing portal configuration | `bpc_1UXnf7RuE7Wioad5FEQwTkkg` |
| Platform test webhook | `we_1UXnplRuE7Wioad5UGun5CBR` |
| Connect test webhook | `we_1UXnpmRuE7Wioad5xuqQh5hW` |

Prices and portal exist in Stripe; that alone does not prove an application checkout works.

## Secure setup still required

Enter credentials directly into the **Finviant staging project's Edge Function secrets**. Do not place them in chat, source code, frontend settings or any `VITE_` variable. The connected account tools do not supply a deployable Stripe secret key or Twilio credentials, and do not expose a way to write Edge Function secrets. No secret values are included here.

Project: `xvybcmyoblfgzokaifsx`. Production project `qusmeexjbwphoezlcmie` is outside this change.

| Server variable | Value/source |
| --- | --- |
| `STRIPE_TEST_SECRET_KEY` | Stripe **test-mode** server API key for the Finviant account. Live keys are rejected. Give the chosen key access to account reads, test Connect account/onboarding creation, prices, Checkout, subscriptions and portal sessions. |
| `STRIPE_TEST_WEBHOOK_SECRET` | Signing secret of the platform test webhook described below. |
| `STRIPE_TEST_CONNECT_WEBHOOK_SECRET` | Signing secret of the Connect test webhook described below. |
| `TWILIO_ACCOUNT_SID` | Existing Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | Existing account's authentication token, used for API requests and callback validation. |
| `TWILIO_FROM_NUMBER` | Existing SMS-capable sender in E.164 format, for example `+17575550123`. Use the actual provisioned number. |
| `FINVIANT_TEST_SMS_RECIPIENTS` | Comma-separated approved tester phone numbers in E.164 format. Consent is additionally required in the test form. |
| `FINVIANT_INTEGRATION_TEST_BUSINESSES` | Optional override of approved business IDs; default is Barone Landscaping `7dbb21ae-90a1-4918-98d2-c2e95aa89d05`. |
| `STRIPE_TEST_PORTAL_CONFIGURATION` | Optional override; default is the test portal listed above. |

Two **test-mode** Stripe webhook destinations have been created at:

`https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/stripe-test-events`

One destination receives **your account's** events; the other receives **connected accounts'** events. They select `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Copy each destination's signing secret directly into the matching server variable. Provider callback URLs must be reachable by Stripe/Twilio; each verifies its provider signature and does not expose the website or permit anonymous app operations.

Twilio's per-message status callback is set by the server to:

`https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/twilio-test-events?request_id=<operation UUID>`

Complete any sender/trial verification required in the existing Twilio account before trying delivery. Twilio test credentials simulate responses and cannot prove real delivery. No number purchase or account upgrade is authorized or performed by this change.

## Verification and known limits

Local production build, strict handler type checks, ten new database/handler tests, ten existing settings tests, and 22 deployment-isolation tests passed before publication. Database tests cover owner/outsider restrictions, service-only receipts, immutable retry IDs, duplicate checkout prevention, server-derived invoice amounts, signed callbacks, callback-before-response ordering, and unchanged invoice balances. The browser download was blocked by a truncated network response; desktop/phone checks are included in CI instead. Record final CI/deployment outcomes below after release verification.

No actual Stripe checkout, merchant onboarding, SMS delivery, subscription cancellation or refund was completed against provider credentials during this work. These are pending secure setup, not passed tests.

## Operator test sequence

1. Open the protected site through an authorized tester link and sign into an authorized test business.
2. Add the server settings above, then open Settings → Integration testing and Refresh test results.
3. Prepare a test subscription. Use Stripe test card data, return to the app, and verify a **Paid** test receipt after the signed webhook arrives.
4. Open Manage test subscription; change the test payment method and schedule cancellation. Refresh results and verify Stripe reports cancellation at period end. Test receipts never grant paid access.
5. Set up the test merchant with synthetic business details, create an issued test invoice, and prepare its payment. Confirm it appears on the merchant's test account and as a separate **Paid** test receipt. Its ordinary Finviant balance intentionally remains unchanged.
6. Enter one allowlisted tester number, confirm permission, and send the fixed text once. Refresh until **Delivered** or a clear failure appears. Do not start another request to recover an uncertain send.
7. Test missing fields, nonowner access, another business, double-clicks, lost responses and invalid callback signatures. An expired/uncertain request may need operator reconciliation; the system refuses to create duplicate financial requests or silently resend SMS.

## Sources used

- https://docs.stripe.com/connect/accounts-v2
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted
- https://docs.stripe.com/api/checkout/sessions/create
- https://www.twilio.com/docs/messaging/api/message-resource
- https://www.twilio.com/docs/usage/security
- https://supabase.com/docs/guides/functions/secrets
