# Request identity query-plan review

The beta advisor reported 23 policies with repeated `auth.uid()` evaluation. The new migration wraps only that request-constant call in a scalar SELECT. It uses `ALTER POLICY`, preserving every existing predicate, role, command and permissive/restrictive mode, including the photo field-access exception and agreement/selected-tier checks. It changes no grants or private helpers. Exactly the verified 23 policies must be found; unexpected or previously transformed definitions abort the migration.

Three Node 22/PGlite tests passed. They compare owner, office, unrelated and missing-identity reads/writes before and after; verify module revocation and agreement mismatch denial; compare policy metadata; and refuse missing scope. The synthetic 12,002-row Jobs query returned the same 6,001 authorized rows, with one identity InitPlan executed once. One local sample measured 101.950 ms before and 78.198 ms after. This single-process fixture is not a production latency promise, concurrency benchmark or 300-tenant soak.

Full-chain PostgreSQL replay and its final-application tenant/financial/reminder checks must also pass before deployment. The review branch is excluded from automatic hosting and rejected by the hosted build guard. PERF-01 remains open for representative plans, selected FK/order indexes, connection budgets and capacity tests. No indexes are dropped based on an unused-index advisor flag.

For a necessary rollback, restore the previous policy expressions only, retaining roles and policy modes; there is no data migration or artifact deletion. Verify genuine tenant sessions separately under SEC-02. This performance change does not enable field accounts or change the manager-operated roster.
