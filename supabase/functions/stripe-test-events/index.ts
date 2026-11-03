import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { providerJson } from '../_shared/providerRequest.ts'
import { stripeTestEventHandler } from './handler.ts'
const get=(key:string)=>Deno.env.get(key)||'',project=get('SUPABASE_URL'),secret=get('STRIPE_TEST_SECRET_KEY')
const db=createClient(project||'https://invalid.supabase.co',get('SUPABASE_SERVICE_ROLE_KEY')||'not-configured',{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(stripeTestEventHandler({staging:resolveAppEnvironment(project)?.name==='staging',platform:'acct_1UEz2sRuE7Wioad5',secrets:[get('STRIPE_TEST_WEBHOOK_SECRET'),get('STRIPE_TEST_CONNECT_WEBHOOK_SECRET')].filter(Boolean),
 async retrieve(session,account){if(!/^(sk|rk)_test_/.test(secret))throw new Error('Test key required');return await providerJson('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(session),{headers:{Authorization:'Bearer '+secret,'Stripe-Version':'2026-10-28.endive',...(account?{'Stripe-Account':account}:{})}},{timeoutMs:15000,maxBytes:262144})},
 async record(args){const {data,error}=await db.rpc('record_integration_test_event',args).abortSignal(AbortSignal.timeout(8000));if(error)throw error;return data===true},
}))
