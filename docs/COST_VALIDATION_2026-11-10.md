# Cost validation baseline

COST-01 remains unverified. No new service, paid test, allowance, discount, fee or subscription was activated. Proposed $14.99 Individual / $28 Business terms and 25/100 Fin requests are modeling inputs only until confirmed.

## Observed private-beta inventory

Read-only aggregate snapshot: November 10, 2026 at 16:43:33 UTC. Usage period begins November 1 UTC. These counters describe a very small beta, not provider bills, full-use costs or representative demand.

| Counter | Observed value | Interpretation |
| --- | ---: | --- |
| Businesses | 3 | Small current beta population |
| AI allowance units used | 8 | Application reservation/accounting units; not token totals |
| Voice allowance units used | 35 seconds | Seconds, not minutes or transcription cost |
| Email allowance units used | 4 | Application units; verify against provider billing |
| AI provider attempts | 11 command / 4 transcription | Attempts can differ from successful work and consumed allowance |
| Receipt reservations | 0 | No OCR cost estimate can be inferred |
| Private stored bytes | 1,062,646 | Point-in-time size; not egress or GB-month billing |
| Delivered outbox items | 4 | Application delivery state; not independent inbox confirmation |
| Support cases | 0 | Does not mean support labor is zero |
| Active sender accounts | 3 email / 0 SMS | Registration and per-sender fixed costs remain to be established |

## Required measurements and reconciliation

For an approved bounded evaluation, collect counts and durations without retaining prompts, customer content or raw audio. Join provider usage/cost receipts to pseudonymous workspace and operation IDs. Reconcile retries, timeouts and refunded allowance separately from provider charges; an application refund does not guarantee a provider credit.

| Cost | Quantity needed | Authoritative price/cost source |
| --- | --- | --- |
| Fin / legacy AI | Input, cached-input and output tokens per model; tool rounds and failed paid attempts | Actual configured model usage and provider invoice |
| Voice | Accepted audio seconds, provider billed duration/model and failed paid attempts | Transcription usage/invoice |
| Receipt scanning | Images/pages/tokens, attempts, retries and completed expense accuracy | Actual OCR/model usage/invoice |
| Email | Provider-billed messages, recipients, retry charges and fixed sender cost | Messaging invoice and delivery receipts |
| SMS | Encoding/segments, destination, carrier fees, number rental and registration/campaign charges | Selected provider account's invoice and approved sender setup |
| Database/hosting | Base plan, compute, database/storage size, requests and concurrency | Vercel/Supabase usage and invoices for the selected environments |
| Files | GB-month, upload/download bytes, transforms, exports and backups | Storage/egress/backup invoice |
| Support | Actual minutes by case type, owner/staff hourly cost and fixed coverage | Approved staffing cost and time records |

## Model and decision rules

For each plan and workload, calculate:

`account_cost = variable_provider_cost + allocated_shared_infrastructure + direct_support_cost`

`account_operating_margin = (recognized_subscription_revenue - account_cost) / recognized_subscription_revenue`

Evaluate normal use, full included use, bursts, failed/retried work, and mixed paid/free/trial cohorts. Allocate shared infrastructure across the whole cohort; free/trial users have costs despite zero subscription revenue. Include required SMS registration/number costs even when usage is low. Test p50 and p95 tenant usage separately from maximum allowance use. Do not count unapproved platform/surcharge income.

At the proposed prices, a 50% account operating margin allows **at most $7.495 monthly cost for Individual and $14.00 for Business**, before any excluded development, acquisition, taxes or owner profit. These are algebraic ceilings, not measured margins. If direct support is excluded from a draft model, label that explicitly and show a second result including it. Net profit needs all business costs, refunds, discounts and taxes in addition to account operating costs.

Before selling: reconcile the model to actual provider invoices; run the approved full-use workloads; set owner-approved spend alerts and provider budgets; verify the recipient receives the alerts; revise disclosed prices/allowances if the margin target fails. The shared burst limiter controls request rate and preserves manual work, but does not establish an exact dollar ceiling or an active alert service. Annual discounts remain unselected.
