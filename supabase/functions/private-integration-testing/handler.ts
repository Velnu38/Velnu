import { readLimitedRequest } from '../_shared/signedEvents.ts'
export type TestInput = { business_id:string; action:string; request_id?:string; plan?:string; invoice_id?:string; phone?:string; consent?:boolean }
export type TestOperation = { id:string; kind:string; status:string; input:Record<string,any>; fresh:boolean; created_at:string; result:Record<string,any>; provider_id?:string }
export interface IntegrationDependencies {
 staging:boolean; origin:string; origins:readonly string[];
 configuration:{stripe:boolean;stripe_webhook:boolean;connect_webhook:boolean;sms:boolean};
 authorize:(auth:string,business:string)=>Promise<null|{context:()=>Promise<any>; reserve:(id:string,kind:string,input:Record<string,unknown>)=>Promise<TestOperation>}>;
 stripe:(path:string,body?:URLSearchParams|Record<string,unknown>,idempotency?:string,account?:string)=>Promise<any>;
 finish:(op:TestOperation,status:string,provider:string|null,account:string|null,result:Record<string,unknown>)=>Promise<void>;
 smsAllowed:(phone:string)=>boolean;
 sms:(phone:string,request:string)=>Promise<{sid:string;status:string}>;
 portalConfiguration:string;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function providerUrl(value:unknown,host:string){
 if(typeof value!=='string')throw new Error('Provider did not return a usable link.')
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password)throw new Error('Provider link could not be verified.')
 return value
}
export function integrationTestHandler(d:IntegrationDependencies){return async(req:Request)=>{
 const origin=req.headers.get('origin');const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':origin&&d.origins.includes(origin)?origin:d.origin,'access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST, OPTIONS',vary:'Origin'}
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers})
 if(!d.staging)return reply(403,{error:'Internal integration tests are available only in the testing environment.'})
 if(origin&&!d.origins.includes(origin))return reply(403,{error:'App address not authorized.'})
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed.'})
 let op:TestOperation|undefined
 try{
  const i:TestInput=JSON.parse(await readLimitedRequest(req,4096))
  if(!i||!uuid.test(i.business_id)||!['status','subscription','connect','invoice','sms','portal'].includes(i.action))return reply(400,{error:'Invalid test request.'})
  const caller=await d.authorize(req.headers.get('authorization')||'',i.business_id)
  if(!caller)return reply(403,{error:'Sign in as the primary business owner to run tests.'})
  const context=await caller.context()
  if(i.action==='status'){
   let subscription=null
   if(d.configuration.stripe&&context.state?.stripe_subscription){
    const sub=await d.stripe('/v1/subscriptions/'+context.state.stripe_subscription)
    if(sub.livemode!==false||sub.customer!==context.state.stripe_customer)throw new Error('Subscription mismatch')
    subscription={status:sub.status,cancel_at_period_end:!!sub.cancel_at_period_end}
   }
   return reply(200,{mode:'internal_test',configuration:d.configuration,...context,subscription})
  }
  if(!i.request_id||!uuid.test(i.request_id))return reply(400,{error:'A stable test request ID is required.'})
  if(i.action==='sms'){
   if(context.sms_owner_verified!==true)return reply(409,{error:'Verify the primary owner mobile number in Text messaging setup before sending SMS.'})
   if(!d.configuration.sms)return reply(503,{error:'Twilio setup is incomplete. Add its credentials, sender and approved test numbers in server settings.'})
   if(!i.phone||!/^\+[1-9]\d{7,14}$/.test(i.phone)||!d.smsAllowed(i.phone)||i.consent!==true)return reply(400,{error:'Use an approved test phone number, including country code, and confirm permission to text it.'})
   op=await caller.reserve(i.request_id,'sms',{phone:i.phone,consent:true})
   // Twilio message creation has no general-purpose idempotency guarantee. Never blindly resend.
   if(!op.fresh)return reply(200,{status:op.status,already_requested:true,message:'This test was already requested. Refresh results; do not resend to resolve an uncertain outcome.'})
   const receipt=await d.sms(i.phone,op.id)
   if(!/^SM[0-9a-f]{32}$/i.test(receipt.sid))throw new Error('Invalid message receipt')
   await d.finish(op,'accepted',receipt.sid,null,{message:'Accepted by Twilio; delivery is pending.'})
   return reply(200,{status:'accepted',message:'Twilio accepted the test text. Refresh results to check delivery.'})
  }
  if(!d.configuration.stripe)return reply(503,{error:'Stripe test credentials are not configured in server settings.'})
  const account=await d.stripe('/v1/account')
  if(account.id!=='acct_1UEz2sRuE7Wioad5')return reply(503,{error:'Stripe test account does not match Finviant.'})
  const state=context.state||{}
  if(i.action==='connect'){
   // One account per business. Never create a second account to recover an unknown outcome.
   const input={purpose:'merchant_onboarding'}
   op=await caller.reserve(i.request_id,'connect',input)
   let id=state.stripe_account||op.provider_id
   if(!id){
    if(!op.fresh&&Date.now()-Date.parse(op.created_at)>23*3600000)throw new Error('Old account creation needs reconciliation')
    const a=await d.stripe('/v2/core/accounts',{display_name:'Finviant internal test business',dashboard:'full',identity:{country:'us'},configuration:{merchant:{capabilities:{card_payments:{requested:true}}}},defaults:{currency:'usd',responsibilities:{fees_collector:'stripe',losses_collector:'stripe'}},metadata:{finviant_business_id:i.business_id,finviant_mode:'internal_test'},include:['configuration.merchant']},'finviant-test-account-'+op.id)
    if(!/^acct_[A-Za-z0-9]+$/.test(a.id)||a.livemode===true)throw new Error('Invalid merchant account')
    id=a.id;await d.finish(op,'accepted',id,null,{message:'Test merchant account created.'})
   }
   await d.finish(op,'accepted',id,null,{message:'Test merchant account is linked. Complete onboarding with test details.'})
   // Accounts v1 link API supports accounts created through Accounts v2.
   const link=await d.stripe('/v1/account_links',new URLSearchParams({account:id,type:'account_onboarding',return_url:d.origin+'/?view=settings&integration_test=returned',refresh_url:d.origin+'/?view=settings&integration_test=refresh'}),'finviant-test-onboard-'+op.id)
   return reply(200,{url:providerUrl(link.url,'connect.stripe.com'),message:'Use Stripe test business details only.'})
  }
  if(i.action==='portal'){
   if(!state.stripe_customer||!d.portalConfiguration)return reply(409,{error:'Complete a test subscription and confirm its webhook before opening the test billing portal.'})
   op=await caller.reserve(i.request_id,'portal',{})
   const portal=await d.stripe('/v1/billing_portal/sessions',new URLSearchParams({customer:state.stripe_customer,configuration:d.portalConfiguration,return_url:d.origin+'/?view=settings&integration_test=returned'}),'finviant-test-portal-'+op.id)
   await d.finish(op,'accepted',portal.id,null,{message:'Test billing portal opened.'})
   return reply(200,{url:providerUrl(portal.url,'billing.stripe.com')})
  }
  if(!d.configuration.stripe_webhook||(i.action==='invoice'&&!d.configuration.connect_webhook))return reply(503,{error:'Configure the signed Stripe test webhooks before starting payment tests.'})
  if(i.action==='subscription'&&!['basic','pro'].includes(i.plan||''))return reply(400,{error:'Choose Basic or Pro.'})
  if(i.action==='invoice'&&(!i.invoice_id||!uuid.test(i.invoice_id)))return reply(400,{error:'Choose an issued invoice.'})
  if(i.action==='subscription'&&state.stripe_subscription){
   const sub=await d.stripe('/v1/subscriptions/'+state.stripe_subscription)
   if(sub.livemode!==false||sub.customer!==state.stripe_customer)throw new Error('Subscription mismatch')
   if(!['canceled','incomplete_expired'].includes(sub.status))return reply(409,{error:'A test subscription already exists. Manage or cancel it through the test billing portal first.'})
  }
  if(i.action==='invoice'&&!state.stripe_account)return reply(409,{error:'Set up the test merchant account first.'})
  op=await caller.reserve(i.request_id,i.action,i.action==='invoice'?{invoice_id:i.invoice_id}:{plan:i.plan})
  if(!op.fresh&&Date.now()-Date.parse(op.created_at)>23*3600000)return reply(409,{error:'This old request needs reconciliation before another checkout can be created.'})
  if(op.status==='paid')return reply(200,{status:'paid',message:'This test payment is already confirmed. No new checkout was created.'})
  if(op.result.url)return reply(200,{url:providerUrl(op.result.url,'checkout.stripe.com'),status:op.status})
  const body=new URLSearchParams({mode:i.action==='subscription'?'subscription':'payment',success_url:d.origin+'/?view=settings&integration_test=returned',cancel_url:d.origin+'/?view=settings&integration_test=canceled','metadata[finviant_request_id]':op.id,'metadata[finviant_business_id]':i.business_id,'metadata[finviant_mode]':'internal_test','client_reference_id':i.business_id,'line_items[0][quantity]':'1','payment_method_types[0]':'card'})
  let merchant:string|undefined
  if(i.action==='subscription'){
   const prices=await d.stripe('/v1/prices?active=true&lookup_keys%5B%5D=finviant_test_'+i.plan+'_monthly')
   const price=prices.data?.[0]
   if(!price||price.livemode!==false||price.currency!=='usd'||price.unit_amount!==(i.plan==='basic'?999:2499)||price.recurring?.interval!=='month')throw new Error('Test price mismatch')
   body.set('line_items[0][price]',price.id);body.set('subscription_data[metadata][finviant_business_id]',i.business_id);body.set('subscription_data[billing_mode][type]','flexible')
  }else{
   const cents=Number(op.input.amount_cents)
   if(!Number.isSafeInteger(cents)||cents<50||cents>99999999||op.input.currency!=='usd')return reply(400,{error:'Invoice testing supports USD balances from $0.50 to $999,999.99.'})
   merchant=state.stripe_account
   const a=await d.stripe('/v1/accounts/'+merchant)
   if(a.charges_enabled!==true)return reply(409,{error:'Finish the test merchant onboarding before taking a test invoice payment.'})
   body.set('line_items[0][price_data][currency]','usd');body.set('line_items[0][price_data][unit_amount]',String(cents));body.set('line_items[0][price_data][product_data][name]','TEST invoice '+op.input.invoice_number)
  }
  const session=await d.stripe('/v1/checkout/sessions',body,'finviant-test-checkout-'+op.id,merchant)
  if(session.livemode!==false||!session.id?.startsWith('cs_test_'))throw new Error('Not a test checkout')
  const url=providerUrl(session.url,'checkout.stripe.com')
  await d.finish(op,'open',session.id,merchant||account.id,{url,amount_cents:session.amount_total,message:'Awaiting test payment and signed webhook.'})
  return reply(200,{url,status:'open'})
 }catch{
  if(op){try{await d.finish(op,'uncertain',op.provider_id||null,null,{message:'Outcome not confirmed. Keep this request ID and check provider activity before trying another test.'})}catch{/* Existing record remains reserved; do not invent success. */}}
  return reply(503,{error:'The test outcome could not be confirmed. Your request is retained. Refresh test results before retrying; do not create another request for an uncertain send.'})
 }
}}
