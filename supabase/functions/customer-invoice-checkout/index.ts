import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { providerJson } from '../_shared/providerRequest.ts'
import { customerInvoiceCheckoutHandler, type StripeRequest } from './handler.ts'

const project = Deno.env.get('SUPABASE_URL') || ''
const environment = resolveAppEnvironment(project)
const secret = Deno.env.get('STRIPE_CUSTOMER_PAYMENTS_RESTRICTED_KEY') || ''
const webhook = Deno.env.get('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET') || ''
const live = Deno.env.get('FINVIANT_CUSTOMER_PAYMENTS_LIVE') === 'true'
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const configured = !!environment && !!serviceKey && Deno.env.get('FINVIANT_CUSTOMER_PAYMENTS_ENABLED') === 'true' &&
  (!live || environment.name === 'production') && (live ? /^rk_live_/.test(secret) : /^rk_test_/.test(secret)) && webhook.startsWith('whsec_')
const db = environment && serviceKey ? createClient(project, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
async function rpc(name: string, params: Record<string, unknown>) {
  if (!db) throw new Error('Payment database not configured')
  const result = await db.rpc(name, params)
  if (result.error) throw new Error('Invoice payment data unavailable')
  return result.data
}
const stripe: StripeRequest = async (path, account, body, idempotencyKey) => {
  if (!configured) throw new Error('Online invoice payments are not activated')
  return await providerJson('https://api.stripe.com/v1' + path, { method: body ? 'POST' : 'GET', body,
    headers: { Authorization: 'Bearer ' + secret, 'Stripe-Version': '2026-10-28.endive',
      ...(account ? { 'Stripe-Account': account } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
  }, { timeoutMs: 20000, maxBytes: 262144 })
}
// Deploy without JWT verification: possession of the scoped document token is
// checked in the database. A Finviant owner session is never required here.
Deno.serve(environment ? customerInvoiceCheckoutHandler({ configured, livemode: live,
  publicOrigin: environment.baseUrl, allowedOrigins: environment.origins,
  context: tokenHash => rpc('get_customer_payment_context', { p_token_hash: tokenHash }),
  reserve: (tokenHash, requestId) => rpc('reserve_customer_checkout', { p_token_hash: tokenHash, p_request_id: requestId }),
  attach: (id, session, url, expiresAt) => rpc('attach_customer_checkout', { p_checkout: id, p_session: session, p_url: url, p_expires_at: expiresAt }),
  stripe,
}) : () => new Response(JSON.stringify({ error: 'Customer payments are not configured.' }), { status: 503, headers: { 'content-type': 'application/json' } }))
