# Summary card — sequential visual correction

Owner instruction: verify and deploy one card before continuing. This PR106 follow-up corrects the oversized Summary composition from PR102; Work, Billing, Records and Tasks are unchanged.

The main card ends at task/material progress. Notes and Job actions remain directly below with their original handlers. The implementation retains full actual addresses, truthful values, permissions, unsaved-note safeguards and 44px interactive minimums. The native picker remains 16px. Summary-only typography, spacing, background and tab outlines now follow the approved reference.

## Rendered review

[Same-width comparison](evidence/2026-11-12-summary-card-comparison.jpg) compares the frame-free approved reference with the final Chromium capture at 390 CSS pixels. The main card is 362px wide and 432.67px tall, versus 538.44px in the first candidate. Both Chromium and WebKit screenshots were inspected.

The comparison shows a much closer card boundary, hierarchy, shortcut treatment and spacing. Visible differences remain: the private-beta disclosure, native picker, actual crew/customer/address values, a 44px Review visit button and retained secondary notes/queue/actions. Pixel identity, physical-phone acceptance and signed-in owner-business acceptance are not claimed.

## Evidence

- Combined source 9950e065c9c654c275ef5775cafdc0ca4f1d0094 passes all 38 focused browser cases (19 per engine): [run 43318252844](https://github.com/Velnu38/Velnu/actions/runs/43318252844).
- Final artifacts: Chromium 13989013332 and WebKit 13989831313. They include independent Summary screenshots and metrics.
- Local production build and all 95 startup checks pass. Targeted phone, job-management and execution DOM scenarios and all 10 registry checks pass.
- Local Chromium cannot launch because the operating system denies its socket creation. Hosted browser results supply the rendered evidence.
- Protected preview dpl_HXjYxHiroxF1L7yWDBpj7hjbETu3 serves the reviewed Summary JS/CSS, HTTP 200, private no-store/noindex and the beta backend. Reviewed JobsPage CSS SHA-256: 860fc9763bcbbba37e7fb2c06b69ba9179b6808883b3e3c494d71f8af303727f.
- PR104 export and PR105 cost controls advanced beta during verification. Their changes are reconciled into this candidate without altering the Summary implementation. Final combined required checks remain necessary before release.

The scope of the owner's eventual layout work includes Home, Invoices, Estimates, Jobs, More and their downstream screens. This release completes only the current Summary step. Do not proceed to the next card until this one is deployed and verified. No providers, customer messages, charges, production backend or public launch changes are authorized here.
