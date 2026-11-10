# Synthetic recovery drill

Status: implemented for mandatory isolated CI; execution evidence is pending. OPS-01 stays open.

The migration runner creates a uniquely named local Supabase project with an empty database, no hosted credentials, an empty Vault, no enabled sender, and cron execution disabled. The Auth/Storage check creates three genuine password identities across two synthetic businesses, an invoice for $105, one retry-safe $30 cash receipt, an accepted estimate and its job, a roster worker, task, time entry and a private PNG file.

The recovery step downloads the actual private object and retains those bytes separately from a PostgreSQL custom-format data dump. It inventories every public/private table plus Auth users and identities, recording counts and hashes in memory. It confirms the fixture did not change while the backup was taken. Only then does it remove the synthetic object through Storage and truncate the uniquely owned local fixture. It restores the dump using PostgreSQL's data-restore mechanism, compares every inventoried row/hash, logs in again with the restored passwords, uploads the backed-up bytes, and verifies the $105 total / $30 paid / $75 balance, one payment, the job, private file hash, unrelated-user denial and anonymous denial. Existing post-restore permission-revocation tests still run.

Raw dumps, passwords, tokens, file contents and row hashes are never logged or uploaded as CI artifacts. The dump remains in memory and is cleared in `finally`. The final receipt contains only counts, elapsed backup/restore milliseconds and pass/fail flags. Cleanup deletes the uniquely named disposable project. The script accepts no hosted connection or project argument.

This is a **data-and-file restore into retained, already replayed schema/configuration**. It does not prove a hosted backup exists, a fresh provider account can be recovered, all encrypted provider credentials are recoverable, whole-server/PITR recovery, a production RPO/RTO, or production-scale timing. Auth sessions are intentionally invalidated while user/password/identity records are restored. The synthetic workload is quiescent; a live backup needs a consistent file/database checkpoint and reconciliation of events arriving afterwards.

## Current inventory and remaining recovery work

| Component | Current evidence | Remaining action |
| --- | --- | --- |
| Application and migration source | Git history; immutable tested release trees | Confirm owner and backup maintainer can independently access GitHub |
| Hosted database backups / PITR | Schedule, retention, last successful backup and restorability have not been verified | Inspect the selected project's existing backup history; obtain approval for any paid plan change |
| Private Storage objects | Actual synthetic byte backup/restore is included in this drill | Select and verify encrypted off-site storage backup, checkpoint consistency and expiry; no live copy authorized here |
| Auth | Synthetic password identities restored; sessions revoked | Hosted SMTP, MFA recovery, OAuth/provider keys and owner emergency access remain unverified |
| Deployment and Edge source | Exact source/version receipts and previous compatible releases retained | Rehearse whole-environment recovery with secrets entered by the owner outside chat |
| Provider configuration | No credentials copied into this fixture | Maintain a restricted configuration inventory and recovery ownership; account for Vault/encryption keys separately |

## Incident recovery procedure for owner review

1. Declare the incident, scope affected tenants, preserve safe diagnostics and pause the affected worker/provider path. Retain provider event IDs and uncertain-send states. Do not retry ambiguous messages or charges.
2. Choose a verified backup checkpoint and a separate authorized recovery target. Keep public routing, outbound delivery, cron execution, subscriptions and charges disabled. Confirm database and file recovery checkpoints align.
3. Restore schema, grants, roles and app data; restore Auth under the approved session-revocation policy. Recover private object bytes separately and compare the manifest. Restore provider secrets through their secure configuration interfaces, never from chat evidence.
4. Compare financial totals, immutable document hashes, file hashes, job/worker references and owner/office/foreign/anonymous access. Reconcile payment and delivery events received after the checkpoint. Reapply the deletion ledger if a separately approved retention system exists.
5. Restore compatible frontend and Edge versions. Test login, read, write, download, revoked permissions and recovery of each paused queue. Record measured loss and elapsed time. Only resume the exact approved audience and providers after these checks pass.
6. Document the cause, affected period, owner decision, restoration receipt and prevention action. Production rollback preserves additive tables and immutable issued records; never reverse a migration by deleting customer data.

Sources reviewed November 10: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [local restore](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup). The runbook uses these as operational references, not proof of this account's backup configuration.
