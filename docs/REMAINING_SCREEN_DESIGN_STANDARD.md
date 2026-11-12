# Remaining screen design standard

Owner instruction, November 12, 2026. The completed Job Management tab is the
implemented design model and must be preserved, including PR106 Summary changes.

Apply to Home, Invoices, Estimates, the Jobs directory and More, including their
downstream screens and forms. Match each approved mockup and use completed Job
Management for button sizes/shapes, spacing, typography, colors, navigation and
full-width phone sizing. Retain each screen's existing functions. Identify material
reference conflicts before implementation. Complete, visually compare, deploy and
verify the actual deployed card before beginning the next card. Use reduced,
targeted tests plus required checks; do not claim automated checks are physical
phone acceptance.

## First candidate: Home calendar card

Base: 7875381635b7f9a7b96a38b80cdc5156d0dbbd80 on
`ux/private-testing-20261029`. Candidate branch:
`ux/home-design-standard-20261112`; application commit: 2a37b75.

References inspected: `Finviant mobile business dashboard proposal.png`
(Library ID `libfile_46f0d31a68088191849ba537a73b6fcd`), completed
Job Management CSS and retained rendered comparison evidence. The Home reference
is denser than Job Management, especially the schedule strip and row actions.
This difference was disclosed before changes: preserve Home's composition, use
readable controls, and allow wrapping/scrolling rather than shrinking the page.

Only Home calendar CSS is changed. Job Management, other Home cards, permissions,
data and handlers are unchanged. Calendar creation forms and subsequent cards
still require their own review and implementation.

TypeScript build check passed. Assessment synchronization, all ten assessment
tests and consistency check passed. Local Chromium could not launch because
socket creation is prohibited. A focused Chromium/WebKit workflow is prepared
using existing Home functional and screenshot checks. No rendered candidate
approval, deployment or deployed-card verification is claimed.

The owner explicitly approved pushing this candidate to Velnu38/Velnu and
private-beta deployment after verification. Run hosted checks, inspect candidate
images against both references, fix discrepancies, and only then deploy this
first card and inspect the deployed card. Do not start the next card first.
