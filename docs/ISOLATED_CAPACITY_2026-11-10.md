# Isolated API/database/storage capacity campaign

This campaign can only create its own disposable local Supabase platform on a standard GitHub-hosted Ubuntu runner. The repository was verified public through the connected GitHub API; standard public-repository runners are free under the current [GitHub billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage). No larger runner, hosted project, provider credential, paid service or live business is used. Safe aggregate results are retained for seven days; no Auth/session data or raw logs are uploaded.

The complete source migration chain is replayed and its financial, tenant, genuine-session, Storage and restore checks run first. The load fixture then creates 300 password-authenticated owners/workspaces, 6,000 customers, 12,000 jobs, 6,000 invoices with 12,000 line items, 1,500 payments, and 300 actual private PNG attachments of approximately 0.75 MB each. Records contain synthetic history only. All actors share localhost; sign-in/refresh limits are raised only in this disposable Auth configuration, so this is not an Auth IP-throttle certificate.

A global request pacer enforces the request-rate ceiling, including refresh and teardown. HTTP latency excludes this deliberate pacing; pacing delay and peak simultaneous HTTP requests are reported separately.

Run 10, 50 and 100 concurrent client loops for 90 seconds each, capped at 50 requests/second with think time, then a controlled restart of the owned PostgREST service and a 60-minute 50-client soak. Work rotates across all 300 workspaces. It includes directory/overview/financial reads, customer/invoice lists, manager note saves, idempotent invoice requests, real private-file reads/hashes, cross-tenant REST/RPC denial, and session refresh. A deliberately discarded successful response is retried without duplicate invoices.

Stop on any unexpected integrity/permission/transport error, over 250,000 requests, or p95 above 1,500ms in a completed measured phase. Requests timeout at 15 seconds. The explicit recovery phase records expected service/network interruptions separately. The outer workflow timeout is 95 minutes. Every exit tears down only its own unique local containers; successful runs additionally prove all fixture users, businesses and files were removed.

Capture phase latency percentiles/errors/bytes, restart recovery time, duplicate-write checks, database connection/lock counts, database size, owned database/API container CPU/memory, and sanitized representative query plans. Query expressions, row values, identifiers, passwords and tokens are excluded from published receipts.

This runner combines load generation and services on one machine. It does not measure Vercel/hosted Supabase networking, real provider latency, browser rendering, hosted Edge Functions, device performance or calendar queue delivery. Cron and billable-provider configuration stay disabled; queue-lag acceptance remains separate. Results must identify this scope and hardware rather than claim production capacity for hundreds of businesses.

The one-off campaign passed in [run 42888401958](https://github.com/Velnu38/Velnu/actions/runs/42888401958), job 130082885741. The verified aggregate artifact and digest are preserved in `docs/evidence/2026-11-10-capacity-results.json`. This measured the directory/Overview and existing API paths, not the later Management/customer-search RPCs. Separate SQL/Auth/browser checks cover those changes; a separate 300-workspace reminder receipt covers simulated queue catch-up.

## Measured results

| Phase | Client loops | Requests | Unexpected errors | HTTP p95 / p99 | Pacing p95 | Peak HTTP in flight |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| ramp-10 | 10 | 900 | 0 | 46 / 57 ms | 177 ms | 4 |
| ramp-50 | 50 | 4,500 | 0 | 45 / 50 ms | 998 ms | 4 |
| ramp-100 | 100 | 4,527 | 0 | 41 / 48 ms | 2018 ms | 3 |
| owned-rest-restart | 50 | 1,504 | 0 | 41 / 68 ms | 941 ms | 10 |
| soak | 50 | 178,038 | 0 | 40 / 46 ms | 1023 ms | 12 |

HTTP timings exclude deliberate request pacing. The 100-client phase is not 100 simultaneous HTTP requests. The request ceiling was 50/second. The 60-minute soak made 178,038 requests; its maximum observed HTTP duration was 4,041 ms. Twelve expected interruptions occurred during the deliberate REST restart and are accounted for separately from unexpected errors. Recovery took 1,047 ms and created no duplicate invoices.

All 300 genuine sessions, 6,000 customers, 12,000 jobs, 6,000 invoices, 1,500 payments and 300 private files were verified. The files contained 236,175,600 source bytes. Fifty-six resource samples recorded at most 20 database connections and zero lock waiters; database size ranged from 45,758,131 to 48,854,707 bytes. Every sample confirmed delivery remained disabled. Fixture cleanup left zero users, businesses and files. Provider and hosted-project request counts were zero.

Authenticated representative plans used existing Jobs/customer/open-invoice indexes, with observed execution times of 61.637, 15.643 and 15.551 ms respectively. These tenant sizes were 40 jobs and 20 customers; they do not establish large-tenant hosted latency. Costs and resource behavior on a shared local CI host cannot predict hosted production unit economics. Hosted pool/TLS budgets, concurrent booking/payment/provider/PDF/AI/OCR acceptance and physical-device checks remain separate. PERF-01 and PERF-02 remain open.
