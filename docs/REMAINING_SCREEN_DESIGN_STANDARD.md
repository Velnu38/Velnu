# Remaining screen design standard

Updated by owner instruction November 12, 2026: approved mockups are the ONLY
visual reference. The current deployed Job Management design is rejected and
must not be preserved as a visual standard. Job Management, Home, Invoices,
Estimates, the Jobs directory and More are all in scope, including downstream
screens and forms. Preserve their existing functionality.

Complete, visually compare, deploy and verify the actual deployed card before
beginning the next card. Use reduced targeted testing plus required checks.

## First card: Home calendar / PR107

The initial candidate used Job Management as a reference and is superseded.
Its hosted Chromium/WebKit checks passed, but visual inspection failed: oversized
controls/heading, excessive filter height, and wrong period-control order.

The revised candidate uses only `Finviant mobile business dashboard proposal.png`
(Library ID `libfile_46f0d31a68088191849ba537a73b6fcd`). It restores the compact
heading/toggle, underlined calendar action, date control order and day strip.
The existing team filter is retained in a disclosure, because the phone concept
omits it. Real job details, errors and permissions are retained. Touch targets
and actual content can make the card taller than the illustration.

The owner approved publication to Velnu38/Velnu and private-beta deployment after
verification. Revised populated Chromium/WebKit screenshots must be reviewed
before release. No deployment or signed-in rendered acceptance is claimed yet.
Job Management is the next screen family to reassess against its own mockups.
