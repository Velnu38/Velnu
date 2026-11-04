import {useRef,useState} from 'react'
import DocumentDeliveryOptions,{validDeliveryEmail} from './DocumentDeliveryOptions'
import {customerActionsEnabled} from '../lib/releaseFlags'
import {sendReviewedDocument,clearReviewedSend,type DeliveryDocumentKind,type ReviewDeliveryReceipt} from '../services/reviewDelivery'
import {useUnsavedChanges} from '../lib/unsavedChanges'

/** The review is the confirmation: recipient is visible beside the send action. */
export default function DocumentDelivery({businessId,kind,documentId,email,phone,disabled=false,onEditContact,onSent,onBusyChange}:{
 businessId:string;kind:DeliveryDocumentKind;documentId:string;email?:string|null;phone?:string|null;disabled?:boolean;onEditContact:()=>void;onSent:()=>Promise<unknown>|void;onBusyChange?:(busy:boolean)=>void
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<ReviewDeliveryReceipt|null>(null),[refreshWarning,setRefreshWarning]=useState('')
 const inFlight=useRef(false)
 useUnsavedChanges(busy)
 async function send(){
  if(inFlight.current||disabled||receipt||!customerActionsEnabled||!validDeliveryEmail(email||''))return
  inFlight.current=true;setBusy(true);onBusyChange?.(true);setError('')
  try{
   const result=await sendReviewedDocument(businessId,kind,documentId,email!.trim())
   setReceipt(result)
   try{await onSent()}catch{setRefreshWarning('The document could not refresh. Do not resend to refresh it.')}
  }catch(err){setError(err instanceof Error?err.message:'Delivery could not be confirmed. Retry this same send.')}
  finally{inFlight.current=false;setBusy(false);onBusyChange?.(false)}
 }
 return <div data-saving={busy?'true':undefined}>
  <DocumentDeliveryOptions kind={kind} email={email} phone={phone} disabled={disabled} contactDisabled={disabled||busy} emailDisabled={!!receipt} sending={busy} emailLabel={receipt?'Email '+(receipt.status==='delivered'?'delivered':'accepted'):error?'Retry email':'Send email'} onEmail={()=>void send()} onEditContact={onEditContact}/>
  {error&&<p role="alert" className="form-message error-text">{error}</p>}
  {receipt&&<div><p role="status" className="form-message success-text">Email {receipt.status==='delivered'?'delivered':'accepted for delivery'} to {receipt.recipient}.{receipt.warning&&' '+receipt.warning} {refreshWarning}</p><button type="button" className="text-button" onClick={()=>{if(!window.confirm('Send another email to this customer? The previous email was already accepted.'))return;clearReviewedSend(businessId,kind,documentId);setReceipt(null);setRefreshWarning('')}}>Prepare another email</button></div>}
 </div>
}
