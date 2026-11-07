import PersonalDocumentDelivery from './PersonalDocumentDelivery'
import {getDeliverySetup,type DeliverySetup} from '../services/tiers'
import {useEffect,useRef,useState} from 'react'
import FormDialog from './FormDialog'
import CustomerEditDialog from './CustomerEditDialog'
import {validDeliveryEmail} from './DocumentDeliveryOptions'
import {emailDeliveryEnabled,privateBetaEmailEnabled} from '../lib/releaseFlags'
import {getInvoiceReminderReview,sendInvoiceReminder,type InvoiceReminderReview} from '../services/invoiceReminders'
import type {CurrentBusiness} from '../lib/business'
import type {ReviewDeliveryReceipt} from '../services/reviewDelivery'
import './invoice-reminder.css'
export default function InvoiceReminderDialog({business,invoiceId,onClose,onSent}:{business:CurrentBusiness;invoiceId:string;onClose:()=>void;onSent:()=>void}){
 const [review,setReview]=useState<InvoiceReminderReview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<ReviewDeliveryReceipt|null>(null),[editContact,setEditContact]=useState(false)
 const[setup,setSetup]=useState<DeliverySetup|null>(null)
 useEffect(()=>{let active=true;void getDeliverySetup(business.id).then(s=>{if(active)setSetup(s)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[business.id])
 const flight=useRef(false)
 async function load(){setLoading(true);setError('');try{setReview(await getInvoiceReminderReview(business.id,invoiceId))}catch(e){setReview(null);setError(e instanceof Error?e.message:'Unable to load reminder.')}finally{setLoading(false)}}
 useEffect(()=>{let active=true;void getInvoiceReminderReview(business.id,invoiceId).then(r=>{if(active)setReview(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[business.id,invoiceId])
 async function send(){if(flight.current||!review||!emailDeliveryEnabled||!validDeliveryEmail(review.email||'')||receipt)return;flight.current=true;setBusy(true);setError('');try{const result=await sendInvoiceReminder(business.id,review);setReceipt(result);onSent()}catch(e){setError(e instanceof Error?e.message:'Unable to confirm reminder delivery.')}finally{flight.current=false;setBusy(false)}}
 return <FormDialog label="Send invoice reminder" busy={busy} onClose={onClose} wide autoFocusFields={false}>
 <div className="modal-head"><div><p className="eyebrow">Overdue invoice</p><h2>Send Reminder</h2></div><button type="button" className="icon-button" aria-label="Close reminder" disabled={busy} onClick={onClose}>×</button></div>
 {loading&&<p role="status">Preparing reminder…</p>}
 {error&&<p role="alert" className="error-text">{error}</p>}
 {!busy&&!receipt&&<button type="button" className="text-button" onClick={()=>void load()} disabled={loading}>Reload reminder details</button>}
 {review&&<><div className="reminder-facts"><strong>{review.number||'Invoice'}</strong><span>Due {review.due_date}</span><span>Remaining balance: {new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(review.balance))}</span></div>
 <p className="quiet">{review.last_reminder?`Last reminder: ${new Date(review.last_reminder.at).toLocaleString(undefined,{timeZone:business.timezone||'America/New_York'})} · ${review.last_reminder.channel.toUpperCase()} · ${review.last_reminder.status==='sent'?'accepted for delivery':review.last_reminder.status}`:'No successful reminders recorded for this invoice.'}</p>
 <section className="reminder-message" aria-label="Reminder preview"><strong>Subject: {review.subject}</strong><p>{review.body}</p></section>
 {!receipt&&<button type="button" className="text-button" disabled={busy} onClick={()=>setEditContact(true)}>Edit customer contact</button>}
 {setup&&<PersonalDocumentDelivery businessId={business.id} kind="invoice" documentId={invoiceId} email={review.email} phone={review.phone} setup={setup} disabled={busy} onEditContact={()=>setEditContact(true)} onSent={onSent} onBusyChange={setBusy} reminder={{subject:review.subject,body:review.body}}/>}
 {setup?.plan==='pro'&&<div className="reminder-actions"><button type="button" className="primary-button" disabled={busy||loading||!!receipt||!setup.managed_email_ready||!emailDeliveryEnabled||!validDeliveryEmail(review.email||'')} onClick={()=>void send()}>{busy?'Sending…':'Send Email with Finviant'}</button><small>{privateBetaEmailEnabled?'Private beta email sends only to approved test addresses.':'Requires activated Finviant email sending.'}</small></div>}
 {receipt&&<p role="status" className="form-message success-text">Reminder {receipt.status==='delivered'?'delivered':'accepted for delivery'} to {receipt.recipient}. {receipt.warning||''} The invoice balance and due date are unchanged.</p>}
 {editContact&&<CustomerEditDialog businessId={business.id} customerId={review.customer_id} onClose={()=>setEditContact(false)} onSaved={()=>void load()}/>}</>}
 <p className="quiet">Review the message and recipient before sending. The reminder uses this invoice; it does not create another invoice or record payment.</p>
 <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{receipt?'Done':'Cancel'}</button>
 </FormDialog>
}
