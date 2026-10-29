# Voice transcription: backend security and reliability

Date: October 28, 2026 (America/New_York).

Scope: `transcribe-voice`, transcript database permissions, paid entitlements, and provider-attempt budgets. Initially reviewed `feature/velnu-stage1` at `208f12a83006376efad5f9fcde5731639d836d4d`, which includes server-storage commit `bb65df2de023210f91aa2f9b67fa3d8782bd5f82`. The integrated result also preserves the concurrent voice-hardening commit `52b0f508374ba6f12b3c544f174d612e6f809e2c`, including its 67-test suite and staging API runner. The branch literally named `development` is an older app snapshot without this endpoint; changes are isolated on `fix/voice-backend-security-20261028` for review against the current feature branch.

No production deployment, production branch, hosted database, entitlement, secret, provider account, or customer record is changed by this work. No OpenAI request is made by these tests.

## Confirmed defects and changes

The initial endpoint regression run reproduced **58 passing and 8 failing cases**. A ninth failure was then reproduced for an empty quota-reservation receipt. These are reliability/input-hardening defects; the reviewed database grants did not permit subscriber transcript forgery or cross-tenant reads.

| Reproduction | Previous behavior | Corrected behavior |
| --- | --- | --- |
| Multipart stream exceeds the upload limit, including without Content-Length | Multipart parsing reads/allocates the entire request before the audio-size check | Read and count bytes before parsing; cancel an oversized stream; return 413. Keep the existing 10 MiB audio limit plus 64 KiB multipart overhead. |
| Declared oversized request containing a small valid recording | Header is ignored and provider can be called | Reject before parsing or spending quota. Actual streamed bytes are also bounded independently of the header. |
| Malformed JSON/multipart or unsupported request media type | Generic 500, obscuring caller input errors | Bounded JSON/multipart parsing; 400 for malformed input and 415 for unsupported media type. JSON status requests have an 8 KiB ceiling. Upload reads have a ten-second deadline. |
| Missing storage credential | Provider attempt is consumed before storage configuration is checked | Return 503 before reservation/provider call. Status reports configured only when both provider and storage configuration exist. |
| Invalid JSON storage-secret map | Credential parsing throws after the provider call | Fail closed with 503 before reservation/provider call; accept only nonempty credential strings. |
| Non-numeric voice limit | NaN bypasses the `<= 0` comparison | Require a positive safe-integer voice limit. This protects against malformed internal entitlement responses; subscribers cannot edit the private entitlement record. |
| Null reservation result without an RPC error | Handler proceeds to the provider without a positive reservation receipt | Require `reserved: true`; return 503 otherwise. |

The deployed entrypoint remains a small `Deno.serve` wrapper that injects the Supabase client and environment reader into the exported handler. The Supabase SDK is pinned to the existing endpoint version, 2.57.4, through the npm import scheme already used by other backend functions. Credentials, actor identity, provider, model, and transcript are still authored on the server. No client transcript-write permission was added. Successful recordings return the same `transcript` and `transcription_id` fields. The integrated handler retains ten-second database deadlines and an explicit `voice_storage_unconfirmed` response: a failed acknowledgement cannot establish that no row was saved, and the user is warned to check voice activity before another billable attempt.

## Automated coverage and evidence

### Endpoint: `supabase/functions/transcribe-voice/index_test.ts` and `http_test.ts`

**134 tests passed locally: 67 dependency-injection cases preserved from the concurrent commit plus 67 HTTP-transport cases added here.** The HTTP transport suite exercises the real pinned Supabase client and existing bounded provider helper. Tests run without Deno network permission. HTTP cases install only synthetic environment values, reject unexpected URLs, and restore their global state. The HTTP timeout case injects a typed timeout; the preserved suite and existing provider-helper tests separately exercise actual deadlines, stalled bodies, cancellation, response-size limits, and no automatic retries.

Coverage includes:

- Missing, malformed, expired, and forged authentication; verified actor lookup; forged business IDs; membership lookup errors; client-editable JWT metadata cannot authorize a tenant.
- Free/unactivated/expired entitlement behavior (expiry is verified in SQL), zero/negative/malformed limits, entitlement lookup failure, and authenticated status requests that spend no quota.
- Quota permission errors, monthly/minute exhaustion, RPC failures, missing reservation receipts, and 20 competing handler requests with one remaining mocked reservation. This mocked concurrency case is **not** evidence of PostgreSQL locking; the direct HTTP suite below covers that separately.
- Malformed bodies, missing/empty/oversized audio, incorrect file extension/MIME, invalid durations, streaming limits and cancellation, accepted WebM/Opus, M4A/MP4, WAV, and MP3 metadata.
- Provider authentication/rate-limit/server errors, network errors, timeout, invalid/non-object/oversized JSON, empty/non-string/overlong transcripts. There is one provider attempt per reservation and no silent retry/refund after an uncertain result.
- Storage database errors, network failure, and missing receipt. Failures do not return a transcript/success ID or expose credentials/provider details.
- Successful persistence uses a separate server client without the subscriber Authorization header; multipart `user_id`, `transcript`, `provider`, and `model` cannot override canonical values.

Run: `npm run test:voice:backend` after installing Deno 2.x. Package resolution may access npm; the tests themselves have no network permission.

### Database: `tests/security/voice-database.test.mjs` and `voice-rls.sql`

**Passed locally.** This suite loads the entire repository application bootstrap into disposable PostgreSQL 17 through PGlite, then executes the real grants, RLS predicates, triggers, entitlement lookup and reservation RPC. Assertions raise errors on failure; fixtures are enclosed in a transaction and rollback is verified.

