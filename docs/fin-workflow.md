# Fin: account-scoped conversations and reviewed workflows

Fin uses the existing OpenAI server connection to interpret requests and search current account records. Teaching Fin means maintaining its instructions and explicitly saved business profile; it does not train shared model weights on customer data.

## Boundaries

- The Edge Function authenticates the caller, verifies business membership, office/administrator/owner role, Pro access, and the provider-attempt budget. It uses the caller's JWT, never a service-role client.
- `fin_lookup_records` accepts a fixed resource/filter contract. Business scope is supplied by the server, with explicit module checks and caller RLS. Exact counts and monetary aggregates cover the entire matching filter; record lists are paged and visibly labelled.
- Threads and review plans belong to both a business and a user. Browsers cannot submit authoritative conversation history or access the private tables. Role/module changes invalidate cached context and pending/in-flight reviews.
- Only record IDs returned in the current turn can enter a proposed plan. Prior conversation and record text are untrusted reference data. The model receives no write, arbitrary SQL, browser or outbound communication tool.
- API responses use `store:false`. This is an API storage setting, not a claim of zero provider retention. Existing account disclosures still apply.

## Supported work

Fin can find/explain records, link to existing screens, create or revise customers/draft invoices/draft estimates/jobs, create source-linked change orders, schedule jobs or invoice work, convert approved estimates, record explicitly reported payments, create/complete reminders, archive customers, void unpaid invoices, cancel jobs, and propose explicit business-profile knowledge updates. The primary account owner must confirm knowledge changes. Unsupported or ambiguous operations require clarification.

One plan can contain up to eight dependent steps. A newly created customer or document is referenced by an earlier step, never a guessed database ID. Financial amounts use decimal validation and exact application/database arithmetic. Saved tax defaults are respected, distinct charges remain separate, and a conflicting stated total requires clarification.

## Review and execution

All business changes appear in one review. A follow-up replaces the pending plan; typing `yes` cannot execute it. Plans expire after 15 minutes. The confirmation RPC rechecks the caller, business, modules, record versions and the selected customer. Reminder completion compares the entire reviewed snapshot because reminders have no `updated_at` column.

Execution uses the existing document, payment, scheduling and change-order services inside one database transaction. A failing later step rolls back earlier steps. A completed review stores its result, so retrying the same confirmation does not repeat changes. The private review ledger records the actor, plan version, expiry, status and execution result.

Email delivery remains an explicit action in the same Fin screen after saving. The actual saved customer contact is shown, and unavailable channels remain unavailable. Preparing a delivery review does not send a message. Existing release flags, recipient checks and stable send-request IDs remain in force. SMS setup is not provisioned by this change.

## Runtime limits and recovery

The handler allows at most five provider rounds and eight lookups within a bounded time/input budget. It reserves each provider attempt before calling OpenAI and does not automatically retry billable provider failures. Recent server conversation history is bounded by turn count and payload size. Failed requests preserve the user's words. Session refresh can retry an unauthenticated request once; unconfirmed save outcomes retain the same review ID.

Microphone capture, native encoder fallback, permission recovery, automatic pause submission and keyboard input retain the previous capture implementation. Voice and typed requests now use the same contextual workflow endpoint.

## Deployment and verification

Apply the two `fin_*workflow*` / `fin_reminder_review_snapshot` migrations before releasing the new frontend. Deploy `fin-workflow/index.ts` with its handler/protocol, `fin-assistant/core.ts`, and `_shared/providerRequest.ts`; keep JWT verification enabled. Reuse the existing server-only OpenAI secret.

Run `npm run build`, `npm run test:settings`, `npm run test:services`, `npm run test:deployment`, and the Fin/voice/document-delivery browser suites. The new database suite executes real PostgreSQL functions through PGlite and checks authorization, full-filter lookup, exact totals, all supported action categories, stale data, expiry, cancellation, replay and rollback. Browser suites mock authentication/provider/delivery responses; native Chromium audio tests use a synthetic input device. They do not prove physical-phone capture, live model accuracy, or real customer delivery.

The private test release can be rolled back by restoring the preceding frontend commit. Its previous endpoints remain available; the additive private tables and new endpoint need not be destructively removed.

### Invoice handoff and model evaluations

The local evaluation runs on the predictive customer workflow in GitHub Actions. Run it with
`node --import tsx --test tests/predictive/*.test.ts tests/settings/voice-document.test.ts tests/settings/fin-workflow.test.ts`.
The browser suite covers the saved-customer picker, draft handoff, and preview.

To evaluate the actual model against the isolated QA backend, provision a synthetic QA business with a saved invoice numbered `INV-FIN-EVAL`. Supply that business ID and a short-lived test user's access token via `FIN_QA_BUSINESS_ID` and `FIN_QA_ACCESS_TOKEN`. From `tests/predictive/model-eval`, run `npx --yes promptfoo@0.125.1 eval --no-cache`. This calls the review endpoint and consumes QA model usage. It does not execute a plan. Keep QA credentials out of source and use fictional records only.
