# Voice-to-invoice backend security and reliability assessment

Finviant Office received additional voice-to-invoice development on October 28, 2026. Commit [`bb65df2de023210f91aa2f9b67fa3d8782bd5f82`](https://github.com/Velnu38/Velnu/commit/bb65df2de023210f91aa2f9b67fa3d8782bd5f82) changed transcription persistence to use a separate server-only Supabase client. The handler authenticates the caller, checks business membership and backend voice entitlements, reserves a provider attempt, processes uploaded audio with OpenAI and stores the resulting transcript. Browser roles retain SELECT-only table privileges.

The repository has browser coverage for voice invoice creation, Safari microphone fallback, draft review and microphone activation. [Trial readiness run 40706193494](https://github.com/Velnu38/Velnu/actions/runs/40706193494) was independently checked through GitHub and completed successfully on October 28, 2026, for commit `e9d83957380829090238171f5100757e52280ad8`. That result is evidence for that source revision and its configured checks. Its browser mocks do not establish real provider performance or complete backend security coverage.

Before this change there was no dedicated `supabase/functions/transcribe-voice/index_test.ts`. The new suite executes the actual handler, extracted into `handler.ts`, with injected auth/database/provider dependencies. The production entrypoint still creates the Supabase client and serves that same handler. Tests run with Deno's default denial of network access and do not require or call a real OpenAI API key.

## Confirmed findings and changes

- Storage credentials were checked only after a billable provider call. They are now checked before quota reservation or transcription. Status reports configured only when both provider and secure-storage configuration are present.
- Malformed JSON/multipart bodies previously fell into a generic 500. The handler now returns explicit 400/413/415 errors, bounds request bytes before multipart parsing, and cancels stalled body reads after ten seconds.
- Invalid `voice_limit` values such as `NaN` strings could pass the preliminary numerical comparison. The handler now requires a positive safe integer. The server quota RPC remains the authoritative entitlement/concurrency control.
- The handler now requires explicit `reserved: true` proof from the quota RPC before a provider call and verifies the returned membership matches the requested business.
- Business identifiers must be strings, preventing accidental array-to-UUID coercion. Persisted user/business/provider/transcript fields come from verified identity, the approved business and the provider response; caller-supplied transcript/user/plan fields are ignored.
- Supabase client network requests now use ten-second abort deadlines. Provider calls retain a sixty-second deadline, a 256-KiB response bound and no automatic retries.
- Storage exceptions/missing IDs are reported as an unconfirmed storage outcome with typed-input fallback and a warning against repeated provider charges. A storage acknowledgement failure cannot prove that nothing was saved, so the response no longer makes that claim.
- A timeout test exposed a cancellation race returning 400 instead of the intended 408; the race was fixed and the suite rerun successfully before commit.

## Verified tests

Local Deno result: **67 passed, zero failed**. This includes 100 forged business identifiers, 100 restricted/malformed entitlement cases and 100 concurrent requests sharing a mocked atomic budget of ten accepted reservations. The concurrency mock verifies handler behavior around the quota contract; it does not establish PostgreSQL row-lock behavior under live concurrency.

The suite covers unauthenticated/non-Bearer calls, expired/malformed sessions, business membership denial/errors, forged identity fields, free/basic/unactivated plans, invalid voice limits, quota exhaustion, rate/authorization failures, missing quota proof, concurrent request isolation, malformed/oversized/stalled bodies, missing/short/oversized audio, unsupported extension/MIME, invalid duration, supported upload formats, model allowlisting, prompt bounds, provider HTTP/network/timeout/malformed/oversized responses, empty/long transcripts, credential maps, server-only storage, failed/missing storage acknowledgements and successful response attribution. Supported-container tests check the upload contract; arbitrary bytes are not proof that a real audio codec decodes correctly.

A dedicated GitHub workflow, `.github/workflows/voice-backend-security.yml`, runs the suite on pushes to both development and review branches and retains JUnit results. Trial and recovery workflows on the review branch also include the voice backend suite.

## Database permission evidence

Live staging queries verified these effective `authenticated` role privileges on `public.voice_transcriptions`:

| Privilege | Effective grant |
| --- | --- |
| SELECT | true |
| INSERT | false |
| UPDATE | false |
| DELETE | false |

The inspected RLS policy requires both `private.is_business_member(business_id)` and `user_id = auth.uid()`. Therefore a browser client cannot forge a transcript through a direct INSERT/UPDATE/DELETE using its ordinary authenticated role, and reads are constrained by both caller and tenant membership. No write grants were broadened. The role's privileges and the actual policy predicate were checked against staging, rather than inferred only from a source migration.

These catalog checks and handler mocks do not substitute for two real authenticated HTTP sessions. `tests/security/transcribe-direct-api.mjs` performs that separate check when supplied two disposable QA users/businesses and two server-seeded transcript IDs. It verifies each owner's own read, cross-business read denial, forged inserts with own/foreign IDs, updates and deletes. It refuses to use business names without a QA prefix. It performs no OpenAI call and needs no paid voice entitlement. With missing fixtures it writes `VOICE_DIRECT_API_RESULTS.json` as **not_run**, never a passing result.

Required environment: `VOICE_QA_OWNER_A_JWT`, `VOICE_QA_OWNER_B_JWT`, `VOICE_QA_BUSINESS_A`, `VOICE_QA_BUSINESS_B`, `VOICE_QA_TRANSCRIPT_A`, `VOICE_QA_TRANSCRIPT_B`, plus `VOICE_QA_PUBLISHABLE_KEY` when the repository QA target file is unavailable. Use dedicated staging QA accounts only. The live two-account HTTP test was not run in this execution because those disposable authenticated sessions/fixtures were unavailable. This is an explicit remaining evidence gap.

## Remaining launch requirements

The [October 27 development report](https://github.com/Velnu38/Velnu/blob/feature/velnu-stage1/docs/VELNU_PATCH_REPORT_2026-10-27.md) identifies a funded working OpenAI credential and actual-device transcription/command validation as outstanding requirements. They remain separate from mocked backend tests.

- **Staging credentials:** complete the direct API two-user isolation script and an actual concurrent quota-reservation test against a disposable activated QA business. Verify remaining allowance changes atomically and failed attempts remain counted.
- **Activated entitlement plus working provider configuration:** run a deliberately bounded live audio transcription and confirm the returned transcript, attributed stored row, quota consumption, provider receipt and failed-storage recovery. A status endpoint showing configured checks credential presence/shape only, not validity or funding.
- **Physical devices:** validate iPhone/iPad Safari and Android microphone permission timing, silence/cancel/interruption behavior, real MediaRecorder codecs, keyboard microphone fallback and draft review. Browser speech mocks and nominal MIME names cannot establish those outcomes.
- **Full product flow:** verify that a real transcript opens a reviewable draft, never sends an invoice or records a payment automatically, and preserves customer/amount/tax review.

Sources: [server-only storage commit](https://github.com/Velnu38/Velnu/commit/bb65df2de023210f91aa2f9b67fa3d8782bd5f82), [original handler](https://github.com/Velnu38/Velnu/blob/feature/velnu-stage1/supabase/functions/transcribe-voice/index.ts), [voice browser tests](https://github.com/Velnu38/Velnu/blob/feature/velnu-stage1/tests/e2e/voice-invoice.spec.mjs), [October 28 successful trial checks](https://github.com/Velnu38/Velnu/actions/runs/40706193494).
