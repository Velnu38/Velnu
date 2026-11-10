# Performance advisor review — November 10, 2026, 19:57 UTC

Read-only review of private-beta project xvybcmyoblfgzokaifsx returned 50 unindexed-foreign-key notices, 66 unused-index notices, four multiple-permissive-policy notices and one Auth connection-strategy notice. No auth identity InitPlan warning remains. The health advisor returned no findings. The security advisor returned zero ERROR findings; its groups were 76 private RLS/no-policy notices, one extension placement warning, five anonymous security-definer RPC warnings and 54 authenticated security-definer RPC warnings. These are inventories, not security acceptance. The authenticated-function count predates the management/customer-search rollout.

Five foreign-key notices touch the Jobs/customer/invoice/appointment paths reviewed here:

| Relation / foreign key | Existing relevant coverage and decision |
| --- | --- |
| Jobs source estimate + business | A unique partial source-estimate index covers every non-null source estimate. Adding an otherwise duplicate composite index is not justified by this notice alone. |
| Appointment business + assigned worker | Existing assigned-worker index and business/start-time index cover common lookups. Composite coverage may help worker deletion/reassignment at larger scale; measure a representative plan first. |
| Invoice deposit estimate + business | Unique active-deposit index excludes void invoices. This is not complete FK coverage; measure void/deletion paths before adding another index. |
| Invoice source deposit + business | Unique active-credit index also excludes void invoices. Preserve uniqueness and assess broader FK coverage separately. |
| Invoice service property + business | No matching property index was present. Location deletion/update and property-filter workloads need representative size/usage measurements before choosing an additive index. |

Job-task and material workspace indexes start with business/job; job/invoice, appointment/job and change-order source indexes are already present. Keep all existing indexes: small private-beta usage does not establish that an unused index is disposable. The separate isolated campaign captures representative authenticated plans and resource samples; inspect its actual results before choosing further filter/order indexes.

Auth currently reserves at most ten database connections. Do not change its allocation from this observation alone. The calendar source pool is capped at three per process with five-second connection timeout, twenty-second statement timeout and three-second lock timeout; aggregate serverless-instance limits, the configured transaction-pooler endpoint, dedicated role and TLS configuration still require environment verification. No hosted load, connection changes or tenant data were used in this review.

Advisor references: [foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [deployment connection guidance](https://supabase.com/docs/guides/deployment/going-into-prod).
