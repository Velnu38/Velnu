# Query profile and isolated load/restore preparation

Baseline: `7875381635b7f9a7b96a38b80cdc5156d0dbbd80`. No hosted traffic, new services, hosting changes, paid provider calls or application query changes were made for this assessment. No index change is justified by the available measurements alone.

## Current measured service behavior

Run `node scripts/qa/profile-record-queries.mjs`. It bundles the actual services with a reserved `.invalid` endpoint and replaces fetch with strict, synthetic responses. It checks business/customer filters, exact counts, paging, maximum workflow batch size and restricted customer-history behavior. Five warm samples at each population measure local JavaScript/serialization only. Response sizes reflect the fixture shape, not actual customer documents. No DB query executes in this profiler; these are client query fan-out and payload measurements, not SQL plans or actual tenant security acceptance.

Receipt: `docs/evidence/2026-11-12-record-query-profile.json`.

| Path | 25 records | 500 records | 5,000 records | Measured concern |
| --- | ---: | ---: | ---: | --- |
| Legacy full jobs list | 2 requests | 4 | 35 | Ten sequential list pages, then 25 sequential workflow batches at 5,000 jobs |
| Invoices list | 1 | 1 | 10 | Complete collection downloaded and sorted locally |
| Estimates list | 1 | 1 | 10 | Complete collection downloaded and sorted locally; later workflow lookups not included |
| Customer history | 5 | 5 | 32 | Three full collections plus customer/properties; 15,000 history rows at largest case |
| Jobs directory first page | 1 | 1 | 1 | Bounded 25-row result; internal database work is not measured |
| Invoice reminder history first page | 1 | 1 | 1 | Bounded 20-row result; internal database work is not measured |

At 5,000 records, synthetic jobs responses total 1,795,035 bytes and customer history 4,020,077 bytes. Their local medians were 43.53 and 60.11 ms, respectively; neither number includes network/database latency. These identify growing request/payload costs, not a measured hosted outage. The Jobs directory is a different use case, not a before/after replacement benchmark. Do not replace complete-list consumers with one page: totals, selection and completeness guards depend on the full result. Customer history also performs sorting and must retain complete/error semantics until an explicit paged contract is implemented. Customer properties still use an unpaged request; investigate its row-cap behavior separately before claiming complete large-property history.

Next independent optimization candidates, in order: measure a page-based customer-history contract with separate exact totals; profile document-list filtering/paging with all export/selection consumers; measure legacy jobs workflow batching for remaining consumers. Keep business/customer predicates, deterministic order, count-change rejection, module restrictions and no-silent-truncation behavior. Any implementation requires matched baseline/candidate fixtures, returned-ID/total equivalence, foreign-tenant and revoked-role checks, and production-equivalent authenticated query plans. Do not increase parallel query fan-out merely to improve a local stopwatch result.

## Earlier evidence and its limits

The November 10 isolated local Supabase campaign (`docs/ISOLATED_CAPACITY_2026-11-10.md`, receipt `2026-11-10-capacity-results.json`) had 300 authenticated workspaces, 12,000 jobs and 6,000 invoices. Its 60-minute soak made 178,038 requests, HTTP p95 40 ms, under a 50-request/second cap. Peak measured HTTP concurrency was twelve, not 100. Existing representative authenticated plans reported 61.637 ms for jobs, 15.643 ms for customers and 15.551 ms for open invoices. These were single recorded plans at small per-tenant sizes, not reliable comparative medians. That campaign predates subsequent management/history/session changes and does not certify this branch or hosted capacity.

The prior restore (`docs/evidence/2026-11-10-synthetic-restore.json`) restored 45 synthetic rows across 127 inventoried tables and actual private-object bytes in 936 ms, preserving balances and checking access. It retained schema/configuration. It is not full infrastructure recovery, PITR, or a production RTO/RPO measurement. PERF-01, PERF-02 and OPS-01 remain open.

## Isolated execution plan — prepared, not launched

Only an owned disposable local platform with synthetic tenants is permitted under this task. Existing `scripts/qa/replay-migrations.mjs`, `local-capacity.mjs` and `synthetic-restore.mjs` provide the isolation foundation. The existing campaign is not silently expanded or run here. Hosted staging is a separate future decision requiring an identified isolated target, provider terms and a zero-cost execution budget; beta and production are never targets.

Preflight must fail closed unless all conditions pass:

- Unique owned `finviant-replay-*` local project; loopback API/database endpoints; no externally supplied destination override. No business/provider credentials, vault secrets or real records. No other person's local stack may be reset.
- Full migration replay from a fixed commit, genuine synthetic Auth sessions and private Storage; cron/delivery workers disabled, provider egress blocked. Stub Fin/OCR/email/payment adapters only; record zero external requests.
- Record CPU/RAM/versions and generator co-location. Ensure no shared CPU-intensive tasks affect comparisons. Reserve cleanup time and verify resource availability before seeding.
- Fixed seed and identical population/query mix for baseline and candidate. Use at least two owners plus office, technician, revoked and anonymous actors for permissions. Do not reuse owner-only query plans as user-role evidence.

