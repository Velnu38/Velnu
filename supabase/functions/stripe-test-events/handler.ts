import { readLimitedRequest,verifySignedEvent } from '../_shared/signedEvents.ts'
export interface StripeTestEventDependencies {
 staging:boolean;platform:string;secrets:readonly string[];
 retrieve:(session:string,account?:string)=>Promise<any>;
 record:(args:Record<string,unknown>)=>Promise<boolean>;
}
export function stripeTestEventHandler(d:StripeTestEventDependencies){return async(req:Request)=>{
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(!d.staging)return reply(403,{error:'Testing environment required'})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 if(!d.secrets.length)return reply(503,{error:'Test webhook not configured'})
 try{
  const raw=await readLimitedRequest(req)
  let verified=false;for(const secret of d.secrets)if(await verifySignedEvent('stripe',raw,req.headers,secret)){verified=true;break}
  if(!verified)return reply(401,{error:'Invalid signature'})
  const event=JSON.parse(raw)
  if(event.livemode!==false||!/^evt_[A-Za-z0-9]+$/.test(event.id||''))return reply(400,{error:'Test event required'})
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))return reply(200,{ignored:true})
  const object=event.data?.object
  if(!object?.id?.startsWith('cs_test_'))return reply(400,{error:'Test checkout required'})
  const account=event.account||d.platform
  if(!/^acct_[A-Za-z0-9]+$/.test(account))return reply(400,{error:'Invalid account'})
  // Retrieve canonical provider state: late/out-of-order deliveries cannot mark unpaid sessions paid.
  const s=await d.retrieve(object.id,event.account)
  const id=s.metadata?.finviant_request_id
  if(s.id!==object.id||s.livemode!==false||s.metadata?.finviant_mode!=='internal_test'||!id)return reply(200,{ignored:true})
  const status=s.payment_status==='paid'?'paid':s.status==='expired'?'expired':event.type==='checkout.session.async_payment_failed'?'failed':null
  if(!status)return reply(200,{pending:true})
  const recorded=await d.record({p_provider:'stripe',p_event:event.id,p_request:id,p_object:s.id,p_account:account,p_status:status,p_result:{payment_status:s.payment_status,amount_cents:s.amount_total,currency:s.currency,customer:typeof s.customer==='string'?s.customer:null,subscription:typeof s.subscription==='string'?s.subscription:null,message:status==='paid'?'Stripe test payment confirmed. Business balances and paid access are unchanged.':'Test checkout '+status}})
  // A callback can beat the session-persistence response. Ask Stripe to redeliver.
  return recorded?reply(200,{recorded:true}):reply(503,{error:'Test operation not yet reconciled; retry delivery'})
 }catch{return reply(503,{error:'Test event not reconciled; retry delivery'})}
}}
