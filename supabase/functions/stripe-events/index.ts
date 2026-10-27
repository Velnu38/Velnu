// Staging-only ingestion. This endpoint never grants plans, creates charges or marks invoices paid.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { readLimitedRequest,verifySignedEvent } from '../_shared/signedEvents.ts'
const types=new Set(['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','charge.refunded','refund.updated'])
Deno.serve(async(req:Request)=>{
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 const secret=Deno.env.get('STRIPE_WEBHOOK_SECRET'),account=Deno.env.get('STRIPE_SANDBOX_ACCOUNT_ID'),url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!secret||!account||!url||!key)return reply(503,{error:'Sandbox webhook not configured'})
 try{
  const raw=await readLimitedRequest(req)
  if(!await verifySignedEvent('stripe',raw,req.headers,secret))return reply(401,{error:'Invalid signature'})
  const event=JSON.parse(raw)
  if(event.livemode!==false||(event.account&&event.account!==account))return reply(400,{error:'Wrong account or mode'})
  if(!types.has(event.type))return reply(200,{ignored:true})
  if(typeof event.id!=='string'||typeof event.data?.object?.id!=='string'||!Number.isSafeInteger(event.created))return reply(400,{error:'Invalid event'})
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await db.rpc('record_sandbox_payment_event',{p_event_id:event.id,p_account_id:account,p_object_id:event.data.object.id,p_type:event.type,p_created:new Date(event.created*1000).toISOString()})
  if(error)return reply(503,{error:'Event not stored; retry delivery'})
  return reply(200,data)
 }catch{return reply(400,{error:'Invalid event payload'})}
})
