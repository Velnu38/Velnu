import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { customerInvoiceCheckoutHandler, type CheckoutDependencies } from '../../supabase/functions/customer-invoice-checkout/handler.ts'
import { customerPaymentEventsHandler } from '../../supabase/functions/customer-payment-events/handler.ts'

const id='66666666-6666-4666-8666-666666666666',invoice='55555555-5555-4555-8555-555555555555',revision='77777777-7777-4777-8777-777777777777'
const context={state:'ready',business_id:'11111111-1111-4111-8111-111111111111',invoice_id:invoice,revision_id:revision,number:'INV-1',balance_minor:10000,currency:'usd',stripe_account_id:'acct_merchant',livemode:false}
const reservation={...context,id,amount_minor:10000,status:'reserved',stripe_payment_intent:'pi_paid'}
const metadata={finviant_checkout_id:id,finviant_invoice_id:invoice,finviant_revision_id:revision}
const session={id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/test',livemode:false,mode:'payment',amount_total:10000,currency:'usd',client_reference_id:id,metadata,
  expires_at:Math.floor(Date.now()/1000)+3600,status:'complete',payment_status:'paid',payment_intent:'pi_paid'}
const merchant={id:'acct_merchant',charges_enabled:true,payouts_enabled:true,details_submitted:true}
const intent={id:'pi_paid',metadata,amount_received:10000,currency:'usd',livemode:false,latest_charge:{payment_method_details:{type:'card'}}}
const secret='whsec_customer_invoice_test_secret'
const checkoutRequest=(body:unknown,origin='https://finviant.com')=>new Request('https://backend.invalid/customer-invoice-checkout',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const input={token:'ab'.repeat(32),request_id:id,mode:'checkout'}
function checkoutFixture(overrides:Partial<CheckoutDependencies>={}) {
  const calls:{stripe:any[];reserve:any[];attach:any[]}={stripe:[],reserve:[],attach:[]}
  const deps:CheckoutDependencies={configured:true,livemode:false,allowedOrigins:['https://finviant.com'],publicOrigin:'https://finviant.com',
    context:async()=>context,reserve:async(...args)=>{calls.reserve.push(args);return reservation},
    attach:async(...args)=>{calls.attach.push(args);return{accepted:true,state:'ready'}},
    stripe:async(...args)=>args[0].startsWith('/accounts/')?merchant:session,...overrides}
  const provider=deps.stripe
  deps.stripe=async(...args)=>{calls.stripe.push(args);return provider(...args)}
  return {handler:customerInvoiceCheckoutHandler(deps),calls}
}
function signed(type:string,object:unknown,change:Record<string,unknown>={}) {
  const event={id:'evt_fixture',type,account:'acct_merchant',livemode:false,created:Math.floor(Date.now()/1000),data:{object},...change}
  const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')
  return new Request('https://backend.invalid/customer-payment-events',{method:'POST',body:raw,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}})
}
function webhookFixture(options:{session?:any;intent?:any;context?:any;configured?:boolean;stripe?:any}={}) {
  const calls:{apply:any[];refund:any[];stripe:any[]}={apply:[],refund:[],stripe:[]}
  const handler=customerPaymentEventsHandler({configured:options.configured??true,secret,livemode:false,
    context:async()=>options.context===null?null:(options.context||reservation),
    apply:async args=>{calls.apply.push(args);return{state:args.p_status}},refund:async args=>{calls.refund.push(args);return{refunded_minor:2500}},
    stripe:async(...args)=>{
      calls.stripe.push(args)
      if(options.stripe)return options.stripe(...args)
      if(args[0].startsWith('/checkout/sessions/'))return options.session||session
      if(args[0].startsWith('/payment_intents/'))return options.intent||intent
      if(args[0].startsWith('/charges/'))return{id:'ch_paid',payment_intent:'pi_paid',livemode:false,currency:'usd',amount:10000}
      if(args[0].startsWith('/refunds?'))return{has_more:false,data:[{id:'re_first',status:'succeeded',charge:'ch_paid',currency:'usd',amount:2500,created:Math.floor(Date.now()/1000)}]}
      throw new Error('Unexpected provider request')
    },
  })
  return{handler,calls}
}

