import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { providerJson } from '../_shared/providerRequest.ts'
import { customerPaymentEventsHandler } from './handler.ts'

const project = Deno.env.get('SUPABASE_URL') || ''
const environment = resolveAppEnvironment(project)
const secret = Deno.env.get('STRIPE_CUSTOMER_PAYMENTS_RESTRICTED_KEY') || ''
const webhook = Deno.env.get('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET') || ''
const live = Deno.env.get('FINVIANT_CUSTOMER_PAYMENTS_LIVE') === 'true'
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
// Turning off new checkouts must not drop settlement/refund notifications for
// payments that were already started.
const configured = !!environment && !!serviceKey &&
  (!live || environment.name === 'production') && (live ? /^rk_live_/.test(secret) : /^rk_test_/.test(secret)) && webhook.startsWith('whsec_')
const db = environment && serviceKey ? createClient(project, serviceKey, { auth:{persistSession:false,autoRefreshToken:false} }) : null
async function rpc(name: string, params: Record<string,unknown>) {
  if (!db) throw new Error('Payment database not configured')
  const result=await db.rpc(name,params)
  if(result.error) throw new Error('Payment transaction unavailable')
  return result.data
}
// JWT verification must be disabled; Stripe's raw-body signature authorizes
// ingestion. This is not the subscription-billing webhook.
Deno.serve(customerPaymentEventsHandler({ configured,secret:webhook,livemode:live,
  context:(checkout,account)=>rpc('get_customer_checkout_event_context',{p_checkout:checkout,p_account:account}),
  apply:params=>rpc('apply_customer_payment_event',params),refund:params=>rpc('apply_customer_payment_refund',params),
  stripe:async(path,account)=>{
    if(!configured) throw new Error('Payment provider not configured')
    return await providerJson('https://api.stripe.com/v1'+path,{headers:{Authorization:'Bearer '+secret,'Stripe-Version':'2026-10-28.endive',...(account?{'Stripe-Account':account}:{})}},{timeoutMs:20000,maxBytes:262144})
  },
}))
