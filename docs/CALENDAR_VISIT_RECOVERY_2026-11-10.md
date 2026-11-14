# Calendar worker visit-assignment regression

Read-only investigation at 13:11 UTC found one Outlook integration whose last recorded sync was November 8, one expired queue lease, and 133 scheduler failures in the prior 24-hour window. The scheduler reports `calendar_scheduler_http_500`; Vercel's safe application log reports `database_transaction_failed`. Successful cron dispatches between attempts do not demonstrate successful synchronization.

The Job Management migration changed the security-invoker `calendar_work` view to read `appointments.visit_worker_ids`. The server calendar role was intentionally granted individual columns before that change. PostgreSQL's actual view dependencies and `has_column_privilege` identify exactly one missing dependency: the newly added crew column.

The repair grants SELECT on that column only. It does not grant full appointment access, customer/financial columns, writes, login, scheduler execution or Vault access. Five calendar setup tests pass locally, including reproduction of the permission failure before the grant, successful expansion of the new view after it, and continued denial of financial reads, appointment writes and Vault reads. Full migration replay now checks the final view's real column dependencies, so another missing-column change blocks release.

Deploy only after final replay and release checks. Preserve the existing queue/lease and let the authorized scheduler retry; do not delete the queue, reset provider event identifiers or force a second event creation. Observe completed synchronization, lease clearance and safe error state separately. If Outlook requires renewed consent, report that state and use the existing reconnect flow. Google credentials and consent are a separate unresolved setup requirement.

Rollback of the grant would restore the known sync failure and is appropriate only if a demonstrated security issue requires disabling that projection. Do not widen table access to avoid a narrowly scoped grant. Genuine Google/Outlook consent, refresh, conflict semantics and physical-device acceptance remain CAL-01 gates.