test('payment readiness is truthful and disabled setup performs no provider or checkout operation',async()=>{
  const{handler,calls}=checkoutFixture({configured:false})
  const response=await handler(checkoutRequest({...input,mode:'status'}))
  assert.equal(response.status,200);assert.deepEqual(calls.stripe,[]);assert.deepEqual(calls.reserve,[])
  const data=await response.json();assert.equal(data.available,false);assert.equal(data.state,'disabled')
})
test('client amounts, merchants, redirects, bad tokens and other origins are rejected',async()=>{
  for(const body of [{...input,amount:1},{...input,business_id:'other'},{...input,return_url:'https://evil.invalid'},{...input,token:'short'}]) {
    const{handler,calls}=checkoutFixture();assert.equal((await handler(checkoutRequest(body))).status,400);assert.equal(calls.stripe.length,0)
  }
  const{handler,calls}=checkoutFixture();assert.equal((await handler(checkoutRequest(input,'https://evil.invalid'))).status,403);assert.equal(calls.stripe.length,0)
})
test('checkout uses the reserved balance and merchant with stable idempotency and safe return URLs',async()=>{
  const{handler,calls}=checkoutFixture()
  const response=await handler(checkoutRequest(input));assert.equal(response.status,200)
  const provider=calls.stripe.find(args=>args[0]==='/checkout/sessions')
  assert.equal(provider[1],'acct_merchant');assert.equal(provider[2].get('line_items[0][price_data][unit_amount]'),'10000')
  assert.equal(provider[3],'finviant-invoice-'+id)
  assert.equal(provider[2].has('payment_method_types'),false);assert.equal(provider[2].has('automatic_tax[enabled]'),false)
  assert.equal(provider[2].has('payment_intent_data[application_fee_amount]'),false)
  const returned=new URL(provider[2].get('success_url'));assert.equal(returned.origin,'https://finviant.com');assert.equal(returned.searchParams.get('document_share'),input.token)
  assert.equal(calls.attach.length,1);assert.equal((await response.json()).checkout_url,session.url)
  assert.notEqual(calls.reserve[0][0],input.token,'only token hash reaches payment SQL')
})
test('unexpected provider amounts or checkout domains never reach the customer',async()=>{
  for(const invalid of [{...session,amount_total:9999},{...session,currency:'eur'},{...session,url:'https://checkout.stripe.com.evil.invalid/pay'},{...session,livemode:true}]) {
    const{handler,calls}=checkoutFixture({stripe:async path=>path.startsWith('/accounts/')?merchant:invalid})
    const response=await handler(checkoutRequest(input));assert.equal(response.status,503);assert.equal(calls.attach.length,0)
    assert.equal((await response.json()).checkout_url,undefined)
  }
})
test('a changed invoice closes its unexposed checkout instead of redirecting to stale pricing',async()=>{
  const{handler,calls}=checkoutFixture({attach:async()=>({accepted:false,state:'review_required'}),stripe:async path=>path.startsWith('/accounts/')?merchant:{...session,status:'open'}})
  const response=await handler(checkoutRequest(input));assert.equal(response.status,409)
  assert.ok(calls.stripe.some(args=>args[0]==='/checkout/sessions/cs_test_fixture/expire'))
})
test('webhook signatures and live/test account scope are verified before any payment update',async()=>{
  const{handler,calls}=webhookFixture()
  assert.equal((await handler(new Request('https://backend.invalid',{method:'POST',body:'{}'}))).status,401)
  assert.equal((await handler(signed('checkout.session.completed',{id:session.id},{livemode:true}))).status,400)
  assert.equal((await handler(signed('checkout.session.completed',{id:session.id},{account:'bad'}))).status,400)
  assert.equal(calls.apply.length,0);assert.equal(calls.stripe.length,0)
})
test('completed but unpaid delayed payments remain pending; verified settled funds alone become paid',async()=>{
  const pending=webhookFixture({session:{...session,payment_status:'unpaid'}})
  assert.equal((await pending.handler(signed('checkout.session.completed',{id:session.id}))).status,200)
  assert.equal(pending.calls.apply[0].p_status,'pending')
  const paid=webhookFixture({intent:{...intent,latest_charge:{payment_method_details:{type:'us_bank_account'}}}})
  assert.equal((await paid.handler(signed('checkout.session.async_payment_succeeded',{id:session.id}))).status,200)
  assert.equal(paid.calls.apply[0].p_status,'paid');assert.equal(paid.calls.apply[0].p_method,'ach')
  assert.ok(paid.calls.stripe.every(args=>args[1]==='acct_merchant'))
})
test('signed events with wrong invoice amount, currency, merchant mapping or received funds cannot mark paid',async()=>{
  for(const change of [{amount_total:1},{currency:'eur'},{metadata:{...metadata,finviant_invoice_id:'other'}},{client_reference_id:'other'},{livemode:true}]) {
    const{handler,calls}=webhookFixture({session:{...session,...change}})
    assert.equal((await handler(signed('checkout.session.completed',{id:session.id}))).status,409);assert.equal(calls.apply.length,0)
  }
  const funds=webhookFixture({intent:{...intent,amount_received:9999}})
  assert.equal((await funds.handler(signed('checkout.session.completed',{id:session.id}))).status,409);assert.equal(funds.calls.apply.length,0)
})
test('refund events retrieve provider records and cannot choose arbitrary refund amounts',async()=>{
  const{handler,calls}=webhookFixture()
  const response=await handler(signed('charge.refunded',{id:'ch_paid',amount_refunded:99999999}))
  assert.equal(response.status,200);assert.equal(calls.apply.length,0);assert.equal(calls.refund[0].p_refunds[0].amount_minor,2500)
  assert.equal(calls.refund[0].p_payment_intent,'pi_paid');assert.equal(calls.refund[0].p_account,'acct_merchant')
})
test('provider outages are retriable and never falsely confirm a payment',async()=>{
  const{handler,calls}=webhookFixture({stripe:async()=>{throw new Error('offline')}})
  assert.equal((await handler(signed('checkout.session.completed',{id:session.id}))).status,503);assert.equal(calls.apply.length,0)
})
