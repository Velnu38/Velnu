import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {verifyTwilioSignature} from '../twilio-test-events/handler.ts'
import {readLimitedRequest} from '../_shared/signedEvents.ts'
const env=(key:string)=>Deno.env.get(key)||'',base=env('SUPABASE_URL')+'/functions/v1/managed-sms-events'
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(async(req:Request)=>{
 const reply=(status:number)=>new Response(status===200?'<?xml version="1.0" encoding="UTF-8"?><Response></Response>':'Request rejected',{status,headers:{'content-type':'text/xml','cache-control':'no-store'}})
 if(req.method!=='POST')return reply(405)
 try{
  const query=new URL(req.url).searchParams,id=query.get('request_id');if(query.size>(id?1:0)||id&&!/^[0-9a-f-]{36}$/i.test(id))return reply(400)
  const params=new URLSearchParams(await readLimitedRequest(req,16384)),canonical=base+(id?'?request_id='+id:'')
  if(!await verifyTwilioSignature(canonical,params,req.headers.get('x-twilio-signature')||'',env('TWILIO_AUTH_TOKEN'))||params.get('AccountSid')!==env('TWILIO_ACCOUNT_SID'))return reply(401)
  let result
  if(id){const state=params.get('MessageStatus');if(!['queued','sending','sent','delivered','failed','undelivered'].includes(state||''))return reply(400);result=await db.rpc('finish_managed_sms',{p_request:id,p_status:state==='delivered'?'delivered':['failed','undelivered'].includes(state!)?'failed':'accepted',p_provider:params.get('MessageSid')})}
  else result=await db.rpc('record_managed_sms_inbound',{p_from:params.get('From'),p_to:params.get('To'),p_body:params.get('Body')||'',p_sid:params.get('MessageSid')})
  return reply(result.error?503:200)
 }catch{return reply(503)}
})
