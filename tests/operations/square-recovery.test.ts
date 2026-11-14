import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import test from 'node:test'
import {squareEventsHandler} from '../../supabase/functions/square-payment-events/handler.ts'
import {squarePaymentsHandler,type SquareDeps} from '../../supabase/functions/square-payments/handler.ts'
import {digest} from '../../supabase/functions/square-payments/core.ts'
import {operationsFixture,B,I,U,invoice,service,value,user} from './fixture.ts'

const app='sq0idp-fixture',merchant='MERCHANT',location='LOCATION',key='synthetic-square-signature'
const url='https://test.invalid/functions/v1/square-payment-events',state='ab'.repeat(32)
const requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
function signed(id='EVENT_ONE',type='payment.updated',eventMerchant=merchant){
 const raw=JSON.stringify({event_id:id,merchant_id:eventMerchant,type,data:{object:{payment:{id:'PAYMENT',note:'untrusted event note'},refund:{id:'REFUND'}}}})
 return new Request(url,{method:'POST',body:raw,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(url+raw).digest('base64')}})
}
async function fixture(){
 const db=await operationsFixture(true)
 try{
  await invoice(db)
  await db.exec(`reset role;update public.invoices set status='sent',sent_at=now() where id='${I}';`)
  await db.query("insert into private.square_connections(business_id,merchant_id,location_id,location_name,currency,environment,token_envelope,token_expires_at) values($1,$2,$3,'Fixture','USD','sandbox','{}',now()+interval '30 days')",[B,merchant,location])
  await service(db)
  const reserved=await value(db,'select public.square_service($1,$2) value',['reserve_pos',JSON.stringify({business_id:B,actor_id:U,invoice_id:I,request_id:requestId,state_hash:await digest(state)})])
  const op=reserved.operation
  const payment:any={id:'PAYMENT',order_id:'ORDER',location_id:location,amount_money:{amount:10000,currency:'USD'},total_money:{amount:10000,currency:'USD'},status:'COMPLETED',source_type:'CARD',created_at:new Date().toISOString(),refund_ids:[],processing_fee:[{amount_money:{amount:320,currency:'USD'}}],application_details:{application_id:app}}
  const order:any={id:'ORDER',location_id:location,total_money:{amount:10000,currency:'USD'},tenders:[{type:'CARD',payment_id:'PAYMENT',note:'Finviant payment '+op.id}]}
  const calls:{path:string;body:unknown}[]=[],refund:any={id:'REFUND',payment_id:'PAYMENT',location_id:location,amount_money:{amount:2500,currency:'USD'},status:'COMPLETED',created_at:new Date().toISOString()}
  const deps:SquareDeps={configured:true,allowNewPayments:false,environment:'sandbox',applicationId:app,origin:'https://finviant.com',origins:['https://finviant.com'],callback:'https://test.invalid/oauth',authenticate:async()=>U,
   rpc:async(action,p)=>action==='pos_event_context'
    ?value(db,'select public.square_pos_event_context($1,$2,$3,$4) value',[p.merchant_id,p.environment,p.location_id,p.operation_id])
    :value(db,'select public.square_service($1,$2) value',[action,JSON.stringify(p)]),
   square:async(business,path,body)=>{
    assert.equal(business,B);assert.equal(body,undefined,'settlement recovery may only read Square')
    calls.push({path,body})
    if(path==='/v2/payments/PAYMENT')return{payment}
    if(path==='/v2/orders/ORDER')return{order}
    if(path==='/v2/refunds/REFUND')return{refund}
    throw Error('Unexpected provider request')
   },oauth:async()=>{throw Error('No OAuth permitted')},saveTokens:async()=>{throw Error('No token write permitted')},
   apply:async p=>value(db,'select public.apply_square_payment($1) value',[JSON.stringify(p)])}
  return{db,op,payment,order,refund,calls,deps,handler:squareEventsHandler(deps,{key,url})}
 }catch(e){await db.close();throw e}
}

