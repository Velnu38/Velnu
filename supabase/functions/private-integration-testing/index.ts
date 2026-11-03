import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { providerJson } from '../_shared/providerRequest.ts'
import { integrationTestHandler } from './handler.ts'
const get=(key:string)=>Deno.env.get(key)||''
const project=get('SUPABASE_URL'), environment=resolveAppEnvironment(project)
const secret=get('STRIPE_TEST_SECRET_KEY')
const stripeReady=/^(sk|rk)_test_/.test(secret)
const twilioAccount=get('TWILIO_ACCOUNT_SID'),twilioToken=get('TWILIO_AUTH_TOKEN'),twilioSender=get('TWILIO_FROM_NUMBER')
const phones=get('FINVIANT_TEST_SMS_RECIPIENTS').split(',').map(x=>x.trim()).filter(x=>/^\+[1-9]\d{7,14}$/.test(x))
const allowedBusinesses=(get('FINVIANT_INTEGRATION_TEST_BUSINESSES')||'7dbb21ae-90a1-4918-98d2-c2e95aa89d05').split(',').map(x=>x.trim()).filter(Boolean)
const smsReady=!!(/^AC[0-9a-f]{32}$/i.test(twilioAccount)&&twilioToken&&/^\+[1-9]\d{7,14}$/.test(twilioSender)&&phones.length)
const admin=createClient(project||'https://invalid.supabase.co',get('SUPABASE_SERVICE_ROLE_KEY')||'not-configured',{auth:{persistSession:false,autoRefreshToken:false}})
async function serviceRpc(name:string,args:Record<string,unknown>){const {data,error}=await admin.rpc(name,args).abortSignal(AbortSignal.timeout(8000));if(error)throw error;return data}
Deno.serve(integrationTestHandler({
 staging:environment?.name==='staging',origin:environment?.baseUrl||'https://finviant.com',origins:environment?.origins||[],
 configuration:{stripe:stripeReady,stripe_webhook:!!get('STRIPE_TEST_WEBHOOK_SECRET'),connect_webhook:!!get('STRIPE_TEST_CONNECT_WEBHOOK_SECRET'),sms:smsReady},
 portalConfiguration:get('STRIPE_TEST_PORTAL_CONFIGURATION')||'bpc_1UXnf7RuE7Wioad5FEQwTkkg',
 async authorize(authorization,business){
  if(!authorization.startsWith('Bearer ')||!allowedBusinesses.includes(business))return null
  const db=createClient(project,get('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await db.auth.getUser();if(error||!data.user)return null
  const ctx=await db.rpc('get_integration_test_context',{p_business:business});if(ctx.error)return null
  return {context:async()=>ctx.data,reserve:async(id,kind,input)=>{const result=await db.rpc('reserve_integration_test',{p_business:business,p_request:id,p_kind:kind,p_input:input});if(result.error)throw result.error;return result.data}}
 },
 async stripe(path,body,key,account){
  if(!stripeReady)throw new Error('Test credentials required')
  const json=body&&!(body instanceof URLSearchParams)
  return await providerJson('https://api.stripe.com'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,'Stripe-Version':path.startsWith('/v2/')?'2026-10-28.preview':'2026-10-28.endive',...(account?{'Stripe-Account':account}:{}),...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded','Idempotency-Key':key!}:{})},body:body?(json?JSON.stringify(body):body.toString()):undefined},{timeoutMs:15000,maxBytes:262144})
 },
 finish:async(op,status,provider,account,result)=>{await serviceRpc('finish_integration_test',{p_request:op.id,p_status:status,p_provider:provider,p_account:account,p_result:result})},
 smsAllowed:phone=>phones.includes(phone),
 async sms(phone,request){
  const body=new URLSearchParams({To:phone,From:twilioSender,Body:'Finviant internal test: SMS delivery is working. No payment is requested.',StatusCallback:project+'/functions/v1/twilio-test-events?request_id='+request})
  return await providerJson('https://api.twilio.com/2010-04-01/Accounts/'+twilioAccount+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+btoa(twilioAccount+':'+twilioToken),'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()},{timeoutMs:15000,maxBytes:65536}) as {sid:string;status:string}
 },
}))
