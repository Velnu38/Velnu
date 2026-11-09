import {readLimitedRequest} from '../_shared/signedEvents.ts'
import {validSquareSignature,squareId} from '../square-payments/core.ts'
import {reconcileSquarePayment,type SquareDeps} from '../square-payments/handler.ts'
export function squareEventsHandler(deps:SquareDeps,webhook:{key:string;url:string}){return async(req:Request)=>{
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 if(!deps.configured)return reply(503,{error:'Square event verification is not configured'})
 try{
  const raw=await readLimitedRequest(req);if(!await validSquareSignature(raw,req.headers.get('x-square-hmacsha256-signature')||'',webhook.key,webhook.url))return reply(401,{error:'Invalid signature'})
  const event=JSON.parse(raw);if(!squareId.test(event.merchant_id||'')||typeof event.event_id!=='string'||event.event_id.length>192)return reply(400,{error:'Invalid event'})
  if(!['payment.created','payment.updated','refund.created','refund.updated'].includes(event.type))return reply(200,{ignored:true})
  const merchant=await deps.rpc('connection',{merchant_id:event.merchant_id,environment:deps.environment});if(!merchant)return reply(200,{ignored:true})
  let paymentId=event.data?.object?.payment?.id
  if(event.type.startsWith('refund.')){const refundId=event.data?.object?.refund?.id;if(!squareId.test(refundId||''))return reply(400,{error:'Invalid refund'});paymentId=(await deps.square(merchant.business_id,'/v2/refunds/'+encodeURIComponent(refundId))).refund?.payment_id}
  if(!squareId.test(paymentId||''))return reply(400,{error:'Invalid payment'})
  const payment=(await deps.square(merchant.business_id,'/v2/payments/'+encodeURIComponent(paymentId))).payment
  if(!payment||payment.location_id!==merchant.location_id)return reply(200,{ignored:true})
  const operation=await deps.rpc('operation',{merchant_id:event.merchant_id,environment:deps.environment,payment_id:paymentId,order_id:payment.order_id})
  // POS events can arrive before the browser callback has bound the order.
  // The callback retrieves the authoritative payment and reconciles it then.
  if(!operation)return reply(200,{unmatched:true})
  const result=await reconcileSquarePayment(deps,operation,paymentId,event.event_id);return reply(200,{received:true,state:result.state})
 }catch{return reply(503,{error:'Square reconciliation will retry. No unverified payment was posted.'})}
}}
