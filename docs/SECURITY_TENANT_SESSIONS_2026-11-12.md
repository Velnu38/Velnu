# Tenant, session, Storage and public-link authorization

Scope: SEC-02, based on `c614324a71faba24caeefb75791069b97b75c7d9`, on `security/tenant-separation-20261112`. PR102 is retained. No UI/layout files, paused PR97 work, hosted schema/configuration, provider activation or public release are changed.

## Finding and candidate fix

Ordinary business membership/role checks did not verify that the JWT's `session_id` still existed. A logged-out access JWT can remain cryptographically valid until expiry. Existing administrator session checks do not protect normal REST, RPC and Storage access.

The additive migration binds the request subject to an unexpired row in `auth.sessions`, adds a PostgREST pre-request guard for authenticated requests (including SECURITY DEFINER RPCs), and adds restrictive session policies to existing RLS-enabled public tables and Storage objects. It preserves existing tenant/role predicates, private deny-by-default tables, function grants, fixed search paths, and service/worker membership checks. It refuses to replace a different existing PostgREST hook. A read-only beta inspection found no existing `pgrst.db_pre_request` role setting.

Shared owner, member, role, module, terms, field and Fin authorization helpers also enforce the session boundary. Upload, owner PDF and archive Edge adapters use the caller-scoped session RPC before privileged file operations; failures return no actor. The service key cannot call that identity RPC. No Auth-owned function or table definition is modified.

## Regression evidence

- 28 targeted Node/PGlite/handler tests passed: two controlled business fixtures, foreign membership/role/file denial, deleted/expired/missing/malformed/other-user session denial, metadata spoof rejection, same-session role/membership removal, restricted session-table/RPC grants, fail-closed upload authentication, existing storage quota/role checks, business-card revocation/expiry, approval-handler authorization and error contracts.
- 13 existing canonical-document revision/link tests passed, including rotation, revocation, expiration and immutable publication.
- Six existing disposable-runner safety tests passed. SQL-only replay fixtures now explicitly create synthetic session rows and claims; they remain SQL simulations, not genuine Auth evidence.
- The existing genuine Auth/REST/Storage replay is extended, not replaced: two businesses and three password-sign-in actors, foreign card publication/revocation denial, anonymous card access and explicit revocation, actual logout with the identical old JWT, REST/RPC/private bytes/signed-URL creation denial, and fresh sign-in recovery. It keeps no raw JWTs, capability tokens, identities or file contents in receipts.

## Acceptance limits and release coordination

Local Docker is unavailable. The extended real-platform replay must pass on the existing isolated CI runner before merge or rollout. PGlite uses application fixture dependencies and does not certify hosted Auth/Storage or migration parity. SEC-02 stays open until that evidence and the remaining independent hosted review are complete.

Previously issued signed Storage URLs are bearer capabilities until expiry; session revocation prevents new authenticated downloads/signing, not retroactive invalidation of an existing signed URL. Public business cards are intentionally anonymous capabilities, public logo bytes remain public, and expired estimate links can remain readable while decisions are rejected. Existing canonical-document tests retain those distinctions; do not weaken them to manufacture a pass.

Merge must be coordinated against the latest private-beta head and concurrent app-wide layout branch. Rollout order, only after passing gates: additive migration/request hook, then the three updated Edge adapters. The adapters fail closed if the migration is missing. Do not release just the frontend or claim this source branch changes beta behavior. Verify current hosted hook configuration again before any rollout; compose any newly added hook instead of overwriting it. No production settings or public-launch authorization is included.

Complete SEC-02 also requires its existing independent grant/search-path/operator/AI/webhook/CSP and hosted-role acceptance; this targeted fix does not close those broader requirements.
