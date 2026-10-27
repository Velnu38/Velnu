import { supabase } from '../lib/supabase'
export type DocumentEmailType = 'estimate' | 'change_order'
export type SendDocumentEmailResult = {email_id:string|null;recipient:string;status:'accepted'|'delivered';send_id?:string;warning?:string|null}
const pending=new Map<string,string>()
export async function sendDocumentEmail(businessId:string,documentType:DocumentEmailType,documentId:string) {
 const key='finviant-email-'+businessId+'-'+documentType+'-'+documentId
 let requestId=pending.get(key)
 try { requestId=requestId||sessionStorage.getItem(key)||undefined } catch { /* In-memory retry ID remains available. */ }
 requestId=requestId||crypto.randomUUID();pending.set(key,requestId)
 try {sessionStorage.setItem(key,requestId)}catch{/* No secrets or content are stored. */}
 const {data,error}=await supabase.functions.invoke('send-document-email',{body:{business_id:businessId,document_type:documentType,document_id:documentId,request_id:requestId}})
 if(error){
  const context=(error as {context?:unknown}).context
  if(context instanceof Response){const body=await context.clone().json().catch(()=>null);if(body?.error)throw new Error(body.error)}
  throw new Error('The email outcome is not confirmed. Retry the same send, not a new request.')
 }
 if(!data||!['accepted','delivered'].includes(data.status))throw new Error('Delivery is still awaiting confirmation. Keep the same send request.')
 pending.delete(key);try{sessionStorage.removeItem(key)}catch{/* Optional storage. */}
 return data as SendDocumentEmailResult
}
