# Step 17: payment recovery and certification

The existing Stripe/Square implementation is retained. This work does not activate payments, create merchant accounts, send messages, charge/refund a card, collect surcharges or change the private-beta boundary.

## Confirmed defects and correction

The Square event handler required an order/payment binding made by the phone's return callback. If that return never occurred, a verified settlement could not reach the invoice. A no-match PL/pgSQL row could also serialize as an object with null fields, which the handler treated as a real operation. Both cases now have explicit handling.

Signed events fetch the authoritative payment and order. A single-card tender and its exact Finviant operation reference can locate a POS reservation through a new service-only, read-only function. Merchant, mode, location, invoice operation, order, amount, currency, payment identity, application and timestamp are verified before the existing attachment and idempotent ledger path is used. The browser callback uses the same order/tender validation. Notes from the event body or browser are not accepted as payment evidence. Missing or conflicting provider references remain unmatched; they never trigger a guessed invoice match or another charge.

The payment note is not assumed to exist: a server-retrieved tender note can carry the reference. The exact behavior still requires actual iPhone/Android acceptance. Pausing new payments preserves verification of already-taken funds. Existing owner cancellation, balance guards, refund history and review states remain in place. This additive migration does not modify historical payments, tokens, connections or enablement.

## Current evidence

- 42 local Stripe/Square/payment database tests passed, including the real local ledger behind signed synthetic Square events, lost return, duplicate events, delayed callback, dated refund outflows, protected processing costs, wrong merchant/mode/location, malformed references and service-only lookup permissions.
- 89 deployment guard tests passed; both Square Edge packages build with explicit existing handler authentication. Full CI must also pass fresh PostgreSQL replay, Deno typechecking and browser regressions before deployment.
- New regression tests reproduced two failures on the preceding implementation with the same test schema. They do not make provider requests or represent live merchant certification.
- Read-only beta inventory found zero Stripe merchant bindings and zero Square connections. The connected Finviant Stripe test account has zero connected merchant accounts. No test account or merchant was fabricated or marked verified.
- No live-provider charge, refund, OAuth change, email or SMS occurred in this work. Managed SMS and calendar consent are separate acceptance gates.

## Sandbox acceptance sequence

1. Use isolated merchant test accounts and explicitly map the approved Finviant test business, provider merchant, environment and Square location. Inspect privileges and enabled status; keep customer-facing new payment paths inactive.
2. Verify owner-only connection, cancellation, reconnect, token expiry/refresh/revocation and cross-business denial. Retain provider identifiers in private operator evidence; never store keys or tokens in Git.
3. In sandbox, exercise hosted checkout success, cancellation, pending/failed/delayed settlement, repeated requests, wrong mode/account/currency/reference and revised invoice totals. Visiting a return URL must leave payment state unchanged until server verification.
4. Replay signed events, reorder them and interrupt callbacks. Verify one provider operation and one ledger entry. Run concurrent Stripe, Square and manual attempts against the same invoice in the isolated full database; record each winner/rejected or review outcome. Existing manual-only concurrency evidence is not substituted for this matrix.
5. Exercise deposits credited to final invoices, partial/full payment, partial/full refund and dispute events. Reconcile invoice balance, Activity, Jobs, statements and Financial Performance against gross receipts, dated outflows and provider fees. Dispute and complete Stripe fee/payout accounting are still open; passing synthetic settlement tests does not certify these features.

## Bounded live/device proposal — not authorized or executed

After sandbox checks and exact merchant/device selection, request approval for at most four owner-controlled USD 1.00 charges: Stripe hosted checkout, Square hosted checkout, Square POS on a compatible iPhone and Square POS on a compatible Android phone. Maximum gross test charges: USD 4.00. Refund every successful charge to its original payment method; use one USD 0.50 partial refund followed by the remaining USD 0.50 where supported, and full refunds otherwise. Proposed nonrefundable processing-fee budget: USD 2.00 total, subject to the actual merchant fee schedule. Stop before charging if provider minimums, fees or device availability exceed this proposal; do not silently increase amounts or repeat ambiguous charges.

For the two POS tests, also exercise missing app, wrong signed-in seller/location, cancellation and lost return without charging repeatedly. Capture the real provider status before any retry. Do not enable offline, cash, tips, split tenders, extra taxes or surcharge collection. Square POS has no sandbox; simulated mobile browsers do not replace these physical tests. Do not create a real dispute. Refund success requires provider and ledger confirmation, not clicking a button.

This proposal cannot certify unresolved disputes, all failure modes, fee/payout accounting or full device coverage on its own. PAY-01/PAY-02 remain open until every applicable criterion has evidence; FIN-02 stays inactive. No Finviant application fee is promised through Square POS.

## Deployment and rollback

After final CI, verify the additive function is absent, apply its exact source only to the private-beta backend, and preserve the prior Square Edge source/version. Deploy the two tested packages with their existing authentication modes. Compare deployed source hashes, inspect public health/unauthorized request behavior, confirm no merchant connections or enablement changed, then record immutable receipts. Roll back both Edge versions if needed; leave the unused read-only function in place. Do not drop ledger history, recreate uncertain payments or change the separate production environment.

Primary references reviewed November 10 (America/New_York):

- https://developer.squareup.com/docs/pos-api/payments-integration
- https://developer.squareup.com/docs/pos-api/web-technical-reference
- https://developer.squareup.com/docs/payments-api/webhooks
- https://developer.squareup.com/reference/square/objects/Tender
- https://developer.squareup.com/reference/square/objects/Payment
- https://docs.stripe.com/checkout/fulfillment
