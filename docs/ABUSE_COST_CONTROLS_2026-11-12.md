# Abuse prevention and cost controls — November 12, 2026

Candidate based on private beta c614324. SEC-03 remains open; this is provider-independent hardening, not hosted ingress or provider billing certification.

## Changes

Reuses the database-owned GCRA limiter and existing monthly quotas, storage reservations, message leases and immutable PDF cache. No per-instance rate-limit memory is used. Adds limits on successful document/card link reads, owner document reads, PDF cache-miss renders, and actual email/SMS claim transitions (document, card and appointment workers). Existing authorization, opt-out, consent, plan and private-beta recipient checks remain in place. No UI/layout changes.

| Resource | Global/minute | Business/minute | Actor or valid link/minute | Global attempts/UTC day |
| --- | ---: | ---: | ---: | ---: |
| AI/voice combined | 120 | 20 | 12 | 7,200 |
| Receipt scan | 60 | 12 | 6 | 3,600 |
| Upload | 300 | 60 | 20 | 18,000 |
| PDF render | 120 | 30 | 12 per version | 7,200 |
| Email attempt | 100 | 20 | 12 | 6,000 |
| SMS attempt | 50 | 12 | 6 | 3,000 |
| Valid public/owner document read | 600 | 120 | 60 | — |

Daily caps bound each resource to at most one hour of its maximum global burst throughput per UTC day. They are conservative candidate operational ceilings, not changed subscription entitlements or dollar guarantees. They count attempts, including uncertain attempts, and do not refund potentially spent provider work. Fixed-day limits permit up to two daily allocations across a midnight boundary. Existing business/monthly quotas and per-request input/output bounds still apply. SMS segment limits remain in the existing tier reservations.

Rejected claims roll back status, lease, attempt counter and quota changes. Accepted/delivered retries do not acquire another attempt. A PDF cache hit does not require render capacity; manual entry and personal email/SMS handoff are unchanged. Structured 429s preserve Retry-After (up to 24 hours for the daily cap) and the saved send ID. Bounded streaming readers replace unbounded approval and SMS request reads, and add a body deadline to card delivery. No automatic immediate retry is introduced.

## Verification

Targeted SQL tests exercise final daily slots, counter access denial, all messaging transition families, rollback of rejected claims, accepted-send retry behavior and next-day recovery. Handler tests exercise separate handler instances sharing a denying backend, no-provider/no-artifact behavior, forged Content-Length, stream cancellation and Retry-After. Existing burst, voice, upload, canonical PDF and uncertain delivery tests are reused.

The complete migration replay now runs 20 independent PostgreSQL connections against the owned disposable database for each of seven resources. It asserts one winner for the last burst slot, cooldown recovery, and (for six provider resources) one last-daily-slot winner, rejected-reservation rollback and next-day recovery. No provider, hosted database or live account is contacted. The sanitized `isolated-abuse-cost-results` CI artifact records the tested commit. A passing exact-head replay receipt is required before deployment; local PGlite tests alone do not prove cross-instance behavior.

## Remaining acceptance and dependencies

- Signup, login/recovery and invalid-token floods require authoritative ingress/IP controls on Supabase's direct Auth/REST/Functions endpoints, not only finviant.com. Do not trust a caller-supplied X-Forwarded-For header. Current hosted settings and a bounded distributed ingress test still need verification. No Auth configuration or pre-request hook was changed (PR103 owns the session hook).
- Valid-token database counters roll back on failed transactions; they deliberately do not claim to count invalid-token attempts. They bound successful reads, not denial-of-service traffic before a database transaction.
- Actual dollar caps need approved budgets and conservative unit prices for each enabled provider/model, plus provider billing reconciliation/alerts. These attempt caps are a finite upper bound on calls, not a verified monetary ceiling. No provider is activated by this change.
- The global cap is a shared safety valve: one busy business can contribute toward global exhaustion, although business/actor bursts and existing monthly quotas constrain it. Manual work remains available during provider backpressure.
- Existing provider request-size/output limits and idempotent recovery remain necessary. This change does not prove physical-device or live-provider behavior or large-scale capacity.

## Coordinated release

Do not merge/deploy until exact-head required CI passes and concurrent PR97 reminder history, PR103 session security, owner-export work and layout changes are reconciled. Apply the additive migration before publishing handlers that call `reserve_document_pdf_render`. Preserve current endpoint JWT modes. Deploy all callers of the shared PDF/email helpers together, plus SMS, approval, card and existing AI/upload/receipt handlers to expose daily Retry-After correctly. Retain the prior Edge packages for rollback; counters must not be deleted to reset allowances. No production settings, retention, customer data, providers, messages, charges or public launch are changed.

References: [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Supabase changelog](https://supabase.com/changelog.md), existing `PROVIDER_BURST_LIMITS_2026-11-10.md`.
