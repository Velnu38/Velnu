import { readLimitedRequest } from '../_shared/signedEvents.ts'
export async function verifyTwilioSignature(url:string,params:URLSearchParams,signature:string,token:string){
 try{
  if(!signature||!token)return false
  const keys=[...params.keys()];if(new Set(keys).size!==keys.length)return false
  const text=url+keys.sort().map(k=>k+params.get(k)).join('')
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['verify'])
  const sig=Uint8Array.from(atob(signature),c=>c.charCodeAt(0))
  return await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(text))
 }catch{return false}
}
export interface TwilioTestDependencies {staging:boolean;url:string;account:string;token:string;record:(args:Record<string,unknown>)=>Promise<boolean>}
export function twilioTestEventHandler(d:TwilioTestDependencies){return async(req:Request)=>{
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(!d.staging)return reply(403,{error:'Testing environment required'})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 if(!d.token)return reply(503,{error:'Twilio not configured'})
 try{
  const url=new URL(req.url),id=url.searchParams.get('request_id')
  if(!id||!/^[0-9a-f-]{36}$/i.test(id)||url.searchParams.size!==1)return reply(400,{error:'Invalid request'})
  const params=new URLSearchParams(await readLimitedRequest(req,16384))
  if(!await verifyTwilioSignature(d.url+'?request_id='+id,params,req.headers.get('x-twilio-signature')||'',d.token))return reply(401,{error:'Invalid signature'})
  const sid=params.get('MessageSid'),status=params.get('MessageStatus')
  if(params.get('AccountSid')!==d.account||!/^SM[0-9a-f]{32}$/i.test(sid||'')||!['accepted','queued','sending','sent','delivered','undelivered','failed'].includes(status||''))return reply(400,{error:'Invalid callback'})
  const ok=await d.record({p_provider:'twilio',p_event:sid+':'+status,p_request:id,p_object:sid,p_account:null,p_status:status,p_result:{message:'Twilio test text: '+status,error_code:params.get('ErrorCode')||null}})
  return ok?reply(200,{recorded:true}):reply(503,{error:'Test operation not reconciled'})
 }catch{return reply(503,{error:'Test callback not reconciled'})}
}}
