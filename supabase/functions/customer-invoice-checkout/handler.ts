import { readLimitedRequest } from '../_shared/signedEvents.ts'

type Context = {
  state: string; business_id: string; invoice_id: string; revision_id: string;
  number: string; balance_minor: number; currency: string; stripe_account_id: string; livemode: boolean;
}
export type CheckoutReservation = Context & {
  id: string; amount_minor: number; status: string; stripe_session_id?: string; stripe_payment_intent?: string; checkout_url?: string;
}
export type StripeRequest = (path: string, account?: string, body?: URLSearchParams, idempotencyKey?: string) => Promise<Record<string, any>>
export type CheckoutDependencies = {
  configured: boolean; livemode: boolean; allowedOrigins: readonly string[]; publicOrigin: string;
  context: (tokenHash: string) => Promise<Context>;
  reserve: (tokenHash: string, requestId: string) => Promise<CheckoutReservation>;
  attach: (id: string, session: string, url: string, expiresAt: string) => Promise<{ accepted: boolean; state: string }>;
  stripe: StripeRequest;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export async function paymentTokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}
export function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password && !url.port }
  catch { return false }
}
function readiness(state: string, context: Context) {
  const messages: Record<string, string> = {
    ready: 'Pay this invoice securely with the business’s connected payment provider.',
    pending: 'Your payment is processing. This invoice will update after confirmation.',
    review_required: 'A payment or refund needs review by the business. Do not submit another payment until they confirm its status.',
    not_connected: 'Online invoice payments are not connected yet. Use the payment options shown or contact the business.',
    disabled: 'Online invoice payments are not activated. Use the payment options shown or contact the business.',
    not_payable: 'This invoice is not available for another online payment. Check its current balance and status.',
    unavailable: 'The payment provider is temporarily unavailable. No payment has been confirmed.',
  }
  return { available: state === 'ready', provider: 'stripe', state, message: messages[state] || messages.unavailable,
    balance_minor: context.balance_minor, currency: context.currency }
}

export function customerInvoiceCheckoutHandler(deps: CheckoutDependencies) {
  return async (request: Request) => {
    const origin = request.headers.get('origin')
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin',
      'access-control-allow-origin': origin && deps.allowedOrigins.includes(origin) ? origin : deps.publicOrigin,
      'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info' }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !deps.allowedOrigins.includes(origin)) return reply(403, { error: 'Customer document address is not authorized.' })
    if (request.method === 'OPTIONS') return new Response('ok', { headers })
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
    let context: Context | undefined
    try {
      const body = JSON.parse(await readLimitedRequest(request, 2048))
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['token','request_id','mode'].includes(key)) ||
        typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token) || !['status','checkout'].includes(body.mode) ||
        (body.mode === 'checkout' && (typeof body.request_id !== 'string' || !uuid.test(body.request_id)))) return reply(400, { error: 'Invalid invoice payment request.' })
      const tokenHash = await paymentTokenHash(body.token)
      try { context = await deps.context(tokenHash) }
      catch { return reply(404, { error: 'Invoice link is unavailable.' }) }
      if (!deps.configured) return reply(200, readiness('disabled', context))
      if (context.state !== 'ready') return reply(200, readiness(context.state, context))
      if (context.livemode !== deps.livemode) return reply(200, readiness('disabled', context))
      if (!/^acct_[A-Za-z0-9]+$/.test(context.stripe_account_id)) return reply(200, readiness('not_connected', context))
      const merchant = await deps.stripe('/accounts/' + context.stripe_account_id)
      if (merchant.id !== context.stripe_account_id || merchant.charges_enabled !== true || merchant.payouts_enabled !== true || merchant.details_submitted !== true) return reply(200, readiness('not_connected', context))
      if (body.mode === 'status') return reply(200, readiness('ready', context))
      let reservation: CheckoutReservation
      try { reservation = await deps.reserve(tokenHash, body.request_id) }
      catch { return reply(409, { error: 'The invoice or an earlier payment changed. Reload its status before trying again.' }) }
      if (!uuid.test(reservation.id) || !uuid.test(reservation.invoice_id) || reservation.stripe_account_id !== context.stripe_account_id || reservation.livemode !== deps.livemode ||
        reservation.currency !== 'usd' || !Number.isSafeInteger(reservation.amount_minor) || reservation.amount_minor < 50 || reservation.amount_minor > 99999999) return reply(503, { error: 'Online payment configuration needs review.' })
      if (reservation.status === 'pending') return reply(200, readiness('pending', context))
      if (reservation.stripe_session_id && validCheckoutUrl(reservation.checkout_url)) return reply(200, {
        ...readiness('ready', context), checkout_url: reservation.checkout_url, session_id: reservation.stripe_session_id,
      })
      const returned = new URL('/', deps.publicOrigin)
      returned.searchParams.set('document_share', body.token)
      returned.searchParams.set('payment', 'return')
      const cancelled = new URL(returned); cancelled.searchParams.set('payment', 'cancel')
      // Amount, recipient merchant, and return address are determined server-side.
      // There is no application fee or Finviant subscription charge in this lane.
      const params = new URLSearchParams({ mode: 'payment',
        'line_items[0][price_data][currency]': reservation.currency,
        'line_items[0][price_data][unit_amount]': String(reservation.amount_minor),
        'line_items[0][price_data][product_data][name]': 'Invoice ' + String(reservation.number || '').slice(0, 100),
        'line_items[0][quantity]': '1', client_reference_id: reservation.id,
        'metadata[finviant_checkout_id]': reservation.id,
        'metadata[finviant_invoice_id]': reservation.invoice_id,
        'metadata[finviant_revision_id]': reservation.revision_id,
        'payment_intent_data[metadata][finviant_checkout_id]': reservation.id,
        success_url: returned.href, cancel_url: cancelled.href,
        integration_identifier: 'finviant-invoice-' + reservation.id.replace(/[^a-f]/g, '').padEnd(8, 'a').slice(0, 8),
      })
      const session = await deps.stripe('/checkout/sessions', reservation.stripe_account_id, params, 'finviant-invoice-' + reservation.id)
      if (!/^cs_[A-Za-z0-9_]+$/.test(String(session.id)) || !validCheckoutUrl(session.url) || session.livemode !== reservation.livemode || session.mode !== 'payment' ||
        session.amount_total !== reservation.amount_minor || session.currency !== reservation.currency || session.client_reference_id !== reservation.id ||
        session.metadata?.finviant_checkout_id !== reservation.id || !Number.isSafeInteger(session.expires_at)) throw new Error('Provider verification failed')
      const attached = await deps.attach(reservation.id, session.id, session.url, new Date(session.expires_at * 1000).toISOString())
      if (!attached.accepted) {
        if (session.status === 'open') await deps.stripe('/checkout/sessions/' + session.id + '/expire', reservation.stripe_account_id, new URLSearchParams(), 'finviant-close-' + reservation.id).catch(() => {})
        return reply(409, { error: 'The invoice changed before the payment page was ready. Reload its current status.' })
      }
      return reply(200, { ...readiness('ready', context), checkout_url: session.url, session_id: session.id })
    } catch {
      return reply(503, context ? readiness('unavailable', context) : { error: 'Unable to check invoice payments. No payment has been confirmed.' })
    }
  }
}
