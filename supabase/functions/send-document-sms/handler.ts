import { readLimitedRequest } from '../_shared/signedEvents.ts'
import { burstLimitResponse } from '../_shared/burstLimit.ts'
export type SmsDependencies={enabled:boolean;authorize:(auth:string)=>Promise<string|null>;prepare:(actor:string,input:Record<string,string>)=>Promise<any>;claim:(id:string)=>Promise<any>;send:(claim:any)=>Promise<{sid:string}>;finish:(id:string,status:string,provider:string|null)=>Promise<void>}
export function documentSmsHandler(d:SmsDependencies){return async(req:Request)=>{
 const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'POST,OPTIONS'}
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers})
 if(req.method==='OPTIONS')return reply(200,{})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return reply(401,{error:'Sign in before sending.'})
 try{
  const actor=await d.authorize(auth);if(!actor)return reply(401,{error:'Sign in again.'})
  if(!d.enabled)return reply(503,{error:'Finviant SMS is awaiting verified provider activation. No text was sent.'})
  const raw=await readLimitedRequest(req,4096)
  let input;try{input=JSON.parse(raw)}catch{return reply(400,{error:'Invalid request.'})}
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if(!input||!['business_id','document_id','request_id'].every(k=>typeof input[k]==='string'&&uuid.test(input[k]))||!['invoice','estimate','change_order'].includes(input.kind)||!/^[a-f0-9]{64}$/.test(input.token)||!/^\+1\d{10}$/.test(input.recipient))return reply(400,{error:'Review a saved document and US mobile recipient.'})
  const queued=await d.prepare(actor,input),claim=await d.claim(queued.id)
  if(['accepted','delivered'].includes(claim.status))return reply(200,{status:claim.status,recipient:claim.recipient,message_id:claim.provider_id})
  if(claim.status!=='claimed')return reply(409,{error:'This text is pending or needs review. It will not be sent again automatically.',status:claim.status})
  let result
  try{result=await d.send(claim);if(!/^SM[0-9a-f]{32}$/i.test(result.sid))throw Error('Invalid provider receipt')}
  catch{await d.finish(claim.id,'uncertain',null).catch(()=>{});return reply(502,{error:'The text outcome is uncertain. Check its activity; do not create a new send.',status:'uncertain'})}
  try{await d.finish(claim.id,'accepted',result.sid)}catch{return reply(200,{status:'accepted',recipient:claim.recipient,message_id:result.sid,warning:'The provider accepted the text. Local reconciliation is pending; do not resend.'})}
  return reply(200,{status:'accepted',recipient:claim.recipient,message_id:result.sid})
 }catch(e){const limited=burstLimitResponse(e,headers);if(limited)return limited
 if(e instanceof Error&&e.message==='REQUEST_TOO_LARGE')return reply(413,{error:'Request too large.'})
 if(e instanceof Error&&e.message==='REQUEST_TIMEOUT')return reply(408,{error:'Request timed out. No new send was started.'})
 const code=(e as any)?.code;return reply(code==='42501'?403:code==='P0001'?429:409,{error:code?(e as any).message:'Unable to prepare this text. Review permissions, quota and recipient details.'})}
}}
