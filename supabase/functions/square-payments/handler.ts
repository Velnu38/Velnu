import {readLimitedRequest} from '../_shared/signedEvents.ts'
import {digest,secret,uuid,hex64,squareId,pointOfSaleUrl,validSquareCheckout,verifiedSquarePayment} from './core.ts'
export type SquareDeps={configured:boolean;allowNewPayments?:boolean;environment:'production'|'sandbox';applicationId:string;origin:string;origins:readonly string[];callback:string;
 authenticate:(request:Request)=>Promise<string>;rpc:(action:string,p:Record<string,unknown>)=>Promise<any>;
 square:(business:string,path:string,body?:Record<string,unknown>)=>Promise<Record<string,any>>;
 oauth:(body:Record<string,unknown>)=>Promise<Record<string,any>>;saveTokens:(identity:Record<string,any>,tokens:Record<string,any>)=>Promise<void>;
 apply:(p:Record<string,unknown>)=>Promise<any>}
const messages:Record<string,string>={not_connected:'Square is not connected for invoice payments.',disabled:'Square payments are not activated.',pending:'A payment has already started. Verify its status before requesting or recording another payment.',review_required:'A Square payment needs reconciliation. Check Square before accepting another payment.',not_payable:'This invoice is not available for another payment.',ready:'Payment is verified with Square before the invoice balance updates.'}
export const readiness=(state:string,extra:Record<string,unknown>={})=>({state,available:state==='ready',provider:'square',message:messages[state]||'Square is temporarily unavailable. No payment has been confirmed.',...extra})
export async function reconcileSquarePayment(deps:SquareDeps,operation:Record<string,any>,paymentId:string,eventId:string){
 const response=await deps.square(operation.business_id,'/v2/payments/'+encodeURIComponent(paymentId)),payment=verifiedSquarePayment(response.payment||{},operation,deps.applicationId)
 const refundIds=payment.refund_ids||[];if(!Array.isArray(refundIds)||refundIds.length>100||refundIds.some(id=>!squareId.test(String(id))))throw Error('Refund ledger needs review')
 const refunds:Record<string,unknown>[]=[]
 for(let offset=0;offset<refundIds.length;offset+=5){const batch=await Promise.all(refundIds.slice(offset,offset+5).map(id=>deps.square(operation.business_id,'/v2/refunds/'+encodeURIComponent(id))));for(const response of batch){const r=response.refund;if(!r||r.payment_id!==payment.id||(r.location_id&&r.location_id!==operation.location_id)||r.amount_money?.currency!=='USD'||!refundIds.includes(r.id)||!Number.isSafeInteger(r.amount_money.amount)||r.amount_money.amount<=0)throw Error('Refund verification failed');if(r.status==='COMPLETED')refunds.push({id:r.id,amount_minor:r.amount_money.amount,refunded_at:r.created_at})}}
 if(refunds.reduce((sum,r)=>sum+Number(r.amount_minor),0)!==Number(payment.refunded_money?.amount||0))throw Error('Refund snapshot changed; retry verification')
 const fees=payment.processing_fee
 const feeMinor=Array.isArray(fees)&&fees.every((f:any)=>f.amount_money?.currency==='USD'&&Number.isSafeInteger(f.amount_money?.amount))?fees.reduce((s:number,f:any)=>s+f.amount_money.amount,0):null
 return deps.apply({operation_id:operation.id,merchant_id:operation.merchant_id,location_id:operation.location_id,environment:operation.environment,order_id:operation.order_id,payment_id:payment.id,amount_minor:payment.amount_money.amount,currency:'USD',status:payment.status,created_at:payment.created_at,event_id:eventId,refunds,processing_fee_minor:feeMinor})
}
export function squarePaymentsHandler(deps:SquareDeps){return async(request:Request)=>{
 const origin=request.headers.get('origin'),headers={'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer','vary':'Origin','access-control-allow-origin':origin&&deps.origins.includes(origin)?origin:deps.origin,'access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS,GET'}
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers})
 if(origin&&!deps.origins.includes(origin))return reply(403,{error:'Payment origin is not authorized.'})
 if(request.method==='OPTIONS')return new Response('ok',{headers})
 if(request.method==='GET'){
  const url=new URL(request.url);if(url.searchParams.get('health')==='1')return reply(200,{configured:deps.configured,payments_enabled:deps.configured&&deps.allowNewPayments!==false,environment:deps.environment})
  if(url.searchParams.get('callback')!=='oauth')return reply(405,{error:'Method not allowed.'})
  const redirect=new URL('/?view=settings&section=documents',deps.origin)
  try{if(!deps.configured)throw Error('unconfigured');const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';if(!hex64.test(state)||!code||code.length>2000||url.searchParams.has('error'))throw Error('invalid');const identity=await deps.rpc('oauth_consume',{state_hash:await digest(state)});const tokens=await deps.oauth({grant_type:'authorization_code',code,redirect_uri:deps.callback});if(!tokens.access_token||!tokens.refresh_token||!tokens.merchant_id||!Number.isFinite(Date.parse(tokens.expires_at)))throw Error('invalid tokens');await deps.saveTokens(identity,tokens);redirect.searchParams.set('square','connected')}catch{redirect.searchParams.set('square','connection_failed')}
  return new Response(null,{status:303,headers:{...headers,location:redirect.href}})
 }
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'})
 try{
  const p=JSON.parse(await readLimitedRequest(request,4096));if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['mode','business_id','invoice_id','request_id','platform','state','operation_id','transaction_id','token'].includes(k)))return reply(400,{error:'Invalid payment request.'})
  const modes=['configuration','connect','pause','invoice_status','pos','return','cancel_pos','online_status','checkout'];if(!modes.includes(p.mode))return reply(400,{error:'Unknown payment request.'})
  const online=['online_status','checkout'].includes(p.mode)
  let actor='';if(online){if(!hex64.test(p.token||''))return reply(400,{error:'Invalid invoice link.'})}else{try{actor=await deps.authenticate(request)}catch{return reply(401,{error:'Sign in to Finviant to continue.'})}if(!uuid.test(p.business_id||''))return reply(400,{error:'Choose a business.'})}
  if(!deps.configured)return reply(200,readiness('disabled',{configured:false,setup_required:'Square application, OAuth, encrypted token storage and signed webhook configuration are required.'}))
  if(p.mode==='configuration')return reply(200,{configured:true,payments_enabled:deps.allowNewPayments!==false,environment:deps.environment})
  if(deps.allowNewPayments===false&&['invoice_status','online_status','pos','checkout'].includes(p.mode))return reply(200,readiness('disabled'))
  if(p.mode==='connect'){
   const state=secret();await deps.rpc('oauth_start',{business_id:p.business_id,actor_id:actor,state_hash:await digest(state)})
   const url=new URL('/oauth2/authorize',deps.environment==='production'?'https://connect.squareup.com':'https://connect.squareupsandbox.com');url.searchParams.set('client_id',deps.applicationId);url.searchParams.set('scope','MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ ORDERS_WRITE');url.searchParams.set('state',state);url.searchParams.set('session','false');url.searchParams.set('redirect_uri',deps.callback);return reply(200,{url:url.href})
  }
  if(p.mode==='pause'){await deps.rpc('pause',{business_id:p.business_id,actor_id:actor});return reply(200,{paused:true})}
  if(p.mode==='cancel_pos'){
   if(!uuid.test(p.operation_id||'')||!hex64.test(p.state||''))return reply(400,{error:'Payment reference is unavailable. Reconcile it in Square.'})
   return reply(200,await deps.rpc('cancel_pos',{business_id:p.business_id,actor_id:actor,operation_id:p.operation_id,state_hash:await digest(p.state)}))
  }
  if(p.mode==='return'){
   if(!uuid.test(p.operation_id||'')||!hex64.test(p.state||'')||!squareId.test(p.transaction_id||''))return reply(400,{error:'Payment return is incomplete. Verify the transaction in Square before retrying.'})
   const operation=await deps.rpc('pos_context',{business_id:p.business_id,actor_id:actor,operation_id:p.operation_id,state_hash:await digest(p.state)})
   const response=await deps.square(p.business_id,'/v2/orders/'+encodeURIComponent(p.transaction_id)),order=response.order
   if(!order||order.id!==p.transaction_id||order.location_id!==operation.location_id||order.total_money?.currency!=='USD'||order.total_money.amount!==operation.amount_minor||!Array.isArray(order.tenders)||order.tenders.length!==1||order.tenders[0].type!=='CARD')throw Error('Transaction verification failed')
   const paymentId=order.tenders[0].payment_id||order.tenders[0].id;if(!squareId.test(paymentId||''))throw Error('Payment reference missing')
   // Fetch and verify the payment before attaching an untrusted callback order.
   verifiedSquarePayment((await deps.square(p.business_id,'/v2/payments/'+encodeURIComponent(paymentId))).payment||{},{...operation,order_id:order.id},deps.applicationId)
   await deps.rpc('attach',{operation_id:operation.id,order_id:order.id});operation.order_id=order.id
   const result=await reconcileSquarePayment(deps,operation,paymentId,'return:'+paymentId+':'+secret().slice(0,16));return reply(200,{...result,invoice_id:operation.invoice_id})
  }
  if(!online&&!uuid.test(p.invoice_id||''))return reply(400,{error:'Choose an invoice.'})
  if(['pos','checkout'].includes(p.mode)&&!uuid.test(p.request_id||''))return reply(400,{error:'A saved payment request is required.'})
  if(p.mode==='pos'&&(deps.environment!=='production'||!['ios','android'].includes(p.platform)||!hex64.test(p.state||'')))return reply(400,{error:'Tap to Pay requires a live Square account and a supported phone with Square Point of Sale installed.'})
  const action=p.mode==='invoice_status'?'invoice_status':p.mode==='pos'?'reserve_pos':p.mode==='checkout'?'reserve_online':'online_context'
  const context=await deps.rpc(action,{...(online?{token_hash:await digest(p.token)}:{business_id:p.business_id,invoice_id:p.invoice_id,actor_id:actor}),request_id:p.request_id,state_hash:p.mode==='pos'?await digest(p.state):undefined})
  const op=context.operation
  if(context.state!=='ready'&&!(context.state==='pending'&&op&&op.request_id===p.request_id))return reply(200,readiness(context.state,online?{}:{pending_operation_id:context.pending_operation_id,pending_kind:context.pending_kind}))
  if(context.environment&&context.environment!==deps.environment||op&&op.environment!==deps.environment)return reply(200,readiness('disabled'))
  if(p.mode==='pos'&&op.state_hash!==await digest(p.state))return reply(409,{error:'This payment was started in another session. Verify its original status.'})
  if(p.mode==='pos')return reply(200,readiness('ready',{operation_id:op.id,url:pointOfSaleUrl({platform:p.platform,amount:op.amount_minor,applicationId:deps.applicationId,locationId:op.location_id,state:p.state,origin:deps.origin,operationId:op.id})}))
  if(p.mode!=='checkout')return reply(200,readiness('ready'))
  if(op.checkout_url&&validSquareCheckout(op.checkout_url,deps.environment))return reply(200,readiness('ready',{checkout_url:op.checkout_url}))
  const returned=new URL('/',deps.origin);returned.searchParams.set('document_share',p.token);returned.searchParams.set('payment','return')
  const created=await deps.square(op.business_id,'/v2/online-checkout/payment-links',{idempotency_key:op.id,order:{location_id:op.location_id,reference_id:op.id,line_items:[{name:'Invoice '+String(context.number||op.invoice_id).slice(0,100),quantity:'1',base_price_money:{amount:op.amount_minor,currency:'USD'}}]},checkout_options:{allow_tipping:false,redirect_url:returned.href,ask_for_shipping_address:false},payment_note:'Finviant payment '+op.id})
  const link=created.payment_link;if(!link||!squareId.test(link.id||'')||!squareId.test(link.order_id||'')||!validSquareCheckout(link.url,deps.environment))throw Error('Invalid checkout response')
  await deps.rpc('attach',{operation_id:op.id,order_id:link.order_id,link_id:link.id,checkout_url:link.url})
  return reply(200,readiness('ready',{checkout_url:link.url}))
 }catch{return reply(503,{error:'Square could not verify this request. No new payment has been confirmed. Check Square before retrying a payment.'})}
}}
