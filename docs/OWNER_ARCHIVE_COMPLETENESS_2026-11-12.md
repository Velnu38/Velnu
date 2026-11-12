# Owner archive completeness — November 12, 2026

Base: `c614324a71faba24caeefb75791069b97b75c7d9` on `ux/private-testing-20261029`, after the PR102 release. Work branch: `fix/owner-export-completeness-20261112`. Reuses PR83 rather than replacing the archive. No application layout, provider activation, customer sending, retention or deletion policy changes.

## Findings and changes

The v1 catalog already included 84 collections covering customers/addresses, jobs and execution records, invoices/estimates/change orders and line items, approvals, payments/refunds, invoice balances, expenses (`public.bookkeeping_entries`), worker profiles/availability, receipt/photo references and stored PDFs. It omitted delivery attempts and outcomes held outside `public.messages`, and job-to-invoice result history. Version 2 adds seven explicitly selected collections:

| Collection | Included | Intentionally omitted |
| --- | --- | --- |
| `private.delivery_tasks` | Actor, document, due/creation time, reminder flag, status/error | Snapshot containing document bearer links |
| `private.finviant_email_outbox` | Actor, document/revision, recipient list, status, attempts, provider ID, timestamps, PDF hash | Payload/body, leases and embedded bearer links |
| `private.finviant_delivery_events` | Event/type and provider/receipt times, scoped through this business's email operations | Unrelated businesses' events |
| `private.managed_sms` | Actor, document, phone/sender, status, provider ID and times | Body and authorization-token hash |
| `private.business_card_sms` | Actor, revision, customer, recipient, outcome and times | Body and authorization-token hash |
| `private.appointment_reminder_queue` | Appointment/occurrence, actor/customer/recipient, due time, outcome and times | Full snapshot/payload |
| `private.job_invoice_results` | Job, invoice, error and update time | No additional fields |

Raw status values and their timestamps are preserved; accepted is not relabeled delivered. Existing business messages remain included. Operational budgets, OAuth state, credentials, internal support notes, global security logs and other users' private Fin conversations remain excluded. The archive is an owner record export, not a database backup.

The migration records snapshot schema version: existing snapshots remain v1, new snapshots use v2. Part manifests select the matching catalog, include its SHA-256, and retain full collection counts. Missing business logos or retained completion-report photos now fail atomically rather than yield a seemingly complete archive. PDF source bytes are checked against the original immutable PDF hash, in addition to existing size/metadata checks. All original source data and the existing seven-day generated-copy expiry are unchanged.

## Verification

Run `node --import tsx --test --test-concurrency=1 tests/records/owner-archive.test.ts tests/storage/owner-archive.test.ts`.

- The SQL fixture snapshots 50,001 customer records, then edits the originals. Every archived customer is extracted from the bounded ZIP parts using Python's independent ZIP reader; no truncation occurs.
- A two-business fixture creates a tenant-scoped archive with customer/address/job/document/payment/expense/approval/worker/availability/history records, receipt/photo, logo and immutable PDF bytes. Independent ZIP CRC, byte lengths, every entry hash including catalog, collection counts, tenant identity, total parts and selected balances are verified. Synthetic totals are 120, paid 45, balance 75.
- Other business, secondary owner and anonymous access are denied; direct snapshot table and client finalize access are denied. Revoked ownership and expired downloads remain denied. Existing source mutation, invalid path, lease/retry and non-destructive cleanup checks remain.
- Missing logos/completion photos create no partial snapshot. Same-length PDF corruption is rejected. Existing snapshots stay v1 after migration; new snapshots use v2.
- The test emits `tmp/owner-archive-test/part-*.zip` and `verification.json` using synthetic data only. The existing complete-test workflow preserves these as `synthetic-owner-archive-v2`; no customer records or tokens are uploaded.
- Local results: all 10 archive cases, 10 assessment checks, 58 deployment/replay safety checks, TypeScript compilation and Edge packaging passed. Genuine local Auth/Storage full-schema replay remains in the existing complete CI gate. Fixture passes are not hosted acceptance or revoked-session certification.

## Merge and beta sequencing

Keep this branch isolated with automatic Vercel deployment disabled. Before merge, recheck the current private branch and concurrent security/reminder PRs. PR97 is not included: its future additions to message initiator/purpose fields need a separately reviewed catalog/version update when integrated. PR103 owns broader session-revocation controls and edits `owner-archive/index.ts`; this PR edits only `assemble.ts` in that function, so retain both changes during integration. Both PRs append readiness observations and branch deployment exclusions; preserve each addition. Do not replace PR103 authorization work.

After required CI succeeds and release is coordinated, apply the additive `owner_archive_completeness` migration, deploy the matching `owner-archive` Edge package with existing JWT mode, then verify an authorized controlled beta owner archive. Old Edge code must not process new v2 snapshots: coordinate the short migration/function rollout window. Existing prepared ZIPs remain downloadable; rollback of the Edge function alone would lose the correct v2 labeling, so pause new preparation or retain v2-compatible code rather than rolling it back alone. Do not drop archived or original data.

## Remaining restore and hosted-backup requirements

`EXPORT-01` stays open for current hosted owner download acceptance, including expired read-only owners, actual file integrity and realistic hosted capacity. The prior PR83 genuine local Auth/Storage replay already covers expired Free entitlement and unchanged Fin usage; rerun it against this migration in CI. No paid plan or Fin request is needed for exports.

`OPS-01` stays open. Reuse the existing isolated restore evidence in `docs/SYNTHETIC_RECOVERY_DRILL_2026-11-10.md`; it does not certify a full hosted restore. Remaining requirements are:

1. Inventory actual hosted database backup/PITR coverage, retention and recoverable dates; do not purchase or enable a plan from this task.
2. Back up actual private Storage object bytes separately, with hashes. Database backup metadata alone does not recover deleted object bytes.
3. Securely recover application configuration, authentication settings, Edge packages and encrypted credentials outside the owner archive.
4. Restore a complete controlled business into an isolated target, reconcile documents, balances, files, roles/RLS and session/link restrictions, and measure recovery time/data loss against approved RTO/RPO.
5. Rehearse frontend/Edge/schema-compatible rollback and assign an operating owner. An owner export has no automatic import/restore command; historical imports remain `EXPORT-02`.

Resource limits remain explicit: 250 MB snapshot JSON, 10 MB per record/source file and bounded ZIP parts. Unsupported sizes fail rather than truncate. Production volume/cost acceptance, actual-phone acceptance and a complete hosted disaster-recovery drill are not claimed.
