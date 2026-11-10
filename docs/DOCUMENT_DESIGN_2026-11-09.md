# Invoice and estimate stationery refresh

Implemented against base `6cacfe7` in isolated branch `ux/document-design-20261109`. No deployment or provider messages were performed.

- Shared canonical PDF template v2 uses a subtly brand-tinted reference/date panel, clear navy line-item headers and high-contrast financial totals with the company's accent.
- Blank invoice/estimate footer text displays `Thank You!`, centered near the bottom of the final page, above page references. Custom footer wording replaces the fallback and wraps/paginates safely. No saved settings or historical records are rewritten.
- Draft HTML and settings previews share the same fallback. Draft stationery has clearer hierarchy, alternating item rows, tabular figures, responsive totals and print styling. Settings explain that blank text uses the default.
- Saved PDFs remain immutable: existing artifacts are served unchanged for review, download and email. The new template applies to newly generated artifacts. Change-order custom notes retain their previous behavior.

## Verification

- `node --import tsx --test tests/documents/*.test.ts`: 19 passed, covering exact footer bounding-box centering/bottom placement for invoice and estimate, blank variants, unchanged custom text, long multiline pagination, frozen snapshot determinism, logo embedding, financial totals, cached artifact integrity and mocked email attachment dispatch.
- `npm run build`: passed, including TypeScript, Vite and 56 startup/deployment checks. Vite reports its existing large-chunk warning.
- Invoice and estimate synthetic PDFs were rendered with Poppler and visually inspected at 1000px: heading, addresses, table, totals and footer are legible and separated on one page.
- `npm run assessment:sync`, `npm run assessment:test` (7 passed), `npm run assessment:check`: passed. No public launch/provider/device gate marked complete.
- Browser regression result recorded below after execution. Browser fixtures do not certify live customer sends, real phones or physical printers.

Browser execution is blocked in this environment before page launch: Chromium exits with `process_singleton_posix.cc: socket() failed: Operation not permitted`. The normal run and one explicitly approved escalation both encountered the same restriction. The final fail-fast attempt reports one launch failure and 28 unrun tests, not a product assertion failure. The added 390px/1280px draft footer checks and existing review/save/delivery flows must be rerun in a browser-capable environment before release:

```
FINVIANT_TEST_BROWSER_PATH=/usr/bin/chromium npx playwright test tests/e2e/document-creation-preview.spec.mjs tests/e2e/document-review-delivery.spec.mjs
```

## Hosted verification follow-up

The authorized design was published in PR #70 (`f72887a`). Its isolated Vercel preview reached READY and its HTML, application loader and settings assets returned HTTP 200 with the new footer help/default. The first hosted document run passed all 19 PDF tests but exposed obsolete browser fixtures: they expected the former unsaved HTML preview, omitted the canonical PDF response/revision and assumed delivery controls were always open. The shared settings mock also omitted `get_delivery_automation.rule`, causing an unrelated settings error boundary.

Browser fixtures were updated to match the existing application, without changing application behavior: actual parseable synthetic PDF transport, revision-bound sending, explicit Send dialogs, saved-draft Back/edit persistence, 390px/1280px containment, exact download bytes, retry gating and late-response isolation. Hosted browser results must be checked on the resulting commit before release. Broader legacy onboarding/pricing browser scenarios are separate from PDF rendering and are not represented as passing.

On `9789e19`, hosted PDF tests passed 19/19 and browser checks passed 38/39. The estimate Back-to-edit flow exposed simultaneous native dialogs; the editor now replaces the preview until editing closes. Desktop/mobile edit persistence and tax/date preservation pass. The remaining browser case is change-order creation navigation and remains a release gate until corrected and rerun. The latest local build passes all 56 startup checks.

Broader CI identified two unchanged harness issues: bespoke voice routes lacked private-beta admission mocks, and a stalled transcription socket mock left only an unreferenced timeout under Node 22. Test-only corrections retain authorization and timeout assertions; no production authentication or transcription behavior changes. These require fresh hosted verification. No live deployment or real customer message has been performed.
