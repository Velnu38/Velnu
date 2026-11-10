# Shared provider bursts — November 10, 2026

This candidate adds database-owned, atomic request bursts to the existing provider reservation paths. It supplements their existing plan, consent, monthly quota, idempotency and storage checks. It does not buy a new service, increase plan allowances, activate sending or change beta access.

| Resource | Global / minute | Business / minute | Account / minute |
| --- | ---: | ---: | ---: |
| Fin and transcription attempts combined | 120 | 20 | 12 |
| Receipt scans | 60 | 12 | 6 |
| Quota-reserved image uploads | 300 | 60 | 20 |

GCRA buckets refill continuously, use server time and lock in global/business/account order across replicas. A rejection rolls back every bucket and parent reservation change. Existing AI per-business/per-operation limits remain in force. New Fin/voice requests reserve their monthly allowance and first provider attempt in one transaction; a pre-provider rejection cannot consume a new allowance. Later Fin lookup rounds still count provider attempts. This does not claim automatic reimbursement for an already-started provider request or an uncertain provider outcome.

The private table and limiter cannot be called, read, reset or edited by client or service roles. Only the existing checked reservation functions reach it. A separate service-only aggregate health RPC exposes a timestamp, bucket count, stale count and global cooldown count. The hourly bounded pruning task removes only expired limiter counters, not business records or usage history. No IP addresses, customer content, tokens or provider payloads are stored in this table.

A database rejection returns HTTP 429 with a bounded Retry-After header. Fin, the legacy assistant/command parser, transcription, receipt scanning and attachment upload preserve that delay without calling the provider. Request readers bound both streamed bytes and upload time, including absent/incorrect Content-Length. Manual customer, job, document and expense entry remains independent of these provider counters.

## Validation and remaining scope

Local checks: 92 focused PostgreSQL/HTTP/voice/Fin/receipt/upload tests and 72 recovery tests pass; build and deployment guards pass. The mandatory complete-schema replay adds 20 concurrent real PostgREST receipt reservations (six admitted, fourteen denied), duplicate and foreign-actor denials, and new Fin/voice allowance rollback checks. This candidate's exact CI and deployed versions must be recorded before calling these hosted or complete.

SEC-03 remains open: public-link/IP abuse, signup/recovery platform controls, all send/payment entrypoints and dollar-denominated provider ceilings still need separate implementation/configuration and acceptance. These limits are provider-attempt ceilings, not financial guarantees or measured load capacity. OPS monitoring/alert delivery and actual provider outcomes remain separate.

## Deployment and rollback

Require final CI, including full migration replay and Deno entrypoint checks. Apply the additive migration only after absence and current reservation-function inspection. Deploy the exact tested Edge packages with each existing authentication mode (receipt-scan remains verify_jwt=false and verifies the user in its handler). Verify retrieved deployed bytes and both frontend domain aliases. Keep old function sources and frontend commit for rollback; do not delete monthly usage or uncertain attempts. Old Edge versions remain compatible with the additive schema, but reverting them loses the new atomic first-attempt behavior and structured delay handling. A reviewed forward SQL rollback would be required to remove limiter calls; do not drop referenced functions or counters while active.

PostgREST structured error headers follow the official [custom error documentation](https://docs.postgrest.org/en/v14/references/errors.html#add-http-headers-with-raise).
