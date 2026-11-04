import {supabase} from '../lib/supabase'
import type {VoiceKind} from '../lib/voiceDocument'
export type ReviewDeliveryReceipt={recipient:string;status:'accepted'|'delivered';warning?:string}
/** A caller owns one request ID for the whole send, including uncertain retries. */
export async function sendReviewedDocument(businessId:string,kind:VoiceKind,documentId:string,recipient:string,requestId:string):Promise<ReviewDeliveryReceipt>{
 const {data,error}=await supabase.functions.invoke(kind==='invoice'?'send-invoice-email':'send-document-email',{body:{business_id:businessId,...(kind==='invoice'?{invoice_id:documentId}:{document_type:kind,document_id:documentId}),expected_recipient:recipient,request_id:requestId}})
 if(error){
  const response=(error as {context?:unknown}).context
  const detail=response instanceof Response?await response.clone().json().catch(()=>null):null
  throw new Error(detail?.error||'Email outcome is not confirmed. Retry this same send; do not create another document.')
 }
 if(!data?.email_id||!['accepted','delivered'].includes(data.status)||typeof data.recipient!=='string')throw new Error('Email outcome is not confirmed. Retry this same send; do not create another document.')
 return data
}
