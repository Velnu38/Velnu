# Isolated release migration replay

Run `node scripts/qa/replay-migrations.mjs` from an installed checkout on a machine
with Docker and Node 22. The CLI is pinned to 3.1.0. PostgreSQL uses Supabase's
major-version-17 image and real managed Auth/Storage initialization. The report
records exact PostgreSQL/extension versions and every SQL file's SHA-256.

The runner creates its own temporary project. It accepts no database URL or
project ref, inherits no hosted/provider credentials, refuses existing identities,
files or application relations, and applies all source migrations in version
order without extracting fragments. It does not reset, connect to, or write a
hosted database. Local cron execution is disabled before app migrations. Fresh
delivery configuration must remain disabled and Vault must remain empty.

Only the unique owned project is stopped and its disposable volumes removed.
Never replace this with a linked `db reset`, `stop --all`, a beta database URL or
copied business data. CLI status/log output can contain local keys and is not
published. Public CI prints only file hashes, safe SQL error identifiers and
aggregate acceptance results; no raw CLI artifacts are uploaded.

The workflow runs on ordinary Ubuntu public-repository runners with read-only
repository permissions and no hosted secrets. A passing replay establishes a
fresh schema installation, not provider delivery, real browser tenant sessions,
physical-device compatibility, load capacity or safe production cutover.

Existing PGlite fixtures remain useful targeted checks. Run them on Node 22;
Node 24/PGlite compatibility is not established. App/browser/build checks retain
Node 24. Hosted migrations are not reapplied or renumbered by this test.

Rollback for this test tooling is reverting its commit. No deployed frontend,
hosted schema, provider activation or beta records are changed.
