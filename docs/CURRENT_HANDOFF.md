# Current repository handoff

Checked November 12, 2026 UTC.

- PR93 is merged as 4339c3a559cb14164ea273efa79ee1fba2b1c399. All ten workflows passed at final candidate 4846fc9635f4c090e8f2ec2548980ee70beb543f; tested and merged trees are identical. No further selector or archive-runner repair is pending.

- Current verified application release: PR99 merge 4aa808e79ad49a314b60ed945d9a3c82b035f649, READY deployment dpl_6wMZDuCScLmtuA4nM4CRRkCwgAbo on both Finviant domains. Full-width responsive phone Job Management menus, focused detail screens and full-viewport editors. All five required workflows and 22 release jobs passed; tested and merged trees match. HTTP 200, private no-store/noindex and beta Supabase xvybcmyoblfgzokaifsx verified.

- PR92 recovery and its additive lookup/Square Edge rollout are complete. Merchant activation, real-provider and physical-device acceptance remain open; do not repeat integration or rollout.

- PR94 remains merged and deployed; all 50 original readiness records survive. AI-03 contextual navigation is now complete after PR95 targeted and required CI and live verification.

- Card 04 implementation is merged and deployed: saved effective reminder rules are visible and stale-business responses are guarded. All four required workflows passed, including all 22 complete-suite jobs. AUTO-01 stays open only for separately gated provider/device acceptance. Card 05 / PR97 and the remaining sequential queue are paused by the owner. No provider activation, real sends or charges.

[Card 04 evidence](evidence/2026-11-12-effective-reminders.json) · [Card 03 evidence](evidence/2026-11-11-fin-navigation.json) · [Generated queue](../ASSESSMENT_REPORT.md) · [Registry](launch-readiness.json)

- PR99 replaces the rejected PR98 phone density with the approved responsive Summary/Work/Billing/Records menus and focused details. Phone layouts use available width with safe-area padding; editors fill the viewport. Existing business actions, permissions, section deep links, queue search/filter/paging, unsaved edits and completion safeguards remain. Secondary completion review is under Job actions. Desktop behavior remains available. No backend/provider change or real send/charge.

- All 51 readiness records and acceptance criteria survive. Broader JOB-01/UX-01, physical iPhone/Android and provider gates remain open. PR97 and the earlier sequential queue remain paused. See [phone flow evidence](evidence/2026-11-12-job-phone-flow.json). Hosted screenshots and CI receipts are linked in that evidence; local Chromium could not launch in this environment, so real browser verification used hosted Chromium and WebKit.
