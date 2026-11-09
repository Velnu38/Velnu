# Square invoice payments and Tap to Pay

Updated: 2026-11-09. Implementation is available in the private beta; new Square payments remain inactive until the operator configures and certifies the connection. No paid plugin, subscription, native app distribution account or Finviant application fee is provisioned by this change.

## Account ownership and cost

Each Finviant business connects its own Square merchant account through OAuth. Square collects its normal processing fees from that merchant. Finviant does not advance the payment or pay the merchant's processing fees. Use Square's standard account/API options; obtain the Finviant owner's approval before selecting any additional paid plan, hardware, developer/distribution account or service. Square POS Tap to Pay uses a compatible phone and the installed Square Point of Sale app. It does not embed a native NFC payment SDK in the Finviant website.

## Operator configuration

Create/reuse the Finviant Square developer application. Configure Sandbox first for hosted checkout and API/webhook testing. Point of Sale does not provide a Square Sandbox; a physical-device/live transaction requires a separately authorized amount and refund plan.

Store credentials directly in Supabase Edge Function secrets. Do not put secret values in Git, reports, screenshots, logs or chat:

- `SQUARE_APPLICATION_ID`
- `SQUARE_APPLICATION_SECRET`
- `SQUARE_TOKEN_ENCRYPTION_KEY`: a cryptographically random 32-byte key, base64 encoded; retain a protected recovery copy and plan rotation before replacing a key used by stored connections.
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `FINVIANT_SQUARE_ENVIRONMENT`: `sandbox` or `production` (defaults to sandbox).
- `FINVIANT_SQUARE_ENABLED`: leave unset/false until acceptance is complete. Pausing new payments does not turn off configured settlement/refund verification.

The existing Supabase URL/service-role environment is used server-side. No service key is exposed to the client. Separate projects/modes must have their own configuration.

Private-beta addresses:

- OAuth redirect: `https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/square-payments?callback=oauth`
- Square POS Web Callback URL: `https://finviant.com/square-return`
- Signed event endpoint: `https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/square-payment-events`
- Read-only deployment status: `https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/square-payments?health=1`

Subscribe to `payment.created`, `payment.updated`, `refund.created`, `refund.updated`. The signature uses the exact registered notification URL and raw body. Endpoint JWT verification is off because these public routes authenticate OAuth state, scoped customer tokens or the Square signature; protected owner/staff actions independently verify the Supabase user and database membership. Never disable the handler checks.

OAuth requests `MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ ORDERS_WRITE`. Tokens are encrypted with AES-GCM and business/merchant/environment associated data; OAuth state is hashed, single-use and expires after ten minutes. Expiring tokens refresh server-side with a version check. First connection uses the verified active US/USD merchant's primary card-processing location; reconnect retains the original location. Changing merchant/location requires reconciliation and a reviewed migration rather than silently rebinding historical payments.

## Business workflow

The primary owner opens **Invoice & Estimate Setup → Square & Tap to Pay → Connect Square**. Review the displayed location and sign in to that same location in Square Point of Sale. A billing-authorized Business user opens an issued unpaid invoice, then **More → Take payment with Square** on a phone. The server reserves the current remaining amount and returns a card-only POS request. An internet connection is needed for automatic verification.

The customer can also choose Square on the existing private invoice link, after activation and merchant connection. No Finviant customer account or dedicated portal is created. Stripe remains available through its existing verified merchant lane. New manual provider defaults are limited to Stripe and Square. Historical issued document snapshots retain their original content. Removed default destinations have a private rollback record; no invoices, estimates, payments, customers, jobs, roles or entitlements are deleted.

A browser callback never marks an invoice paid. The server retrieves Square's order and payment, checks seller/location/mode/amount/currency/application/reference, and posts an idempotent receipt. The callback and signed events converge on the same ledger. Original gross receipts and dated verified refund outflows remain visible; invoice balances use net received funds. Reported Square processing costs create protected expense records, separate from income. Payout/bank reconciliation and complete accounting profit are not claimed.

Do not change the amount or add tips, extra taxes, surcharges, split tenders or offline payments in Square during this initial path. These are outside the certified exact-amount flow. Unmatched/mismatched/credited-deposit cases require reconciliation, not a second charge. If POS returns without a completed transaction, check Square first. The original browser can release an unbound reservation using **I checked Square: no payment taken** only after staff verify no payment is processing/completed and close the Square transaction. This does not cancel a transaction in Square; late settlements remain subject to balance/duplicate guards.

## Separate credit-card processing fees

The setup screen can save an owner-only preference at 0%, 0.5%, 1%, 1.5%, 2%, 2.5%, 2.9% or 3%. **Saving a preference does not add a fee, change an issued document or activate collection.** Existing uniform base-price adjustments are separate.

Collection remains off. Before enabling a separate fee line, certify the actual processor-supported channel, eligible credit-card funding type, merchant/location's legal and network allowance, actual acceptance cost, tax treatment and required notices/disclosures/reporting. Never surcharge debit/prepaid/ACH/cash/check; never exceed the lowest applicable cap or apply both Finviant and Square fee calculations. Square's current automatic surcharge program has channel/beta/partial-payment limitations. A merchant's self-attestation or a flat percentage alone is insufficient.

Required implementation/acceptance still includes approved per-document disclosure/snapshot, supported card eligibility before collection, estimate-to-invoice carry-forward, partial/refund/change-order allocation, and consistent final PDF/provider receipt/ledger reporting. Do not enable ordinary Stripe/Square checkout by adding an unconditional generic card-fee line. No Free-plan Finviant platform fee is activated here.

## Release evidence and remaining checks

Use `npm run test:operations`, financial and scheduling/payment/record regressions, the production build/startup checks and the assessment registry. Tests use synthetic data; they do not certify a live Square merchant or phone. Real-browser layout/interaction checks remain open where this workspace restricts browser execution and local preview access. The local/CI-only preview and browser fixtures must never be deployed as the public site.

Before live activation verify OAuth/cancellation/reconnect/refresh, hosted checkout, compatible iPhone and Android POS/Tap, exact reference/amount mapping, retries and callback loss, delayed events, partial/full/deposit payments, refund/credited-deposit review, fee expense updates, merchant/mode isolation, permission revocation and overlapping Stripe/Square/manual operations. Reconcile balances in Home, invoice Activity, customer statements, Jobs and Financial Performance. Disputes, multiple active locations, unattended offline reconciliation and complete fee/payout accounting remain follow-up scope. Obtain explicit authorization before a real charge or refund. Keep PAY-01, PAY-02 and FIN-02 open until their evidence is complete.

Primary references checked 2026-11-09:

- https://developer.squareup.com/docs/pos-api/build-mobile-web
- https://developer.squareup.com/docs/pos-api/web-technical-reference
- https://developer.squareup.com/docs/pos-api/payments-integration
- https://developer.squareup.com/docs/oauth-api/overview
- https://developer.squareup.com/docs/webhooks/step3validate
- https://developer.squareup.com/reference/square/checkout-api/create-payment-link
- https://developer.squareup.com/reference/square/merchants-api/retrieve-merchant
- https://developer.squareup.com/reference/square/objects/PaymentRefund
- https://squareup.com/help/us/en/article/8596-set-up-and-manage-card-surcharges
- https://usa.visa.com/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf
