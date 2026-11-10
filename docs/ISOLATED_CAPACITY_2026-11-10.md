# Isolated API/database/storage capacity campaign

This campaign can only create its own disposable local Supabase platform on a standard GitHub-hosted Ubuntu runner. The repository was verified public through the connected GitHub API; standard public-repository runners are free under the current [GitHub billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage). No larger runner, hosted project, provider credential, paid service or live business is used. Safe aggregate results are retained for seven days; no Auth/session data or raw logs are uploaded.

The complete source migration chain is replayed and its financial, tenant, genuine-session, Storage and restore checks run first. The load fixture then creates 300 password-authenticated owners/workspaces, 6,000 customers, 12,000 jobs, 6,000 invoices with 12,000 line items, 1,500 payments, and 300 actual private PNG attachments of approximately 0.75 MB each. Records contain synthetic history only. All actors share localhost; sign-in/refresh limits are raised only in this disposable Auth configuration, so this is not an Auth IP-throttle certificate.

A global request pacer enforces the request-rate ceiling, including refresh and teardown. HTTP latency excludes this deliberate pacing; pacing delay and peak simultaneous HTTP requests are reported separately.

Run 10, 50 and 100 concurrent client loops for 90 seconds each, capped at 50 requests/second with think time, then a controlled restart of the owned PostgREST service and a 60-minute 50-client soak. Work rotates across all 300 workspaces. It includes directory/overview/financial reads, customer/invoice lists, manager note saves, idempotent invoice requests, real private-file reads/hashes, cross-tenant REST/RPC denial, and session refresh. A deliberately discarded successful response is retried without duplicate invoices.

Stop on any unexpected integrity/permission/transport error, over 250,000 requests, or p95 above 1,500ms in a completed measured phase. Requests timeout at 15 seconds. The explicit recovery phase records expected service/network interruptions separately. The outer workflow timeout is 95 minutes. Every exit tears down only its own unique local containers; successful runs additionally prove all fixture users, businesses and files were removed.

Capture phase latency percentiles/errors/bytes, restart recovery time, duplicate-write checks, database connection/lock counts, database size, owned database/API container CPU/memory, and sanitized representative query plans. Query expressions, row values, identifiers, passwords and tokens are excluded from published receipts.

This runner combines load generation and services on one machine. It does not measure Vercel/hosted Supabase networking, real provider latency, browser rendering, hosted Edge Functions, device performance or calendar queue delivery. Cron and billable-provider configuration stay disabled; queue-lag acceptance remains separate. Results must identify this scope and hardware rather than claim production capacity for hundreds of businesses.

Run through the one-off `review/capacity-soak-20261110` PR workflow. A successful source-only build or mock stress test is not a completed campaign. Actual execution and immutable result receipts are pending.
