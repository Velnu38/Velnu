# Finviant recovery release gates — October 27, 2026

Scope: feature/velnu-stage1 and Owedly-Test only. Main, production data, live billing and Wix publication were not changed. Do not equate mocked recovery tests with production certification.

## Verified evidence

- Recovery workflow 40566749222: build, 45 provider/signature tests, 25 email/operator tests and eight backend typechecks passed.
- Deployed access workflow 40567957345: all nine unauthenticated staging probes passed. Customer endpoints returned 401; unconfigured callback/operator endpoints returned 503. Those 503s mean configuration is missing, not that live integrations passed.
- Rolled-back real staging SQL run: 2,009 checks passed. 1,000 estimate-send retries retained one approval link and the same saved payload. Tagged delivery events reconciled a lost acknowledgement. 1,000 sandbox event replays retained one event, without activating a subscription. No provider calls or real customer email occurred.
- Separate quota test: 50 accepted attempts; rate exhaustion, plan exhaustion and wrong-tenant attempts rejected.
- Missing public-table foreign-key index count: 58 before, zero after the reviewed index/consolidation migrations. This is not a load benchmark.
- Earlier application recovery patch passed 80 browser tests. The complete suite is rerun on each branch update. The CI browser installer was bounded and can use the runner's installed Chrome; no tests were removed. Consult the exact commit's run before claiming a final pass.

## Implemented

AI: bounded provider fetch/body processing, attempt reservation before paid work, safe error handling and explicit retries. Scheduling: atomic linked status changes, stable request IDs and duplicate-submit guards. Email: canonical immutable outbox payloads, exclusive leases, retry limits, signed callback verification, provider receipt correlation and operator-only retry worker. Payments: sandbox-only signed event inbox, not full subscription processing. Monitoring: correlation IDs and protected aggregate health endpoint. Performance: foreign-key indexes and split/cacheable vendor bundles. Browser message receipt writes are revoked; tenant reads remain governed by RLS.

The recovery email sender is prepared as adminsupport@finviant.com. This does not establish a receiving mailbox.

## Owner-controlled gates

1. Connect a Stripe sandbox. Only the live account is available. Approve plan/refund/cancellation rules and distinguish Finviant subscription billing from tenants' customer collections. Canonical reconciliation and real sandbox lifecycle testing remain unfinished.
2. Configure Resend signing credentials directly in Supabase; establish the support inbox/forwarder and authorize a test recipient. Keep FINVIANT_CUSTOMER_EMAIL_ENABLED absent/false until actual delivery and callback tests pass.
3. Confirm project-scoped OpenAI credentials and billing, approve a bounded test budget, and test real audio and physical mobile Safari. Attempt budgets are not exact dollar limits.
4. Select the Supabase/backup plan, enable leaked-password protection where supported, provide an isolated restore target and separately back up Storage objects. No real backup restore has been performed.
5. Configure separate FINVIANT_EMAIL_WORKER_TOKEN and FINVIANT_MONITOR_TOKEN secrets (at least 32 random characters), an approved scheduler and a real alert destination. No periodic worker or external alert delivery is active yet.
6. Resolve Vercel's api-deployments-free-per-day quota or approve a plan change. Latest verified domain build is c2999eee; backend changes deployed independently. Later vendor-split changes await a deployable build.
7. Approve an isolated realistic load-test target and obtain independent security review before unrestricted paid launch.

## Deployment and rollback

AI handler v11 and transcription v7 use immutable source 0532ce2b. Invoice email v4, document email v5, Resend events v1, sandbox Stripe events v1, email worker v1 and health v1 use immutable source af306025. No branch-tip remote imports. Callback/operator functions authenticate inside the handler; missing secrets fail closed.

Retain original operation IDs during unknown outcomes. Never delete an ambiguous outbox item to force another send. Disable delivery before changing the queue implementation. Do not roll back to the former client-writable email code after receipt-write privileges are revoked. Replay the complete migration history and run an isolated restore drill before applying staging changes to production.
