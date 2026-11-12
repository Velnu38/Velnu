# Current repository handoff

Checked November 12, 2026 UTC.

- PR93 is merged as 4339c3a559cb14164ea273efa79ee1fba2b1c399. All ten workflows passed at final candidate 4846fc9635f4c090e8f2ec2548980ee70beb543f; tested and merged trees are identical. No further selector or archive-runner repair is pending.

- Previous application release: PR101 merge e0ca5aeaec4cd5ceb80749ecf2a942139fc514d4, READY deployment dpl_BgbMjq6wmhBKh9C4o6QcSiphS7NG on both Finviant domains. Full-width phone shell, compact account disclosure, joined Summary picker/card, prominent next action, compact working-screen identity, large quick buttons and full-screen editors. All seven workflows and 22 complete-suite jobs passed; tested and merged trees match. HTTP 200, private no-store/noindex and beta Supabase xvybcmyoblfgzokaifsx verified.

- PR92 recovery and its additive lookup/Square Edge rollout are complete. Merchant activation, real-provider and physical-device acceptance remain open; do not repeat integration or rollout.

- PR94 remains merged and deployed; all 50 original readiness records survive. AI-03 contextual navigation is now complete after PR95 targeted and required CI and live verification.

- Card 04 implementation is merged and deployed: saved effective reminder rules are visible and stale-business responses are guarded. All four required workflows passed, including all 22 complete-suite jobs. AUTO-01 stays open only for separately gated provider/device acceptance. Card 05 / PR97 and the remaining sequential queue are paused by the owner. No provider activation, real sends or charges.

[Card 04 evidence](evidence/2026-11-12-effective-reminders.json) · [Card 03 evidence](evidence/2026-11-11-fin-navigation.json) · [Generated queue](../ASSESSMENT_REPORT.md) · [Registry](launch-readiness.json)

- PR99 replaces the rejected PR98 phone density with the approved responsive Summary/Work/Billing/Records menus and focused details. Phone layouts use available width with safe-area padding; editors fill the viewport. Existing business actions, permissions, section deep links, queue search/filter/paging, unsaved edits and completion safeguards remain. Secondary completion review is under Job actions. Desktop behavior remains available. No backend/provider change or real send/charge.

- All 51 readiness records and acceptance criteria survive. Broader JOB-01/UX-01, physical iPhone/Android and provider gates remain open. PR97 and the earlier sequential queue remain paused. See [phone flow evidence](evidence/2026-11-12-job-phone-flow.json). Hosted screenshots and CI receipts are linked in that evidence; local Chromium could not launch in this environment, so real browser verification used hosted Chromium and WebKit.

- PR100 phone shell/entry correction is merged and verified in beta. Do not treat automated visual review as physical-device or owner acceptance. See [correction evidence](evidence/2026-11-12-phone-visual-correction.json).

- PR101 is merged and deployed after visual review and all required checks. See [phone composition release receipt](evidence/2026-11-12-phone-shell-width.json). Next-action contrast and 320px tab overflow were fixed. The separately observed desktop document contrast failure under iPhone WebKit remains open under UX-01. No physical-device or owner acceptance is claimed. PR97 and the sequential queue remain paused.

- Owner rejected PR101 visual consistency and phone sizing. The [initial assessment](PHONE_MOCKUP_ASSESSMENT_2026-11-12.md) is retained as failure evidence. A layout-only correction now has populated same-width [reference comparisons](PHONE_REFERENCE_MATCH_2026-11-12.md), shared controls and a native WebKit selector overflow fix. Candidate 73534fdf49537ea1ea010d5ef58dc66d88f26afb passes 36 focused browser cases and rendered reference review (run 43219850066). Required CI passed and PR102 is released; see the receipt below. Actual-phone/owner acceptance remains open. The concurrent daily queue update at 99c3c1e is preserved; all 51 task records are unchanged.

- PR102 phone reference correction is merged as 7d827a9aad76a6a7d1dec3d8fa444606462a53b4, READY deployment dpl_5Sd3MEp3rysQvyr1vrfWf4SZ1Hi7 on both Finviant domains. All seven workflows and 22 complete-suite jobs passed at a681df30fed16d372abf669563e8f95aa66b51c5; tested and merged trees match. Five reference comparisons and downstream editors were reviewed before release. Full-width phone layout, shared controls and WebKit selector overflow are corrected. All 51 task records survive; physical-device/owner, provider and broader JOB-01/UX-01 gates remain open. PR97 and sequential queue remain paused. See [release receipt](evidence/2026-11-12-phone-reference-release.json).

- Owner resumed PR97 reminder history on November 12. Reconciled with the current private-beta branch without changing the phone layout. 34 targeted SQL cases, three DOM suites, TypeScript/build, 10 assessment checks and six migration-runner guards passed. Email/SMS confirmation is channel-specific. Local Chromium launch is blocked by socket permissions; PR CI must verify desktop/WebKit and full migration replay. The remaining sequential queue stays paused. No provider activation, real sends or charges.

- PR97 reminder history is merged as 1e6d4a8088cf9df40332bcfbb1e115db4f647026 and released to private beta on both Finviant domains using READY deployment dpl_144zwRNoNEGAqwsTddfDnYvYNSfi. All five workflows passed at d74dab7; tested and merged trees match. Beta migration invoice_reminder_history applied as 20261112214051 from source 20261112004157; do not reapply it. ACL/missing-identity checks and live HTTP 200, no-store/noindex, beta database and history assets verified. AUTO-02 remains open for hosted owner/provider/physical-device acceptance. PR103, PR104 and app-wide layout work remain separate; future releases must preserve this merge. No providers activated, real messages or charges. See [reminder release receipt](evidence/2026-11-12-invoice-reminder-history.json).
