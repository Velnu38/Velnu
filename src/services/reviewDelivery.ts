import {supabase} from '../lib/supabase'
export type DeliveryDocumentKind='invoice'|'estimate'|'change_order'
export type ReviewDeliveryReceipt={recipient:string;status:'accepted'|'delivered';warning?:string}
export type DocumentDeliveryContext={customer_id:string;status:string;customer:{email?:string|null;phone?:string|null}|null}
const pending=new Map<string,string>()
/** Rotate only when the server proved the original operation never contacted the provider. */
export const betaEmailWasNotAttempted=(detail:{code?:unknown;beta_send_not_started?:unknown}|null|undefined)=>detail?.beta_send_not_started===true&&(detail.code==='beta_recipient_not_approved'||detail.code==='beta_configuration_unavailable')
const sendKey=(business:string,kind:DeliveryDocumentKind,id:string)=>`finviant-reviewed-email:${business}:${kind}:${id}`
export function clearReviewedSend(business:string,kind:DeliveryDocumentKind,id:string){const key=sendKey(business,kind,id);pending.delete(key);try{sessionStorage.removeItem(key)}catch{/* Optional storage. */}}
export async function getDocumentDeliveryContext(business:string,kind:DeliveryDocumentKind,id:string):Promise<DocumentDeliveryContext>{
 const table=kind==='invoice'?'invoices':kind==='estimate'?'estimates':'change_orders'
 const {data,error}=await supabase.from(table).select(`customer_id,status,customers!${table}_customer_id_fkey(email,phone)`).eq('business_id',business).eq('id',id).single()
 if(error)throw error
 return {...data,customer:Array.isArray(data.customers)?data.customers[0]||null:data.customers}
}
/** A caller owns one request ID for the whole send, including uncertain retries. */
export async function sendReviewedDocument(businessId:string,kind:DeliveryDocumentKind,documentId:string,recipient:string,requestId?:string,expectedRevisionId?:string):Promise<ReviewDeliveryReceipt>{
 const key=sendKey(businessId,kind,documentId)
 let saved=pending.get(key)
 try{saved=saved||sessionStorage.getItem(key)||undefined}catch{/* In-memory protection still applies. */}
 requestId=saved||requestId||crypto.randomUUID();pending.set(key,requestId)
 try{sessionStorage.setItem(key,requestId)}catch{/* Only an opaque request ID, never recipient or document content. */}
 const {data,error}=await supabase.functions.invoke(kind==='invoice'?'send-invoice-email':'send-document-email',{body:{business_id:businessId,...(kind==='invoice'?{invoice_id:documentId}:{document_type:kind,document_id:documentId}),expected_recipient:recipient,request_id:requestId,...(expectedRevisionId?{expected_revision_id:expectedRevisionId}:{})}})
 if(error){
  const response=(error as {context?:unknown}).context
  const detail=response instanceof Response?await response.clone().json().catch(()=>null):null
  if(betaEmailWasNotAttempted(detail)){
   const next=crypto.randomUUID();pending.set(key,next)
   try{sessionStorage.setItem(key,next)}catch{/* The next attempt also works with in-memory protection. */}
  }
  throw new Error(detail?.error||'Email outcome is not confirmed. Retry this same send; do not create another document.')
 }
 if(!data?.email_id||!['accepted','delivered'].includes(data.status)||typeof data.recipient!=='string'||data.recipient.toLowerCase()!==recipient.trim().toLowerCase())throw new Error('Email outcome is not confirmed. Retry this same send; do not create another document.')
 return data
}
