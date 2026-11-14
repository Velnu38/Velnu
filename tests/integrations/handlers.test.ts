import {test} from 'node:test'
import assert from 'node:assert/strict'
import {integrationTestHandler,type IntegrationDependencies,providerUrl} from '../../supabase/functions/private-integration-testing/handler.ts'
import {stripeTestEventHandler} from '../../supabase/functions/stripe-test-events/handler.ts'
import {verifyTwilioSignature,twilioTestEventHandler} from '../../supabase/functions/twilio-test-events/handler.ts'
const B='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',I='33333333-3333-4333-8333-333333333333',origin='https://finviant.com'
const request=(action:string,extra:Record<string,unknown>={})=>new Request(origin,{method:'POST',headers:{origin,authorization:'Bearer token'},body:JSON.stringify({business_id:B,request_id:R,action,...extra})})
function setup(){
 const calls:any[]=[],finishes:any[]=[],ctx={sms_owner_verified:true,state:{} as any,operations:[],invoices:[]};let fresh=true
 const d:IntegrationDependencies={staging:true,origin,origins:[origin],configuration:{stripe:true,stripe_webhook:true,connect_webhook:true,sms:true},portalConfiguration:'bpc_test',
 authorize:async()=>({context:async()=>ctx,reserve:async(id,kind,input)=>({id,kind,input:{...input,amount_cents:1250,invoice_number:'INV-1',currency:'usd'},status:'reserved',fresh,created_at:new Date().toISOString(),result:{}})}),
 stripe:async(path,body,key,account)=>{calls.push({path,body,key,account});if(path==='/v1/account')return{id:'acct_1UEz2sRuE7Wioad5'};if(path.startsWith('/v1/prices'))return{data:[{id:'price_pro',livemode:false,currency:'usd',unit_amount:2499,recurring:{interval:'month'}}]};if(path.startsWith('/v1/accounts/'))return{charges_enabled:true};if(path==='/v1/checkout/sessions')return{id:'cs_test_123',livemode:false,url:'https://checkout.stripe.com/c/pay/test',amount_total:1250};throw new Error('Unexpected call '+path)},
 finish:async(...args)=>{finishes.push(args)},smsAllowed:p=>p==='+17575550123',sms:async()=>({sid:'SM'+'a'.repeat(32),status:'queued'})}
 return {d,calls,finishes,ctx,setFresh:(v:boolean)=>{fresh=v}}
}
test('internal integration endpoints reject production, foreign origins, unauthenticated callers and malformed input',async()=>{
 const {d,calls}=setup();d.staging=false;assert.equal((await integrationTestHandler(d)(request('status'))).status,403);d.staging=true
 const evil=request('status');evil.headers.set('origin','https://evil.test');assert.equal((await integrationTestHandler(d)(evil)).status,403)
 d.authorize=async()=>null;assert.equal((await integrationTestHandler(d)(request('status'))).status,403);assert.equal(calls.length,0)
 assert.equal((await integrationTestHandler(d)(request('charge_live'))).status,400)
})
test('subscription uses server price and stable retry key, ignores browser prices, and never grants plans',async()=>{
 const {d,calls,finishes}=setup();const res=await integrationTestHandler(d)(request('subscription',{plan:'pro',amount:1,livemode:true,price_id:'price_evil'}));assert.equal(res.status,200)
 const checkout=calls.find(c=>c.path==='/v1/checkout/sessions');assert.equal(checkout.body.get('line_items[0][price]'),'price_pro');assert.equal(checkout.body.get('mode'),'subscription');assert.equal(checkout.key,'finviant-test-checkout-'+R);assert.equal(checkout.account,undefined);assert.equal(finishes[0][1],'open');assert.match(checkout.body.get('success_url'),/\?view=settings&integration_test=returned/)
})
test('invoice payment derives amount from reserved invoice and charges the bound merchant',async()=>{
 const {d,calls,ctx}=setup();ctx.state.stripe_account='acct_merchant';assert.equal((await integrationTestHandler(d)(request('invoice',{invoice_id:I,amount_cents:1,stripe_account:'acct_attacker'}))).status,200)
 const checkout=calls.find(c=>c.path==='/v1/checkout/sessions');assert.equal(checkout.account,'acct_merchant');assert.equal(checkout.body.get('line_items[0][price_data][unit_amount]'),'1250');assert.equal(checkout.body.get('mode'),'payment')
})
test('missing credentials, unconfigured webhooks and incomplete merchant onboarding cannot create checkout',async()=>{
 const {d,calls,ctx}=setup();d.configuration.stripe=false;assert.equal((await integrationTestHandler(d)(request('subscription',{plan:'pro'}))).status,503);d.configuration.stripe=true;d.configuration.stripe_webhook=false;assert.equal((await integrationTestHandler(d)(request('subscription',{plan:'pro'}))).status,503)
 d.configuration.stripe_webhook=true;ctx.state.stripe_account='acct_merchant';const base=d.stripe;d.stripe=async(...args)=>args[0].startsWith('/v1/accounts/')?{charges_enabled:false}:base(...args)
 assert.equal((await integrationTestHandler(d)(request('invoice',{invoice_id:I}))).status,409);assert.equal(calls.some(c=>c.path==='/v1/checkout/sessions'),false)
})
test('Twilio requires approved recipient and consent; a retry after an uncertain response never sends again',async()=>{
 const {d,setFresh}=setup();let sends=0;d.sms=async()=>{sends++;throw new Error('lost response')}
 assert.equal((await integrationTestHandler(d)(request('sms',{phone:'+17575550124',consent:true}))).status,400)
 assert.equal((await integrationTestHandler(d)(request('sms',{phone:'+17575550123',consent:false}))).status,400)
 assert.equal((await integrationTestHandler(d)(request('sms',{phone:'+17575550123',consent:true}))).status,503);setFresh(false)
 assert.equal((await integrationTestHandler(d)(request('sms',{phone:'+17575550123',consent:true}))).status,200);assert.equal(sends,1)
})
test('provider redirect hosts reject lookalikes, credentials and unsafe protocols',()=>{
 for(const url of ['javascript:alert(1)','https://checkout.stripe.com.evil.test/a','http://checkout.stripe.com/a','https://user@checkout.stripe.com/a'])assert.throws(()=>providerUrl(url,'checkout.stripe.com'))
})
async function sign(hash:string,text:string,secret:string,encoding:'hex'|'base64'){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))).toString(encoding)
}
test('Stripe webhook validates signature/mode, retrieves canonical status and records only the mapped operation',async()=>{
 const secret='whsec_'+'s'.repeat(30),calls:any[]=[];let paid=false
 const d={staging:true,platform:'acct_1UEz2sRuE7Wioad5',secrets:[secret],retrieve:async()=>({id:'cs_test_123',livemode:false,metadata:{finviant_request_id:R,finviant_mode:'internal_test'},payment_status:paid?'paid':'unpaid',status:'complete',amount_total:1250,currency:'usd',customer:'cus_test',subscription:'sub_test'}),record:async(args:any)=>{calls.push(args);return true}}
 const event={id:'evt_test',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test_123',payment_status:'paid'}}};const raw=JSON.stringify(event),stamp=String(Math.floor(Date.now()/1000)),sig=await sign('SHA-256',stamp+'.'+raw,secret,'hex')
 const req=()=>new Request(origin,{method:'POST',headers:{'stripe-signature':'t='+stamp+',v1='+sig},body:raw})
 assert.equal((await stripeTestEventHandler(d)(req())).status,200);assert.equal(calls.length,0);paid=true
 assert.equal((await stripeTestEventHandler(d)(req())).status,200);assert.equal(calls[0].p_status,'paid');assert.equal(calls[0].p_account,'acct_1UEz2sRuE7Wioad5')
 const bad=req();bad.headers.set('stripe-signature','t='+stamp+',v1='+'0'.repeat(64));assert.equal((await stripeTestEventHandler(d)(bad)).status,401)
})
test('Twilio callbacks verify the exact configured URL, account and signature; delivery is separate from acceptance',async()=>{
 const token='twilio-test-token',account='AC'+'a'.repeat(32),sid='SM'+'b'.repeat(32),url='https://example.supabase.co/functions/v1/twilio-test-events?request_id='+R
 const params=new URLSearchParams({AccountSid:account,MessageSid:sid,MessageStatus:'delivered'}),text=url+[...params.keys()].sort().map(k=>k+params.get(k)).join(''),sig=await sign('SHA-1',text,token,'base64')
 assert.equal(await verifyTwilioSignature(url,params,sig,token),true);assert.equal(await verifyTwilioSignature(url+'x',params,sig,token),false)
 const calls:any[]=[];const handler=twilioTestEventHandler({staging:true,url:url.split('?')[0],account,token,record:async(a)=>{calls.push(a);return true}})
 const response=await handler(new Request(url,{method:'POST',headers:{'x-twilio-signature':sig},body:params.toString()}));assert.equal(response.status,200);assert.equal(calls[0].p_status,'delivered')
 params.append('MessageSid',sid);assert.equal(await verifyTwilioSignature(url,params,sig,token),false)
})

test('SMS provider calls are blocked without a verified owner even when the client claims verification',async()=>{
 const {d,ctx}=setup();ctx.sms_owner_verified=false;let sends=0;d.sms=async()=>{sends++;return{sid:'SM'+'a'.repeat(32),status:'queued'}}
 const r=await integrationTestHandler(d)(request('sms',{phone:'+17575550123',consent:true,owner_mobile_verified:true}));assert.equal(r.status,409);assert.match((await r.json()).error,/Verify the primary owner mobile/);assert.equal(sends,0)
})