| Stage | Target and limit | Gate |
| --- | --- | --- |
| Query profiling | 25, 500 and 5,000 jobs/documents/history rows per selected tenant; at most 50,000 rows per tested collection | Capture authenticated EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), 5 warmups + 30 measured repetitions, returned IDs/counts and payload bytes |
| Smoke | 1 client, 60 seconds, at most 5 requests/sec | Zero unexpected errors or permission/integrity failures |
| Ramps | 10/50/100 client loops, 90 seconds each, global ceiling 50 requests/sec | Report actual in-flight HTTP concurrency separately from client loops and pacing |
| Soak | 50 loops, 60 minutes, 300 distinct workspaces, same 50 requests/sec cap | At most 250,000 requests including setup/refresh/cleanup; wall-clock ceiling 95 minutes |
| Recovery | Restart only owned local REST; discarded-response retry; simulated provider failures | No duplicate business writes; recovery within proposed 30-second local target |
| Restore | Separate quiescent synthetic fixture with schema/config retained first; then separately design clean-instance full recovery | Exact row/file/financial/permission equality; no provider work after restore |

Use a workload mix of 30% jobs directory/management, 25% invoice/estimate list/detail, 20% customer/reminder history, 10% private files, 10% idempotent controlled writes and 5% foreign-tenant/role-denial probes. Execute heavy single-tenant history separately from the 300-small-tenant case. PDF generation and stub Fin/OCR run as separately reported workloads until combined saturation is measured.

Proposed local acceptance targets (not hosted promises): HTTP p95 <=1,500 ms, p99 <=3,000 ms; isolated query p95 <=250 ms at the agreed population, no >10% baseline regression without explanation; zero unexpected errors, leaks, duplicate writes or mismatched totals. Capture endpoint-specific latency, full user-operation latency, pacing, bytes, query loops/buffers, locks/connections, CPU/RAM, queue age and retry counts. Never publish query literals, tokens, record contents or privileged logs.

Stop immediately on a foreign-tenant result, permission bypass, mismatched total/hash, duplicate write, unexpected external destination, enabled sender/cron, or unknown fixture identity. Stop on any unexpected transport/application failure; account expected denials and deliberate outage errors separately. Timeout each request at 15 seconds, DB statements at 20 seconds, locks at 3 seconds. Stop when a completed phase exceeds latency limits; add rolling 60-second monitoring before a new long run. Stop if memory exceeds 80% of the owned container limit, CPU remains above 90% for 60 seconds, any lock waiter persists 10 seconds, or connection usage exceeds the smaller of 24 connections or 70% of nonreserved capacity. These additional resource thresholds are plan requirements, not claims that the current runner already enforces them. Abort before the request/time ceiling; preserve only sanitized receipts and tear down the owned fixture.

## Restore procedure and proposed targets

1. Inventory exact schema migration/commit, configuration names, synthetic identities, table counts and deterministic row hashes; separately inventory private-object paths, sizes and SHA-256. Record database backup and object-copy completion time. Never include credentials in the receipt.
2. Validate the owned-loopback/empty-vault/disabled-worker guard before any destructive step. Existing restore refuses more than 50,000 rows per table or a 64 MiB dump. A large-tenant load dataset must not be passed blindly into this smaller restore harness.
3. Freeze fixture writes, create and verify the database dump and separate private-object copy, then prove the source hashes have not changed. Preserve a known-good disposable snapshot until verification completes.
4. Restore into the owned fixture, compare every inventoried row and object hash, reconcile invoice/payment/deposit/credit balances, verify trigger/constraint/permission state, log in again, and test owner/foreign/anonymous/module-revoked access. Prior sessions must not be assumed valid. No real send, charge or replayed provider call is allowed.
5. Proposed quiescent local target: zero lost committed synthetic rows/objects, backup <=60 seconds and recovery plus verification <=15 minutes. Measure actual values; failure leaves OPS-01 open. These are rehearsal targets, not selected hosted service guarantees.
6. On failure, stop writes/workers, retain safe diagnostics, discard only the owned failed fixture and rebuild from the preserved synthetic snapshot. Confirm cleanup leaves zero fixture users/businesses/files; otherwise report cleanup failure explicitly.

Full clean-instance recovery remains separate: inventory and restore schema, Auth configuration, storage policies/buckets/bytes, deployment configuration and encrypted credential recovery, and establish an owner-approved backup frequency/retention and hosted RTO/RPO. No backup purchase, hosting upgrade or live-beta restore is authorized by this plan.
