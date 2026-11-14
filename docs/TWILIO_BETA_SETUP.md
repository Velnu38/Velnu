# Twilio private-beta configuration

Scope: existing beta project `xvybcmyoblfgzokaifsx` only. Credentials, phone numbers and owner verification are still required; this runbook does not activate SMS or certify delivery.

## Secure settings

Enter values directly in the beta project's Edge Function Secrets screen. Never put actual values in Git, chat, a frontend `VITE_` variable, screenshots or evidence.

| Setting | Required value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Approved sending account's AC-prefixed SID |
| `TWILIO_AUTH_TOKEN` | That account's Auth Token; also validates signed callbacks |
| `TWILIO_FROM_NUMBER` | Registered sender in +1 E.164 format; used by Integration Testing |
| `FINVIANT_TEST_SMS_RECIPIENTS` | Comma-separated consenting test numbers; used by Integration Testing only |
| `FINVIANT_CUSTOMER_SMS_ENABLED` | `false` during configuration and integration-test preparation |

The Integration Testing allowlist does **not** constrain managed customer sends or Auth verification texts. Keep managed sending disabled; do not assume adding credentials is harmless to every configured test surface. An authorized owner can deliberately send from Integration Testing once its other requirements pass.

Owner mobile verification separately uses Supabase Authentication's Phone provider. Configure its Twilio credentials/sender through the Auth dashboard, keeping existing email login intact. Do not enable anonymous signup or disable confirmation. Verify the primary owner's mobile through Finviant's existing SMS setup screen. Edge secrets alone do not configure Auth SMS.

## Callback destinations

| Purpose | Configuration |
| --- | --- |
| Inbound replies and STOP/START | Twilio number's **A message comes in**: POST `https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/managed-sms-events` |
| Managed document/card status | Server supplies `/functions/v1/managed-sms-events?request_id=<request UUID>` per message; do not replace or remove its query |
| Fixed Integration Testing status | Server supplies `/functions/v1/twilio-test-events?request_id=<operation UUID>` per message |

Provider callbacks retain `verify_jwt=false` and validate the Twilio signature, account and canonical HTTPS URL in the handler. User-facing functions retain their current authentication. Do not disable signature validation to make a callback pass.

Managed sender activation is separate operator-controlled database state: `private.managed_delivery_accounts.sms_from`, `sms_reply_route`, and `sms_active`. The unique active sender routes inbound replies to one business; do not reuse it across beta businesses. Configure an approved business reply destination only after the owner specifies it; retain email settings. Keep `sms_active=false` until verification/acceptance, and do not fabricate a route just to pass readiness checks.

## Safe local preflight and acceptance

Run `node --env-file=/secure/path/twilio-beta.env scripts/check-twilio-beta.mjs` with a restricted local file outside Git, or run with the same variables provided by the secure runtime. It prints booleans only, makes no requests and sends nothing. A green result validates local shapes and disabled sending only; it does not read hosted secrets or prove sender registration, account balance, deployed configuration or Auth readiness.

Once credentials, registration and owner verification are ready, use the protected Integration Testing screen for one explicitly approved consenting number and bounded send. Verify the signed delivered receipt and actual phone receipt before expansion. Separately verify replies, STOP/START, tenant isolation and delivery failure/uncertain recovery without blind resend.

Appointment SMS currently sends without a `StatusCallback`; its provider acceptance must not be labeled delivered. Complete purpose-specific callback correlation before certifying automated appointment delivery. `SMS-01` remains open; credentials alone cannot close it. No customer messages, purchase or provider activation is performed by this setup preparation.
