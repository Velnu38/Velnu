# Isolated release migration replay

Run `node scripts/qa/replay-migrations.mjs` from an installed checkout on a machine
with Docker and Node 22. The CLI is pinned to 3.1.0. PostgreSQL uses Supabase's
major-version-17 image and real managed Auth/Storage initialization. The report
records exact PostgreSQL/extension versions and every SQL file's SHA-256.

Fresh-platform setup explicitly enables the real `pg_cron` extension using
`supabase/bootstrap/platform-extensions.sql`. The beta already has this extension;
the historical scheduler migration assumes it exists. The first replay identified
that missing prerequisite after 34 successful files (run 42808003740). This setup
file is separate from the unchanged applied migration history and is also hashed
in the receipt. No application functions or permissions are stubbed.

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

## Release check and promotion boundary

`Complete automated test checks` runs for every PR targeting the private-beta
branch and for pushes to that branch. Its reusable scheduling/browser and replay
workflows avoid duplicate PR runs. The aggregate **Release validation** check
fails if any declared suite fails, is canceled or is skipped. It covers build,
TypeScript/PGlite/financial/security/PDF checks, Deno, DOM, all desktop Chromium
shards, iPhone WebKit simulation, personal-app handoffs, mobile billing and full
Supabase replay on the same source commit. Providers are simulated in browser
checks; the replay uses a real local Supabase platform.

Proposed repository configuration for owner review: require the GitHub Actions
**Release validation** status on `ux/private-testing-20261029`, require the tested
head to be current before merging, prevent force pushes/deletion, and permit only
the intended maintainers to promote a tested release. Keep the existing private
Vercel preview admission and environment guard. Apply no repository security
settings from this test runner. Ruleset reads currently return an empty list;
branch-protection/required-check enforcement has not been certified. A workflow
file does not enforce repository rules and does not stop an automatic Vercel build
that is already configured to start before CI. That staged-promotion dependency
remains open under CI-01/REL-01.

The replay review branch disables Vercel automatic deployment and is also
rejected by the hosted-build guard. The test does not promote domains, apply
hosted SQL, activate a provider or change pricing.
