# Summary card — sequential visual correction

Owner instruction: work on one card deployment at a time; compare the deployed card to the provided mockup before moving to the next card. Start with Job Management Summary. PR102 is already merged; this is a separate follow-up based on c614324.

The committed PR102 Summary comparison visibly differs in picker font weight/size, card height and vertical spacing. The prior claim of a close match does not establish identical rendering. This candidate scopes font and spacing corrections to the Summary state only. It retains full actual addresses, truthful values, notes, Job actions, all permissions and 44px interactive minimums. The main card ends at the progress line; notes and Job actions remain directly below it with their original handlers. Reference-height tab outlines retain 44px touch targets; the native picker stays 16px. No other card is redesigned. Candidate automatic Vercel deployment is disabled.

Local Chromium launch fails with `socket() failed: Operation not permitted`. Hosted Chromium/WebKit screenshots, visual comparison, exact-head CI and beta verification must pass before release. Existing comparison: `docs/evidence/2026-11-12-phone-reference-match/summary-comparison.jpg`. New independent Summary case emits metrics and a screenshot, checks width/control sizing, opens Review visit and Job details, and retains notes without sending messages.

Do not declare identical appearance or physical-device acceptance from source inspection or green functional tests. Do not move on to Work, Billing, Records or Tasks until this card is verified and deployed. Coordinate any merge against the latest beta to preserve active reminder/export/security/cost-control work.

First hosted run 43311928227: all 36 existing focused cases passed; the added Summary case used the wrong existing panel name (Visits & crew versus Schedule & Crew). Corrected the assertion. Retained artifact 13986148598 as first-pass evidence; it is not the final visual acceptance screenshot. Local production build passed all 95 startup/deployment tests.
