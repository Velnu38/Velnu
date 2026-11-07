# Itemized voice invoices and estimates

Say each service and dollar amount: “Create an estimate for Bob Smith for mowing $100 and edging $40, total $140.” Finviant opens one review with two editable lines and a $140 total. The stated total is checked against the calculated sum and is never an extra line. A mismatch blocks saving until the charges are corrected or the user explicitly chooses the calculated total.

Both invoices and estimates use the same draft review and the existing atomic, retry-safe `create_document` operation. Finviant calculates the preview using its established currency-rounding rules; the database recalculates all saved lines and totals. No automatic customer send or payment request is added.

Flat service charges default to quantity one. Quantities stay out of the normal voice form; “Use quantities” exposes them, and explicit instructions such as “3 shrubs at $25 each” retain their units. Existing non-unit manual document workflows remain available. A quantity other than one keeps unit pricing visible.

Zero tax is hidden in voice review, invoice/estimate preview and print views, and the customer approval copy. “Add tax” is available when needed; saved nonzero business defaults still load. Explicit “no tax” overrides the default for that reviewed draft. Removing the tax control explicitly sets its rate to zero. Database tax information is preserved; hiding a zero total does not change historical amounts.

Supported clear currency instructions include dollar symbols, numeric dollar amounts, common spoken whole-dollar numbers and cents. Invalid amounts, discounts, refunds, deposits, payments, or unclear line boundaries require manual review. All item descriptions and amounts remain editable; no prices are invented. Documents remain limited to 50 lines; extra lines are not silently dropped. Unsupported date language still requires review in the date control.

Automated coverage includes separate invoice/estimate lines, stated totals, exact currency previews, tax defaults, optional quantities, unsafe amounts, atomic saves and duplicate submission guards on desktop/mobile. Browser speech/provider responses are mocked; real-phone/noisy dictation and actual cloud transcription remain separate checks requiring configured providers.
