# Finviant Office — Atomic AI Transaction Hardening

Staging-only implementation, 2026-10-27. GitHub development branch: `feature/velnu-stage1`; no production writes.

## Changes in the staging database

The following are recorded in Supabase migration history:
- `finviant_ai_atomic_mutations_and_protected_confirmation`: direct client writes to `ai_actions` denied, server-only proposal insertion, protected `decide_ai_action` and atomic `execute_ai_mutation`.
- `finviant_ai_receipt_membership_guard`: repeat requests must still pass current business access checks. A corresponding source patch is committed.
- `finviant_ai_fix_uuid_aggregate_in_transaction`: PostgreSQL UUID minimum aggregation fixed.

The complete initial staging migration remains in the Supabase migration history and **must be exported into the repo before production release**. Do not deploy a clean database from the partial repository patches alone.

## Behavior

AI-generated customer, job, invoice, estimate, scheduled-job, change-order and manual-payment writes execute within one database transaction along with the AI action completion receipt. Existing vetted create_document, create_scheduled_job, create_change_order_document and record_manual_payment functions provide business transaction safety and idempotency. The action UUID is the stable request ID.

An unconfirmed, rejected or unauthorized AI action cannot run. Client users cannot insert or update their own proposal payloads directly. Confirmation and rejection use restricted RPCs. When a duplicate execution arrives after commit, the original result is returned instead of executing again. Failed business writes roll back the associated action receipt.

## Staging QA

- Direct authenticated `ai_actions` INSERT and UPDATE privileges: denied.
- Confirmed customer creation and retry: same original result; test transaction rolled back.
- Invoice creation with two line items and correct total: pass; test transaction rolled back.
- Confirmed invoice replay: one record, already_executed=true; test transaction rolled back.
- Scheduled job and appointment created together: pass; test transaction rolled back.
- Change order tied to existing job and customer: pass; test transaction rolled back.
- $90 manual payment against a $180 issued invoice: partial, balance $90; test transaction rolled back.
- Development GitHub build and controlled stress workflow: pass.
- Real OpenAI provider transcription/command output, concurrent production load, and real-device browser confirmations remain separate launch checks.

No Stripe charges or real customer email sends were made.