It proves anonymous and subscriber INSERT/UPDATE/DELETE/TRUNCATE/UPSERT are denied; an ordinary subscriber can read only their own transcripts while still a business member; foreign IDs, foreign business filters, other actors in the same workspace, and a foreign workspace row sharing the caller's actor ID remain hidden. It also checks selected-Pro versus activated-Pro, expired entitlement, denial of client entitlement edits, quota boundaries, rate-window reset, and access removal.

The test supplies minimal Supabase-managed `auth`/`storage` names and claim-reading helpers. PGlite does not include pgcrypto; that extension-creation line is omitted only in the embedded harness. No pgcrypto-dependent function is exercised. This validates application database permissions, not hosted Supabase Auth, deployed schema parity, or concurrent connections.

Run: `npm run test:voice:database`.

### Direct HTTP and real contention: `tests/security/voice-api.test.mjs`

The `Voice backend security` workflow starts disposable PostgreSQL 17 and PostgREST 13.0.7 containers. It applies the unchanged application migration and synthetic fixtures, uses signed local-only subscriber/service-role JWTs, and calls actual REST/RPC routes. It checks anonymous/expired/incorrectly signed token rejection, own versus cross-business/cross-actor reads, direct INSERT/PATCH/DELETE/UPSERT denials, and a positive server-role insert. It sends 20 simultaneous HTTP reservations for the final monthly allowance, then 20 for the final minute allowance, requiring exactly one success in each group and checking the stored counters.

The runner refuses hosted databases/APIs and requires an explicit `local-disposable` mode, a loopback database named `finviant_voice_test`, and a loopback HTTP URL. The signing secret is public synthetic test data. No Supabase or OpenAI credentials are required. Without the explicit local configuration this suite reports **skipped**, never a claimed pass. The workflow supplies the configuration so skipping is not possible there.

Run against the disposable containers with:

```sh
FINVIANT_VOICE_API_TESTS=local-disposable \
VOICE_TEST_DATABASE_URL=postgres://postgres:voice-local-test-only@127.0.0.1:5432/finviant_voice_test \
VOICE_TEST_REST_URL=http://127.0.0.1:3001 \
npm run test:voice:api
```

The containers and JWT settings are defined in `.github/workflows/voice-security.yml`. This is a direct Data API permissions/locking test, using minimal Supabase infrastructure fixtures. It does not run Supabase's hosted gateway or GoTrue Auth service. CI results are recorded below after execution.

## Regression validation

- App production build passed locally; this is a local build, not a production deployment.
- 56 existing provider/recovery tests and 21 environment-isolation tests passed locally.
- The 134 voice tests and 22 existing email-handler tests passed with the pinned 2.57.4 SDK in a temporary copy of the same source and Deno 2.5.6. This local package layout avoids the execution environment's blocked Deno npm downloads; no source transforms or service calls are involved. CI uses the normal npm-specifier resolution command above.
- Local Chromium browser checks could not start because its required binary was absent and the download was blocked/truncated. The installed WebKit engine also lacked OS libraries. Neither attempt is counted as a passing browser check. The existing full trial workflow provides the independent browser regression check after integration.

## Remaining launch validation

| Remaining check | What it requires | Required evidence |
| --- | --- | --- |
| Hosted authorization/configuration parity | Disposable staging users from two businesses and staging Supabase credentials; test JWTs issued by real Auth | Actual deployed endpoint rejects missing/expired/forged sessions and foreign business IDs. Run the preserved `tests/security/transcribe-direct-api.mjs` for ordinary-subscriber transcript REST checks; it now requires the exact registered staging URL and verifies each transcript belongs to the named QA business/actor before attempted mutations. Verify deployed schema/grants match the migration. Never substitute production credentials. |
| Activated-plan and quota parity | A disposable staging business with an administrator-activated Pro entitlement; ordinary subscription JWT | UI-selected Pro alone is denied; backend-activated Pro is accepted; expiry is denied. Exercise only the disposable tenant's budgets. No provider call is needed to test reservation RPC locking. |
| Real audio/provider acceptance | A working server-only OpenAI credential on an isolated staging function and activated voice entitlement | A small controlled recording returns a real transcript and stored ID. Check actual unsupported/corrupt container handling, accent/noise quality, latency, and provider error mapping. Automated mocks cannot establish model accuracy or credential validity. |
| Physical microphone and mobile review flow | Physical iPhone/iPad Safari and Android Chrome, permission prompt interaction, plus staging voice access for cloud recording | Grant/deny/revoke microphone permissions; keyboard-microphone fallback; WebM/M4A/MP4 recording; background/interruption handling; slow/offline recovery; transcript to invoice draft review without sending. Desktop emulation cannot prove real-device behavior. |

No claim of full launch readiness or live-provider validation is made. Keep invoice draft review and explicit customer-send approval intact.

## CI execution

Initial security-fix commit `77ccb4904eddd07782c4490d9fe0f62977d44fcc` passed [Voice backend security run 40790667980](https://github.com/Velnu38/Velnu/actions/runs/40790667980): the deployed entrypoint type check, 67 HTTP endpoint tests, embedded SQL tests, and all seven direct HTTP test groups completed successfully. The actual PostgreSQL 17.11/PostgREST 13.0.7 run confirmed both groups of 20 competing reservations admitted exactly one request.

The integrated 134-case voice source is awaiting its subsequent CI run. Hosted staging sessions and physical-device/provider checks remain unexecuted; local container HTTP success does not close those gaps.
