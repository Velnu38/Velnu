import { readLimitedRequest, verifySignedEvent } from '../_shared/signedEvents.ts'
import type { CheckoutReservation, StripeRequest } from '../customer-invoice-checkout/handler.ts'

type Dependencies = {
  configured: boolean; secret: string; livemode: boolean; stripe: StripeRequest;
  context: (checkoutId: string, account: string) => Promise<CheckoutReservation | null>;
  apply: (input: Record<string, unknown>) => Promise<unknown>;
  refund: (input: Record<string, unknown>) => Promise<unknown>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const sessions = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'])
const refunds = new Set(['charge.refunded','refund.updated'])
const objectId = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' ? String((value as {id?:unknown}).id || '') : ''

export function customerPaymentEventsHandler(deps: Dependencies) {
  return async (request: Request) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json','cache-control':'no-store' } })
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
    if (!deps.configured || !deps.secret.startsWith('whsec_')) return reply(503, { error: 'Customer payment webhooks are not activated.' })
    let event: Record<string, any>
    try {
      const raw = await readLimitedRequest(request)
      if (!await verifySignedEvent('stripe', raw, request.headers, deps.secret)) return reply(401, { error: 'Invalid signature.' })
      event = JSON.parse(raw)
      if (!/^evt_[A-Za-z0-9]+$/.test(String(event.id)) || !/^acct_[A-Za-z0-9]+$/.test(String(event.account)) ||
        event.livemode !== deps.livemode || !Number.isSafeInteger(event.created) || !event.data?.object) return reply(400, { error: 'Wrong payment account, mode or event.' })
    } catch { return reply(400, { error: 'Invalid event payload.' }) }
    if (!sessions.has(event.type) && !refunds.has(event.type)) return reply(200, { ignored: true })
    try {
      if (sessions.has(event.type)) {
        const sessionId = String(event.data.object.id || '')
        if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return reply(400, { error: 'Invalid checkout event.' })
        const session = await deps.stripe('/checkout/sessions/' + sessionId, event.account)
        const checkoutId = String(session.metadata?.finviant_checkout_id || '')
        if (!uuid.test(checkoutId)) return reply(200, { ignored: true })
        const context = await deps.context(checkoutId, event.account)
        if (!context) return reply(200, { ignored: true })
        if (session.id !== sessionId || session.mode !== 'payment' || session.livemode !== context.livemode || context.livemode !== event.livemode ||
          session.currency !== context.currency || session.amount_total !== context.amount_minor || session.client_reference_id !== context.id ||
          session.metadata?.finviant_invoice_id !== context.invoice_id || session.metadata?.finviant_revision_id !== context.revision_id ||
          (context.stripe_session_id && context.stripe_session_id !== sessionId)) return reply(409, { error: 'Checkout does not match the published invoice payment.' })
        let status: 'paid' | 'pending' | 'failed' | 'expired'
        if (session.payment_status === 'paid') status = 'paid'
        else if (event.type === 'checkout.session.expired' && session.status === 'expired') status = 'expired'
        else if (event.type === 'checkout.session.async_payment_failed' && session.payment_status === 'unpaid') status = 'failed'
        else if (event.type === 'checkout.session.completed' && session.status === 'complete' && session.payment_status === 'unpaid') status = 'pending'
        else return reply(503, { error: 'Payment confirmation is still pending. Retry delivery.' })
        const paymentIntent = objectId(session.payment_intent)
        if (['paid','pending'].includes(status) && !/^pi_[A-Za-z0-9]+$/.test(paymentIntent)) return reply(409, { error: 'Payment reference is missing.' })
        let method = 'other'
        if (status === 'paid') {
          const intent = await deps.stripe('/payment_intents/' + paymentIntent + '?expand[]=latest_charge', event.account)
          if (intent.id !== paymentIntent || intent.livemode !== context.livemode || intent.currency !== context.currency ||
            intent.amount_received !== context.amount_minor || intent.metadata?.finviant_checkout_id !== context.id) return reply(409, { error: 'Received funds do not match this invoice payment.' })
          const type = intent.latest_charge?.payment_method_details?.type
          method = type === 'us_bank_account' ? 'ach' : type === 'card' ? 'card' : 'other'
        }
        const result = await deps.apply({ p_event_id:event.id,p_account:event.account,p_checkout:context.id,p_session:sessionId,
          p_payment_intent:paymentIntent || null,p_amount_minor:context.amount_minor,p_currency:context.currency,p_livemode:context.livemode,
          p_status:status,p_occurred_at:new Date(event.created*1000).toISOString(),p_method:method })
        return reply(200, result)
      }
      let chargeId = String(event.data.object.id || '')
      if (event.type === 'refund.updated') {
        if (!/^re_[A-Za-z0-9]+$/.test(chargeId)) return reply(400, { error:'Invalid refund event.' })
        const refund = await deps.stripe('/refunds/' + chargeId, event.account)
        if (refund.status !== 'succeeded') return reply(200, { ignored:true })
        chargeId = objectId(refund.charge)
      }
      if (!/^ch_[A-Za-z0-9]+$/.test(chargeId)) return reply(400, { error:'Invalid refund charge.' })
      const charge = await deps.stripe('/charges/' + chargeId, event.account)
      const intentId = objectId(charge.payment_intent)
      if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) return reply(200, { ignored:true })
      const intent = await deps.stripe('/payment_intents/' + intentId, event.account)
      const checkoutId = String(intent.metadata?.finviant_checkout_id || '')
      if (!uuid.test(checkoutId)) return reply(200, { ignored:true })
      const context = await deps.context(checkoutId, event.account)
      if (!context) return reply(200, { ignored:true })
      if (charge.id !== chargeId || intent.id !== intentId || charge.livemode !== context.livemode || intent.livemode !== context.livemode ||
        context.livemode !== event.livemode || charge.currency !== context.currency || charge.amount !== context.amount_minor || context.stripe_payment_intent !== intentId) return reply(409, { error:'Refund does not match the invoice payment.' })
      const page = await deps.stripe('/refunds?charge=' + encodeURIComponent(chargeId) + '&limit=100', event.account)
      if (!Array.isArray(page.data) || page.has_more === true) throw new Error('Refund reconciliation needs review')
      const verified = page.data.filter((row: any) => row.status === 'succeeded').map((row: any) => {
        if (!/^re_[A-Za-z0-9]+$/.test(String(row.id)) || objectId(row.charge) !== chargeId || row.currency !== context.currency ||
          !Number.isSafeInteger(row.amount) || row.amount <= 0 || !Number.isSafeInteger(row.created)) throw new Error('Invalid provider refund')
        return { id:row.id,amount_minor:row.amount,refunded_at:new Date(row.created*1000).toISOString() }
      })
      const result = await deps.refund({ p_event_id:event.id,p_account:event.account,p_checkout:context.id,p_payment_intent:intentId,
        p_livemode:context.livemode,p_currency:context.currency,p_refunds:verified })
      return reply(200, result)
    } catch {
      // Provider retries are safe: the transaction deduplicates event, session,
      // payment-intent and refund identifiers. No customer data is logged.
      return reply(503, { error:'Customer payment event was not confirmed. Retry delivery.' })
    }
  }
}
