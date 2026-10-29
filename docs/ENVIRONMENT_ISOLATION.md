# Finviant environment isolation

Status on 2026-10-28: provisioning approved and the separate production database is installed and verified. Authentication URL configuration and the production domain cutover are still pending. This is not yet a completed domain separation or a public launch.

## Verified starting point

- Repository: `Velnu38/Velnu`; reviewed feature baseline `40532da6251ad33c449e368126ec4f8fb54ed483`.
- Vercel team `mbarone5-1747`, project `finviant-office` (`prj_qSyNebSGZi7kVTE0KyozhMdQ1MLo`).
- `finviant.com` and `www.finviant.com` serve the protected `feature/velnu-stage1` preview. The existing Vercel Production target is older code; changing variables does not rebuild that deployment.
- Supabase `xvybcmyoblfgzokaifsx`, currently named Finviant and previously Owedly-Test, is the staging database. Preserve its existing accounts and records.
- The original shared frontend URL and publishable-key variables were scoped to Production, Preview and Development. No provider or service-role credentials were present in this project's Vercel variable inventory.

## Intended final configuration

| Surface | Source | Backend | Access |
| --- | --- | --- | --- |
| `finviant.com`, `www.finviant.com` | Reviewed `release/production` commit | New `Finviant Production` project, US East | Vercel authentication remains enabled |
| Feature branch and PR preview URLs | `feature/velnu-stage1` and QA branches | Existing `xvybcmyoblfgzokaifsx` staging project | Vercel authentication remains enabled |
| Local development | Local checkout | Staging or a local Supabase instance | Separate local configuration |

Use a dedicated release branch so the older `main` branch and draft PR #4 are not silently released. The release branch starts at the reviewed feature commit plus the isolation changes. Domain reassignment happens only after a production-target build and backend checks pass. Until then, the existing domains continue to be the protected staging application.

