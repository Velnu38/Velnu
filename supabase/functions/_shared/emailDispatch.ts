import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { providerJson, ProviderRequestError } from './providerRequest.ts'
export type DispatchResult={status:number;body:Record<string,unknown>}
/** Claims one frozen operation. Every entry point shares the same leased dispatcher. */
export async function dispatchQueuedEmail(admin:SupabaseClient,resend:string,id:string,trace:string):Promise<DispatchResult>{
 const {data:claim,error:claimError}=await admin.rpc('claim_document_email',{p_request:id}).abortSignal(AbortSignal.timeout(5000))
 if(claimError||!claim)return {status:503,body:{error:'The saved send could not be claimed. Retry the same send, not a new message.'}}
 if(['accepted','delivered'].includes(claim.status))return {status:200,body:{status:claim.status,email_id:claim.provider_id,recipient:claim.recipient||'the saved customer address',already_sent:true,send_id:claim.id}}
 if(claim.status!=='claimed')return {status:409,body:{error:claim.status==='busy'?'This send is already processing or waiting for its retry interval.':'This send needs support review before another attempt.',code:claim.status,send_id:claim.id}}
 let sent:Record<string,unknown>
 try{
  sent=await providerJson('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resend,'Content-Type':'application/json','Idempotency-Key':'finviant-outbox-'+claim.id},body:JSON.stringify(claim.payload)},{timeoutMs:20000,maxBytes:65536})
  if(typeof sent.id!=='string'||!sent.id.trim()||sent.id.length>200)throw new Error('INVALID_RECEIPT')
 }catch(err){
  const definitive=err instanceof ProviderRequestError&&err.code==='http'&&[400,401,403,404,422].includes(err.status||0)
  const code=err instanceof ProviderRequestError?err.code:'invalid_receipt'
  await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:definitive?'failed':'uncertain',p_provider_id:null,p_code:code}).abortSignal(AbortSignal.timeout(5000))
  console.warn(JSON.stringify({service:'document-email',request_id:trace,code}))
  return {status:502,body:{error:'Delivery was not confirmed. The original request is saved; retry that same send after its waiting period. Do not start a new send.',code:'delivery_unconfirmed',send_id:claim.id}}
 }
 const {error:saveError}=await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:'accepted',p_provider_id:sent.id,p_code:null}).abortSignal(AbortSignal.timeout(5000))
 return {status:200,body:{status:'accepted',email_id:sent.id,recipient:claim.payload.to[0],send_id:claim.id,warning:saveError?'Provider accepted the email but local reconciliation is pending. Do not create a new send.':null}}
}
