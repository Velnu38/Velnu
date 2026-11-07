import { readPendingPersonalSend, type PendingPersonalSend } from '../services/personalDelivery'
import ScheduledEmail from './ScheduledEmail'
import ManagedSmsDelivery from './ManagedSmsDelivery'
import PersonalDocumentDelivery from './PersonalDocumentDelivery'
import {useDeliverySetup} from '../lib/useDeliverySetup'
import {useEffect,useRef,useState} from 'react'
import DocumentDeliveryOptions,{validDeliveryEmail} from './DocumentDeliveryOptions'
import {emailDeliveryEnabled} from '../lib/releaseFlags'
import {sendReviewedDocument,clearReviewedSend,type DeliveryDocumentKind,type ReviewDeliveryReceipt} from '../services/reviewDelivery'
import {useUnsavedChanges} from '../lib/unsavedChanges'

/** The review is the confirmation: recipient is visible beside the send action. */
export default function DocumentDelivery({businessId,kind,documentId,email,phone,disabled=false,onEditContact,onSent,onBusyChange}:{
 businessId:string;kind:DeliveryDocumentKind;documentId:string;email?:string|null;phone?:string|null;disabled?:boolean;onEditContact:()=>void;onSent:()=>Promise<unknown>|void;onBusyChange?:(busy:boolean)=>void
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<ReviewDeliveryReceipt|null>(null),[refreshWarning,setRefreshWarning]=useState('')
 const {setup,error:setupError,refresh}=useDeliverySetup(businessId)
 const [personal,setPersonal]=useState(false),[pending,setPending]=useState<PendingPersonalSend|null>(null),[checkingPending,setCheckingPending]=useState(true)
 useEffect(()=>{
  let active=true
  setPersonal(false);setPending(null);setCheckingPending(true)
  void readPendingPersonalSend(businessId,kind,documentId).then(saved=>{if(active){setPending(saved);setCheckingPending(false)}})
  return()=>{active=false}
 },[businessId,kind,documentId])
 const inFlight=useRef(false)
 useUnsavedChanges(busy)
 async function send(){
  if(inFlight.current||disabled||receipt||!emailDeliveryEnabled||!validDeliveryEmail(email||''))return
  if(checkingPending||pending){setError('Review the earlier app draft before starting another email.');return}
  inFlight.current=true;setBusy(true);onBusyChange?.(true);setError('')
  try{
   const fresh=await refresh()
   if(fresh.plan!=='pro')throw new Error('Finviant email sending requires Business Pro. Review your current plan and sending options.')
   if(!fresh.managed_email_ready)throw new Error('Finviant email sending needs activation. Review Email & Text Setup.')
   const result=await sendReviewedDocument(businessId,kind,documentId,email!.trim())
   setReceipt(result)
   try{await onSent()}catch{setRefreshWarning('The document could not refresh. Do not resend to refresh it.')}
  }catch(err){setError(err instanceof Error?err.message:'Delivery could not be confirmed. Retry this same send.')}
  finally{inFlight.current=false;setBusy(false);onBusyChange?.(false)}
 }
 if(setupError)return <p role="alert">{setupError} <button className="text-button" onClick={()=>{void refresh().catch(()=>{})}}>Retry sending setup</button></p>
 if(!setup)return <p role="status">Checking sending options…</p>
 if(setup.plan!=='pro'||personal)return <><PersonalDocumentDelivery businessId={businessId} kind={kind} documentId={documentId} email={email} phone={phone} setup={setup} disabled={disabled} allowProPersonal={personal} onManagedEmailRequested={async()=>{setPersonal(false);await send()}} onPendingChange={value=>{setPending(value);if(!value)setPersonal(false)}} onEditContact={onEditContact} onSent={onSent} onBusyChange={value=>{setBusy(value);onBusyChange?.(value)}}/>{setup.plan==='pro'&&<button type="button" className="text-button" disabled={busy} onClick={()=>setPersonal(false)}>Use Finviant sending</button>}{error&&<p role="alert">{error}</p>}</>
 return <section aria-label="Send to customer" data-saving={busy?'true':undefined}>
  <DocumentDeliveryOptions hideSms kind={kind} email={email} phone={phone} disabled={disabled||!setup.managed_email_ready||checkingPending||!!pending} contactDisabled={disabled||busy} emailDisabled={!!receipt} sending={busy} emailLabel={receipt?'Email '+(receipt.status==='delivered'?'delivered':'accepted'):error?'Retry email':'Send Email'} onEmail={()=>void send()} onEditContact={onEditContact}/>
  {pending&&<div><p role="status">An earlier {pending.channel==='email'?'email':'text'} app draft is waiting for confirmation. Review it before starting another send.</p><button type="button" className="text-button" disabled={busy} onClick={()=>setPersonal(true)}>Review earlier app draft</button></div>}
  <ManagedSmsDelivery businessId={businessId} kind={kind} documentId={documentId} phone={phone} ready={setup.managed_sms_ready} disabled={disabled||busy} onSent={onSent} onBusyChange={value=>{setBusy(value);onBusyChange?.(value)}}/>
  <p className="quiet">Sends directly from Finviant after sender activation. <a href="/?view=settings&section=delivery">Review sending setup</a></p><button type="button" className="text-button" disabled={busy} onClick={()=>setPersonal(true)}>Use my email or text app instead</button>
  <ScheduledEmail businessId={businessId} kind={kind} documentId={documentId} ready={setup.managed_email_ready&&emailDeliveryEnabled}/>
  {error&&<p role="alert" className="form-message error-text">{error}</p>}
  {receipt&&<div><p role="status" className="form-message success-text">Email {receipt.status==='delivered'?'delivered':'accepted for delivery'} to {receipt.recipient}.{receipt.warning&&' '+receipt.warning} {refreshWarning}</p><button type="button" className="text-button" onClick={()=>{if(!window.confirm('Send another email to this customer? The previous email was already accepted.'))return;clearReviewedSend(businessId,kind,documentId);setReceipt(null);setRefreshWarning('')}}>Prepare another email</button></div>}
 </section>
}