The owner approved the $10/month additional project in the existing organization (`ddywjoktgvdueilcgmnt`, mbarone5@verizon.net's Org). `Finviant Production` is provisioned in `us-east-1`, project reference `qusmeexjbwphoezlcmie`. Usage-dependent charges are not established by this project quote.

## Provisioning evidence

- The complete application catalog was extracted through read-only queries, covering the four tables absent from the old migration history. A transactional rehearsal succeeded and rolled back before the production baseline was applied.
- `supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql` matches the production migration version. It is a fresh-project bootstrap, not an incremental migration for the existing staging database. No automated database deployment workflow was enabled.
- All 36 tables (including columns, constraints, indexes and effective grants), 96 policies, 66 function definitions, application triggers, schemas and logo bucket configuration were verified against staging. Five function ACLs are explicit representations of the same implicit PostgreSQL default grants; they are semantically equivalent.
- Future objects created by `postgres` require explicit browser-role grants; default execution by PUBLIC is revoked for new functions. Supabase-managed auth/storage tables and internal storage triggers were not replaced. Platform-owned default privileges remain platform-managed.
- All 16 tenant/finance checks passed in a transaction that rolled back. Afterwards production had zero auth users, businesses, invoices, bookkeeping records and storage objects; all 36 application tables were empty. No staging users, financial records or provider credentials were copied.
- Six live REST probes passed: each project's own publishable key and signed anonymous JWT were accepted, and the other project's publishable key and signed anonymous JWT were rejected with HTTP 401 in both directions. This verifies key/signature separation, not a complete human login or recovery flow.
- Production Vercel variables use the new project and are scoped only to Production. Preview/Development retain the original staging project. Customer actions remain disabled in all targets.
- The QuickBooks callback and document-email origin logic now resolve from the actual backend project. Unknown projects and cross-environment callback overrides fail closed.

## Build safeguards

`npm run build` validates Vercel's target before compiling. Production cannot use the registered staging project; Preview and Development cannot use another project. An explicit environment label, matching HTTPS project URL, publishable frontend key, and production release branch are required. Public variables with privileged credential names or recognizable secret values are rejected without printing their values. Shared staging cannot enable customer delivery.

These checks prevent accidental configuration mix-ups. Supabase RLS and authentication remain the authorization boundary. A publishable key's project association must also be verified against the configured project's API; it cannot be inferred from the opaque key string.

| Variable | Preview / Development | Production |
| --- | --- | --- |
| `FINVIANT_DEPLOYMENT_ENV` | `staging` | `production` |
| `FINVIANT_SUPABASE_PROJECT_REF` | `xvybcmyoblfgzokaifsx` | `qusmeexjbwphoezlcmie` |
| `VITE_SUPABASE_URL` | Existing staging URL | New production URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Staging publishable key | New production publishable key |
| `FINVIANT_PRODUCTION_GIT_REF` | Unset | `release/production` |
| `VITE_ENABLE_CUSTOMER_ACTIONS` | `false` | `false` until provider workflow acceptance |

Keep Supabase service-role keys and provider credentials server-side in their respective Supabase projects. Create independent provider sandbox/live credentials and webhook secrets when those integrations are implemented. Do not copy staging provider secrets into production. No integration is activated by this change.

## Database migration gate

There are 49 recorded migrations, 29 public tables, 7 private tables, and 12 deployed Edge Functions. Comparing the migration SQL with the live catalog found no recorded CREATE TABLE for:

- `public.bookkeeping_entries`
- `public.quickbooks_connections`
- `public.quickbooks_oauth_states`
- `public.quickbooks_transactions`

The repository's `supabase/patches` directory is also not a complete database bootstrap. **Do not replay either set alone and call the new database ready.** Other unrecorded changes to functions, permissions, policies, indexes and triggers may exist.

`scripts/environment-schema-inventory.sql` is a read-only catalog query for comparison. It exports structure and definition fingerprints, not customer records or authentication data. `docs/environment-isolation/staging-schema-inventory.json` records the inspected baseline. This inventory is a comparison aid, not a restore file or proof of complete schema equivalence.

Provisioning sequence:

1. Provision the separate production project in the confirmed organization and region. Keep its new API keys independent.
2. Obtain a schema-only dump of the current application schemas, plus application-owned storage policies/bucket configuration and any application auth triggers. Review security-definer functions, role grants, RLS, extensions, enum types and default privileges. Do not export or copy auth users, sessions, customer records, OAuth tokens, outbox rows or storage files.
3. Establish a complete reviewed bootstrap migration and replay it on the empty project. Run the inventory query on both projects and investigate every difference. Preserve migration provenance without claiming the old history covers manual DDL.
4. Deploy all 12 reviewed Edge Functions with their recorded JWT-verification settings. Keep customer email, payment activation and other external side effects disabled. Configure project-specific origins and callbacks explicitly; legacy staging/default production URLs in email/QuickBooks code require review before those features are enabled.
5. Set production auth site URL to the production origin and restrict redirect URLs to its intended callbacks. Staging uses its preview origin and local development callbacks. Do not copy wildcard production access into staging or vice versa.
6. Verify all public-table RLS policies, privileged-function grants, storage policies and schema parity. Run the disposable tenant/finance tests against each project; confirm fixtures are rolled back. Prove staging tokens are rejected by production and production tokens by staging. Verify new production business/customer/document tables are empty.
7. Configure production-only Vercel variables and build the reviewed release commit as a production target. Verify the frontend uses the new project and the publishable key is accepted by that project's API.
8. Assign both production domains to the verified production deployment. Keep the feature/QA URLs on staging. Verify protected access, login/recovery, environment routing and an independent synthetic workflow in each environment.
9. Inspect historical deployments: old immutable bundles can still reference staging. Keep them protected and remove obsolete domain aliases. Do not claim that an environment-variable edit rewrites old deployments.

Rollback: retain the known-good protected staging deployment and its domain mapping until cutover is verified. A failed production validation must stop promotion. Do not restore a production-facing build with staging credentials as a purported production rollback; use maintenance/protected access until the isolated production build is repaired.

## Validation

- 21 deployment-isolation tests exercise accepted configuration, cross-environment URLs, privileged credentials, customer-delivery flags, release branches and non-disclosing CLI failures.
- A normal frontend build and a Vercel Preview build must both pass.
- Production schema provisioning and cross-project signed-anonymous-token/API-key tests have passed as recorded above. Human authentication callbacks, production deployment and domain routing still require verification before cutover.
