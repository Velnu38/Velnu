import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { readLimitedRequest, verifySignedEvent } from '../_shared/signedEvents.ts'
const types=new Set(['email.sent','email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed'])
Deno.serve(async(req:Request)=>{
 const headers={'content-type':'application/json','cache-control':'no-store'}
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 const secret=Deno.env.get('RESEND_WEBHOOK_SECRET'),url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!secret||!url||!key)return reply(503,{error:'Webhook not configured'})
 try{
  const raw=await readLimitedRequest(req)
  if(!await verifySignedEvent('resend',raw,req.headers,secret))return reply(401,{error:'Invalid signature'})
  const event=JSON.parse(raw)
  if(!types.has(event.type))return reply(200,{ignored:true})
  const id=req.headers.get('svix-id')!,provider=event.data?.email_id,when=event.created_at
  if(typeof provider!=='string'||provider.length>200||typeof when!=='string'||!Number.isFinite(Date.parse(when)))return reply(400,{error:'Invalid event'})
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await db.rpc('record_delivery_event',{p_event_id:id,p_provider_id:provider,p_type:event.type,p_occurred:when})
  if(error)return reply(503,{error:'Receipt not stored; retry delivery'})
  return reply(200,data)
 }catch{return reply(400,{error:'Invalid event payload'})}
})
