# Isolated reminder backlog check

This test creates 300 synthetic workspaces with one due appointment reminder each in the uniquely owned disposable local PostgreSQL platform. Synthetic database identities are used here; the separate Auth/Storage and capacity campaigns verify genuine password sessions and JWT access.

The final application RPCs prepare batches of at most 50 and list batches of at most 25. Four independent service-role connections intentionally overlap work. Each successful claim gets a ten-millisecond local provider simulation, then a synthetic accepted receipt or one deliberately uncertain outcome. Assertions require exactly 300 allowance reservations, 299 accepted message records, no duplicate dispatch, no queued/sending remainder, and retention of the uncertain outcome without automatic resend. A repeat prepare/list must not recreate deliveries.

The receipt reports preparation duration, original oldest queue lag, total catch-up duration, claim p95/p99, overlapping claims safely skipped and final counts. A two-minute dispatch deadline and 2,400-claim ceiling bound the check. No HTTP provider, live customer, hosted project, cron invocation or paid infrastructure is used. Every exit closes the SQL clients and removes only the owned synthetic fixture; successful runs prove no users, businesses, queue entries or messages remain.

This is queue backend throughput and concurrency acceptance with simulated provider outcomes. It is not a hosted Edge-worker, real delivery, cron-cadence or platform capacity certificate. Runtime verification is pending in the full PostgreSQL migration workflow; PERF-02 remains open.
