import { burstLimitResponse } from './burstLimit.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { providerJson, ProviderRequestError } from './providerRequest.ts'
import { emailDeliveryMode } from './emailRelease.ts'
import { prepareQueuedDocumentPdf } from './documentPdfArtifact.ts'
export type DispatchResult={status:number;body:Record<string,unknown>;headers?:Record<string,string>}
/** Claims one frozen operation. Every entry point shares the same leased dispatcher. */
export async function dispatchQueuedEmail(admin:SupabaseClient,resend:string,id:string,trace:string):Promise<DispatchResult>{
 const mode=emailDeliveryMode()
 if(mode==='disabled')return {status:503,body:{error:'Email delivery is not enabled. No email was sent.',code:'email_not_enabled'}}
 const {data:claim,error:claimError}=await admin.rpc('claim_document_email',{p_request:id,p_pdf_capable:true}).abortSignal(AbortSignal.timeout(5000))
 const limited=burstLimitResponse(claimError,{});if(limited)return {status:429,body:{...await limited.json(),send_id:id},headers:Object.fromEntries(limited.headers)}
 if(claimError||!claim)return {status:503,body:{error:'The saved send could not be claimed. Retry the same send, not a new message.'}}
 if(['accepted','delivered'].includes(claim.status))return {status:200,body:{status:claim.status,email_id:claim.provider_id,recipient:claim.recipient||'the saved customer address',already_sent:true,send_id:claim.id}}
 if(claim.status!=='claimed')return {status:409,body:{error:claim.status==='busy'?'This send is already processing or waiting for its retry interval.':'This send needs support review before another attempt.',code:claim.status,send_id:claim.id}}
 if(mode==='private_beta'){
  let allowed=false,unavailable=false
  try{
   const approval=await admin.rpc('private_beta_email_recipient_allowed',{p_request:claim.id}).abortSignal(AbortSignal.timeout(5000))
   unavailable=!!approval.error;allowed=!approval.error&&approval.data===true
  }catch{unavailable=true}
  if(!allowed){
   const code=unavailable?'beta_configuration_unavailable':'beta_recipient_not_approved'
   // Only the database can confirm that no earlier uncertain attempt could have sent this operation.
   let closed=false
   try{const stopped=await admin.rpc('stop_private_beta_email',{p_request:claim.id,p_lease:claim.lease,p_code:code}).abortSignal(AbortSignal.timeout(5000));closed=!stopped.error&&stopped.data===true}catch{/* Retain the original operation until its closure is confirmed. */}
   if(!closed)return {status:503,body:{error:'This saved send needs review because an earlier delivery or stopping the operation could not be confirmed. Keep this same send identifier and check its activity before trying again; do not start another send.',code:'beta_stop_unconfirmed',send_id:claim.id}}
   return {status:unavailable?503:403,body:{error:unavailable?'Private beta recipient approval is unavailable. No email was sent. After setup is restored, review the document and start a new send.':'Private beta email requires an approved test recipient. No email was sent. Review the recipient and start a new send after approval.',code,send_id:claim.id,beta_send_not_started:true}}
  }
 }
 let payload:Record<string,unknown>
 try{
  payload=await prepareQueuedDocumentPdf(admin,claim)
 }catch(error){
  // No provider call occurs until the exact saved PDF and payload are confirmed.
  // Retain the operation's idempotency key even when acknowledgement is lost.
  try{await admin.rpc('release_document_pdf_claim',{p_request:claim.id,p_lease:claim.lease}).abortSignal(AbortSignal.timeout(5000))}catch{/* Original lease/outcome must be reconciled. */}
  const limited=burstLimitResponse(error,{});if(limited)return {status:429,body:{...await limited.json(),send_id:claim.id},headers:Object.fromEntries(limited.headers)}
  return {status:503,body:{error:'The saved PDF could not be prepared. No email was sent by this attempt. Retry this same saved send after its waiting period.',code:'pdf_artifact_unavailable',send_id:claim.id}}
 }
 let sent:Record<string,unknown>
 try{
  sent=await providerJson('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resend,'Content-Type':'application/json','Idempotency-Key':'finviant-outbox-'+claim.id},body:JSON.stringify(payload)},{timeoutMs:20000,maxBytes:65536})
  if(typeof sent.id!=='string'||!sent.id.trim()||sent.id.length>200)throw new Error('INVALID_RECEIPT')
 }catch(err){
  const definitive=err instanceof ProviderRequestError&&err.code==='http'&&[400,401,403,404,422].includes(err.status||0)
  const code=err instanceof ProviderRequestError?err.code:'invalid_receipt'
  await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:definitive?'failed':'uncertain',p_provider_id:null,p_code:code}).abortSignal(AbortSignal.timeout(5000))
  console.warn(JSON.stringify({service:'document-email',request_id:trace,code}))
  return {status:502,body:{error:'Delivery was not confirmed. The original request is saved; retry that same send after its waiting period. Do not start a new send.',code:'delivery_unconfirmed',send_id:claim.id}}
 }
 const {error:saveError}=await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:'accepted',p_provider_id:sent.id,p_code:null}).abortSignal(AbortSignal.timeout(5000))
 return {status:200,body:{status:'accepted',email_id:sent.id,recipient:(payload.to as string[])[0],send_id:claim.id,warning:saveError?'Provider accepted the email but local reconciliation is pending. Do not create a new send.':null}}
}
