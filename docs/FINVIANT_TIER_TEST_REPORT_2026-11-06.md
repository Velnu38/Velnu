# Finviant pricing tiers — implementation and testing

Release scope: private owner testing on finviant.com, using the existing private Supabase workspace. No public launch, subscription charge or customer delivery occurred during verification.

## Implemented

- Free ($0), Individual ($19.95/month), Business Pro ($39.95/month; proposed $399.50 annual option). Settings → Plans & Usage has feature comparisons, usage meters, owner-only test buttons and Restore access.
- Limits: 10 active customers and 5 new monthly job bookings on Free; 1/1/5 users; 100 MB/2 GB/10 GB shared attachment storage. Existing records are retained on downgrade.
- Fin: 20 once/150 monthly/600 monthly; measured server transcription: 10 once/60 monthly/180 monthly minutes. Pro email: 2,000 recipient deliveries; US text: 200 billable segments monthly. Atomic request ledgers prevent quota resets and double charging on retries.
- Personal email/text onboarding and Settings setup. Sending opens a draft in the configured personal app. Finviant only records a personal send after the user explicitly confirms; this is not a delivery receipt.
- Manual creation saves the document before personal sending. Pro managed email retains its direct send path after activation. Saved manual documents, Fin-created documents and manual invoice follow-ups use the tier-aware delivery controls.
- Pro managed SMS with recipient permission, STOP handling, signed callbacks and duplicate prevention; scheduled email and owner-enabled overdue-invoice email reminders. Queue claiming rechecks access, plan, sender activation, document changes and paid/void status.
- Paid recurring invoice drafts, paid calendar connections and read-only QuickBooks access after provider configuration. Free retains 30-day financial views; paid plans retain full history.
- Agreement version 2026-11-06-v5 records delivery requirements, allowances and private-testing terms.

## Passing verification

Source revision: 66dfd19b5dd88410e3d537c4c21762b19c3a103b (subsequent test/report updates do not change application or server source).

[Pricing tier checks](https://github.com/Velnu38/Velnu/actions/runs/42247566827):

| Check | Result |
|---|---|
| Tier/database, provider, voice, predictive matching and Fin review tests | 89 passed |
| Calendar service tests and type check | 29 passed; type check passed |
| Storage tests | 5 passed |
| Deployment isolation tests | 22 passed |
| Focused browser tests | 18 passed; zero skipped/flaky |
| Production frontend build | Passed |
| More navigation and financial entry workflows | Passed |

Browser coverage includes all three owner switches and restoration, unauthorized switch controls, onboarding acknowledgement, native email/SMS links, explicit final-send recording, pending Pro activation, mobile layout, predictive customer selection, preview/back/save idempotency and all Free/Individual manual invoice/estimate paths. Provider calls were mocked; no actual SMS or email was sent.

Live database smoke tests ran with the authorized private primary owner's authenticated role, exercised Free → Individual → Business Pro → restore, and rolled back. Actual business entitlements and records were preserved. The tier-testing flag is enabled only in the private workspace; no override is left selected.

The database scheduler successfully authenticated to the deployed worker and received HTTP 200 with `paused: true`, `reason: Sender activation pending`, `sent: 0`. The worker runs every five minutes and continues to fail closed until activation. The pending email queue was empty.

## Limits of the evidence

The broader inherited Home/Calendar/scheduling browser suites are not a green full-app release certification. They include outdated layout expectations (for example, `Financial performance` versus the existing `Financial Performance`, removed billing/job tiles, collapsed Needs Attention and collapsed customer forms). These are recorded separately from the passing tier checks; they have not been silently skipped or represented as passing. A complete browser-regression refresh remains a public-launch task.

Live Supabase advisories showed no ERROR-level findings. Remaining warnings include intentionally callable, authorization-checked SECURITY DEFINER RPCs, the extension metadata schema for non-relocatable pg_net, pre-existing RLS init-plan performance warnings and disabled leaked-password protection. Private RLS tables deliberately deny client access.

## Provider and commercial activation still required

Business Pro's real customer email and SMS remain paused. Verified Resend sender/reply settings, Twilio sending-number registration, recipient permission, callback delivery/reply validation and per-business activation are required before actual sending. Selecting Business Pro does not activate these services. Personal-app sending remains available as a fallback after setup.

No paid subscription checkout, live billing entitlement webhook, overage purchase, public launch, load test, backup-restore certification or native app-store certification was performed. Automatic appointment/estimate follow-ups and automatic dispatch of every recurring invoice occurrence are not included; recurring drafts and manual scheduling invitations remain available.

Customer share links expire after 30 days and stop showing changed document content. Existing site-level private access protection still applies to those links.

[Implementation PR](https://github.com/Velnu38/Velnu/pull/66) · [Tier comparison](FINVIANT_TIER_COMPARISON_2026-11-06.md)
