# Current repository handoff

Checked November 12, 2026 UTC.

- PR93 is merged as 4339c3a559cb14164ea273efa79ee1fba2b1c399. All ten workflows passed at final candidate 4846fc9635f4c090e8f2ec2548980ee70beb543f; tested and merged trees are identical. No further selector or archive-runner repair is pending.

- Current verified application release: PR98 merge c628a052173dc6a755e132865158c47f0733b8ae, READY deployment dpl_GuE6MHxGTXofwG74SpRVnhDw8ZYn on both Finviant domains. Phone Job Management layout only; all five CI workflows and 22 release jobs passed. HTTP 200, private no-store/noindex and beta Supabase xvybcmyoblfgzokaifsx verified.

- PR92 recovery and its additive lookup/Square Edge rollout are complete. Merchant activation, real-provider and physical-device acceptance remain open; do not repeat integration or rollout.

- PR94 remains merged and deployed; all 50 original readiness records survive. AI-03 contextual navigation is now complete after PR95 targeted and required CI and live verification.

- Card 04 implementation is merged and deployed: saved effective reminder rules are visible and stale-business responses are guarded. All four required workflows passed, including all 22 complete-suite jobs. AUTO-01 stays open only for separately gated provider/device acceptance. Card 05 / PR97 and the remaining sequential queue are paused by the owner. No provider activation, real sends or charges.

[Card 04 evidence](evidence/2026-11-12-effective-reminders.json) · [Card 03 evidence](evidence/2026-11-11-fin-navigation.json) · [Generated queue](../ASSESSMENT_REPORT.md) · [Registry](launch-readiness.json)

- Phone Job Management layout is complete and deployed. Application changes are CSS-only at widths <=820px. All existing controls, sections, permissions, links, records and balances are retained. Browser checks passed at 320/390/430px and screenshots were inspected. No provider/backend change or real send/charge. PR97 and the earlier sequential queue remain paused. See [layout evidence](evidence/2026-11-12-job-mobile-layout.json).

- Current work: replace the rejected PR98 phone density with the owner-approved full-width Summary/Work/Billing/Records menus and focused details/editors. Base 78bd9567f8dfb77b944abbbe9c1a0d73dd014934; no PR97 changes. Hosted validation and beta release pending. See [phone flow evidence](evidence/2026-11-12-job-phone-flow.json).
