# Deferred offer assessment

Recommendation for owner consideration: validate a **service-job handover download pack** after core release acceptance. This assessment selects no new build, vendor, subscription or marketing launch. GROW-01–03 remain open. Native Jobs and the manager-operated roster retain all promised capabilities.

| Rank | Candidate | Feasibility and main risk |
| --- | --- | --- |
| 1 | Original printable/fillable job handover pack | Lowest ongoing provider dependence; reuse Finviant's document expertise. Demand and willingness to pay are unknown; copying existing in-app reports could cannibalize Office. |
| 2 | Advanced reporting add-on within Office | More source reuse, but financial correctness, permissions and ongoing support expand the core commitment. Must not remove promised Business features to create an upsell. |
| 3 | Separate field-report app | Adds account/billing/export/support surfaces, mobile acceptance and possible employee access requirements. Defer until a separate target user and economics are validated. |

## Candidate 1 scope to test

An original, generic set of printable and fillable forms: work scope/checklist, visit record, materials/time worksheet, change-request record and completion handover. Clearly distinguish a worksheet from legal contract language, an accounting ledger or a digitally certified signature. Provide a short usage guide and sample data. Do not bundle customer records, third-party templates, copyrighted competitor layouts or modified Office access restrictions.

The potential customer is a small service operator who still uses paper or basic documents. That is a demand hypothesis, not market research. Interview 5–10 owner-selected businesses about their current forms, frequency, errors, switching cost, desired file format, phone/print usage and actual willingness to buy. Show a nonfunctional concept only after scope selection. Record purchase/pilot intent and reasons to decline; do not send outreach without authorization or claim sales based on positive comments.

## License review

The current lockfile pins `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 with MIT licensing. The installed pdf-lib notice was inspected; redistributed software must preserve applicable copyright/license notices. A downloadable form does not need to ship a JavaScript runtime. If a generator is distributed, inventory all included transitive packages and notices at that exact release.

The current DejaVu font notice is retained in `shared/fonts/DEJAVU-LICENSE.txt`. Its terms permit embedding/distribution subject to the notice and naming conditions, and prohibit selling the font by itself. Keep the appropriate notices with any packaged embedded font; review the final packaging and any modifications. Do not assume every example image or template in an otherwise MIT repository shares the code's license.

Primary sources checked November 10: [pdf-lib license](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md), [DejaVu license](https://dejavu-fonts.github.io/License.html). This is an engineering inventory, not legal certification. No SVAR PRO, GPL/AGPL ERP component or white-label provider is needed for this proposed download; their licensing and resale rights have not been approved.

## Economics and selection gate

Price is unselected. Model each sale using the actual selected checkout/delivery fees, support minutes, refunds, update commitment, acquisition cost and allocated creation/testing cost. A static file avoids recurring AI/OCR usage but is not cost-free. Required contribution per sale must cover at least half of the selling price after all modeled costs if the project's 50% fully loaded margin target is retained. Compare that result with genuine purchase intent, not a guessed market price.

After owner selection, define file formats, supported PDF readers/devices, accessibility, print margins, fill/save behavior, formulas if any, version/update terms, protected delivery and refund support. Test the purchased archive, link expiry, duplicate payment events and refunds in a sandbox. Until those gates pass, keep the offer off the landing page and checkout. A dedicated customer portal, native NFC app, employee self-service, payroll and white-label suite remain separate deferred decisions.
