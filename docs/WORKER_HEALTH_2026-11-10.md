# Worker health coverage

The existing protected health endpoint assessed only email and the sandbox payment inbox. Read-only review found a healthy response while the calendar worker had repeated database failures. The candidate adds aggregate calendar, appointment reminder and recurring-plan signals to the same service-only function and authenticated operator endpoint.

## Signals and response

HTTP 503 indicates any stale/dead calendar work, an enabled calendar requiring reconnection, stale/uncertain/recently failed appointment delivery, an overdue recurring plan, or a recurring plan requiring review. Existing email and sandbox reconciliation checks remain. Missing, invalid or negative critical counters also fail closed. An empty, valid response remains HTTP 200.

Stale means due for more than 30 minutes. Future queued work is informational. A recurring plan becomes overdue after its local scheduled date; an intentional pause without an error is healthy. Appointment blocks are informational because disabled delivery preferences and absent channel eligibility can deliberately block work. Uncertain deliveries require reconciliation, never blind retry.

The response contains counts and a checked time, with no customer contacts, document contents, provider error payloads or credentials. CREATE OR REPLACE preserves the established function ACL. Anonymous and signed-in customer roles cannot invoke the aggregate function or read private queues.

## Validation and deployment

- `tests/settings/worker-health.test.ts`: synthetic PostgreSQL fixture verifies failure/recovery, future work, paused/ended plans, service-only execution and no private queue reads.
- `tests/recovery/healthStatus.test.mjs`: every critical signal, missing signal and invalid counter is checked; generated combinations exercise alert assessment.
- `tests/migrations/release-smoke.sql`: complete Supabase migration replay checks the actual function, current table definitions and service-only ACL.
- `scripts/build-beta-edge.mjs`: reproducibly packages `reliability-health` with the existing operator-token authentication.

Apply the health migration only after the appointment reminder schema. Deploy the packaged health function after the migration so the new critical metrics exist. A pre-migration new endpoint fails closed, rather than reporting healthy with missing metrics. Verify anonymous denial and compare the deployed source to the package. Capture safe aggregate health and exact deployment versions.

## Operator response

For calendar failures, inspect restricted scheduler/runtime logs and role/view dependencies; preserve existing queue rows and provider event identifiers. For uncertain delivery, reconcile the provider receipt before allowing another attempt. For recurring review, inspect the owning business's access, customer and source invoice before resuming. A restored healthy result establishes current aggregate state only, not provider success.

External uptime polling, notification routing, error tracing, Web Vitals, spend budgets and a received incident alert remain unverified. This change does not claim an on-call alert was delivered or close OPS-02/OPS-03. Do not enable a paid monitoring service or contact an unapproved recipient as part of deployment.
