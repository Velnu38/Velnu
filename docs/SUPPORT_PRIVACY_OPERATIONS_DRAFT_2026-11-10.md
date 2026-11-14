# Support, privacy and incident operations — owner review draft

This is an operating proposal, not an active SLA, legal policy, staffed on-call promise or authorization to send notifications, issue refunds, change fees or delete records. OPS-04 remains open until responsible people, channels and procedures are approved and exercised without an active chat.

## Responsibility and access

Mike retains direct ownership of GitHub, Vercel, Supabase, domain/DNS, messaging, AI and merchant accounts. Name one backup maintainer and verify their approved provider recovery access. Store recovery codes in an owner-controlled password manager. Never ask support users for passwords, MFA codes, card details, API keys, raw audio or unredacted customer exports.

Investigations start with read-only aggregate health, release SHA, request correlation IDs and the user's own business ID. Support access must be individually attributable, limited to the case, revocable and recorded. A hidden screen or a support conversation does not establish authorization. Tenant content requires a documented reason and the narrowest access. Do not impersonate owners or bypass MFA/recovery based on statements in chat.

Connected chat can investigate and prepare reviewed changes while a session is active. It is not continuous monitoring, a staffed emergency channel or guaranteed response. Route outages through an owner-selected channel independent of ChatGPT; verify a controlled alert reaches that destination and the backup maintainer can respond.

## Intake and triage

Use the existing Help & support case workflow. Acknowledge the case through an approved communication channel only after sender/recipient authorization. Capture the screen/action, UTC time, release, impact, safe correlation ID and reproduction steps. Ask for redacted screenshots where useful. Do not require a complete database export for routine debugging.

| Severity | Example | Proposed internal response, subject to staffing approval |
| --- | --- | --- |
| Critical | Suspected cross-tenant exposure, corrupted ledger or widespread access loss | Immediate owner/backup escalation when detected; contain affected operations; preserve evidence |
| High | Payment/delivery uncertainty, unavailable paid workflow or stuck job queue | Owner triage during the next staffed window; offer the documented manual fallback and avoid duplicate actions |
| Normal | Reproducible UI defect with a safe workaround | Queue a tested repair with clear case updates |
| Request | New feature, optional import or commercial exception | Record separately from incidents; do not promise a release date or free custom work |

Response windows, coverage hours, emergency destination and update frequency are deliberately unset. Confirm staffing before publishing numbers. Reassess severity whenever financial correctness, privacy or multiple tenants are affected.

## Incident procedure

1. Record incident start/detection times, release SHA, affected workflow and aggregate scope. Assign incident lead and backup. Preserve restricted provider logs with access/expiry controls.
2. Pause only the affected path using existing supported controls. Keep manual invoice/job work available where correct. Contain suspected credential exposure by owner-approved scoped revocation/rotation. Do not delete diagnostic history or ambiguous event rows.
3. Establish whether the issue is application, database, provider or configuration. Check queue age and last completed work, not merely cron dispatch. For email/SMS uncertainty correlate the original provider receipt; for payment uncertainty reconcile the signed event/account/location/mode before changing settlement.
4. Repair on an isolated branch with regression tests, migration compatibility and rollback source. Obtain the specific authorization required for consequential security/billing/data changes. Record who approved, exact target and resulting receipt.
5. Verify recovery in isolation, then verify the authorized live scope. Use approved recipients for any customer communication. State confirmed impact and next update time; avoid unsupported assurances about exposure or permanent resolution.
6. Close only after affected records and queues reconcile. Document root cause, impact window, corrective work, open acceptance gates and owner follow-up. A security/privacy incident is escalated to the owner's qualified adviser for applicable notification decisions; this draft sets no legal notification deadline.

## Refunds, cancellation and financial disputes

Distinguish Finviant subscription charges from a merchant's customer invoices. The merchant controls its customer refunds. Support must verify the business, processor, account/location, environment, original payment and remaining refundable amount. Do not issue refunds from a return URL or an email request alone.

For Finviant subscriptions, confirm the approved price, trial, cancellation timing and refund terms before billing is activated. Provide a clear review of any requested change. Use idempotent provider operations and signed events; reconcile gross, processor fees and net separately. Do not promise processor fee refunds. Retain immutable financial history and a clear reason/audit record. No unapproved policy in this draft changes entitlements or initiates a charge/refund.

## Privacy, export and retention

Verify owner authority and workspace scope through authenticated account controls. Existing customer/service CSV tools are partial; do not describe them as a complete archive. EXPORT-01 must include all promised records and actual files, counts/integrity, interrupted-export recovery, access for expired read-only accounts and seven-day temporary-file expiry before a purge workflow can be considered.

Live automatic deletion stays disabled. A confirmed retention policy must cover notices, legal holds, paid/beta/admin exceptions, multiple workspaces, in-flight payments/reactivation, provider tokens, queues, public links and actual file bytes. Keep an auditable deletion ledger and define how it is reapplied after restore. Backup expiry and third-party deletion obligations need separate verification. Never delete data merely to resolve a support case or failed export.

Minimize incident/case retention to the approved policy, restrict content access and scrub tokens/query strings/audio from diagnostics. Record provider ownership and applicable data-processing terms for qualified review. Do not represent the draft as a completed legal review.

## Required exercises before public launch

- An owner-approved test alert reaches the selected destination without an active chat; the backup maintainer acknowledges and follows the runbook.
- A synthetic uncertain-send case is reconciled without duplicate delivery; a signed sandbox payment retry does not duplicate settlement.
- An authenticated owner receives a complete synthetic archive; a foreign/revoked user cannot obtain it; temporary files expire.
- An isolated backup restores records, private bytes, permissions and balances; the owner accepts the measured recovery capability.
- Cancellation/refund cases follow the specifically approved commercial policy in test mode, with no real charges.