test('signed POS events recover a lost browser return once; delayed callbacks and refunds use the same real ledger',async()=>{
 const f=await fixture()
 try{
  assert.equal(f.op.order_id,null);assert.equal(f.payment.note,undefined)
  for(const eventId of ['EVENT_ONE','EVENT_ONE','EVENT_TWO']){
   const response=await f.handler(signed(eventId));assert.equal(response.status,200)
   assert.equal((await response.json()).state,'paid')
  }
  const callback=new Request('https://test.invalid/square-payments',{method:'POST',headers:{origin:'https://finviant.com'},body:JSON.stringify({mode:'return',business_id:B,operation_id:f.op.id,state,transaction_id:'ORDER'})})
  assert.equal((await squarePaymentsHandler(f.deps)(callback)).status,200)
  await f.db.exec('reset role')
  assert.equal(await value(f.db,'select count(*)::int value from public.payments'),1)
  assert.equal(await value(f.db,'select status value from public.invoices where id=$1',[I]),'paid')
  assert.equal(Number(await value(f.db,'select amount value from public.bookkeeping_entries where source_kind=\'square_processing\'')),3.2)
  f.payment.refund_ids=['REFUND'];f.payment.refunded_money={amount:2500,currency:'USD'}
  await service(f.db)
  for(const id of ['REFUND_EVENT','REFUND_EVENT','REFUND_AGAIN'])assert.equal((await f.handler(signed(id,'refund.updated'))).status,200)
  await f.db.exec('reset role')
  assert.equal(await value(f.db,'select count(*)::int value from private.square_payment_refunds'),1)
  assert.equal(Number(await value(f.db,'select amount_paid value from public.invoices where id=$1',[I])),75)
  await user(f.db,U)
  const rows=(await f.db.query('select * from public.list_invoice_cash_activity($1)',[B])).rows
  assert.equal(Number(rows.find((r:any)=>r.direction==='income').amount),100)
  assert.equal(Number(rows.find((r:any)=>r.direction==='expense').amount),25)
  assert.ok(f.calls.length>0);assert.ok(f.calls.every(call=>call.body===undefined))
 }finally{await f.db.close()}
})

test('POS recovery refuses wrong identities, notes, amounts, tenders and application without attaching or posting',async()=>{
 const f=await fixture()
 try{
  const originalPayment=structuredClone(f.payment),originalOrder=structuredClone(f.order)
  const cases=[
   {payment:{id:'OTHER'},status:503},
   {payment:{amount_money:{amount:9999,currency:'USD'}},status:503},
   {payment:{location_id:'OTHER'},status:200},
   {payment:{application_details:{application_id:'other'}},status:503},
   {payment:{note:'Finviant payment '+requestId},status:200},
   {order:{id:'OTHER'},status:503},
   {order:{location_id:'OTHER'},status:503},
   {order:{total_money:{amount:1,currency:'USD'}},status:503},
   {order:{tenders:[{...originalOrder.tenders[0],payment_id:'OTHER'}]},status:503},
   {order:{tenders:[{...originalOrder.tenders[0],type:'CASH'}]},status:503},
   {order:{tenders:[originalOrder.tenders[0],originalOrder.tenders[0]]},status:200},
   {order:{tenders:[{...originalOrder.tenders[0],note:'Finviant payment '+requestId}]},status:200},
   {order:{tenders:[{type:'CARD',payment_id:'PAYMENT'}]},status:200},
  ]
  for(const [index,patch] of cases.entries()){
   for(const object of [f.payment,f.order])for(const k of Object.keys(object))delete object[k]
   Object.assign(f.payment,structuredClone(originalPayment),patch.payment)
   Object.assign(f.order,structuredClone(originalOrder),patch.order)
   assert.equal((await f.handler(signed('BAD_'+index))).status,patch.status,'case '+index)
   await f.db.exec('reset role')
   assert.equal(await value(f.db,'select order_id value from private.square_invoice_operations where id=$1',[f.op.id]),null)
   assert.equal(await value(f.db,'select count(*)::int value from public.payments'),0)
   await service(f.db)
  }
  assert.equal((await f.handler(signed('WRONG_MERCHANT','payment.updated','OTHER'))).status,200)
  assert.equal((await f.handler(new Request(url,{method:'POST',body:'{}'}))).status,401)
 }finally{await f.db.close()}
})

test('POS event lookup is service-only and binds merchant, mode, location and operation without changing activation',async()=>{
 const f=await fixture()
 try{
  const lookup=(m=merchant,e='sandbox',l=location,id=f.op.id)=>value(f.db,'select public.square_pos_event_context($1,$2,$3,$4) value',[m,e,l,id])
  assert.equal((await lookup()).id,f.op.id)
  for(const args of [['OTHER','sandbox',location,f.op.id],[merchant,'production',location,f.op.id],[merchant,'sandbox','OTHER',f.op.id],[merchant,'sandbox',location,requestId]])assert.equal(await lookup(...args as [string,string,string,string]),null)
  await f.db.exec('reset role');await f.db.query('update private.square_connections set enabled=false where business_id=$1',[B]);await service(f.db)
  assert.equal((await lookup()).id,f.op.id,'pausing new payments must not lose already-taken funds')
  await user(f.db,U);await assert.rejects(()=>lookup(),/permission denied/)
  await f.db.exec('reset role;set role anon');await assert.rejects(()=>lookup(),/permission denied/)
  await f.db.exec('reset role')
  assert.equal(await value(f.db,'select enabled value from private.square_connections where business_id=$1',[B]),false)
  assert.equal(await value(f.db,'select count(*)::int value from public.payments'),0)
 }finally{await f.db.close()}
})
