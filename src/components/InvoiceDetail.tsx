import {planUpgradeHref} from './PlanRestriction'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import DraftDocumentEditor from './DraftDocumentEditor'
import CustomerEditDialog from './CustomerEditDialog'
import {createReminder} from '../services/reminders'
import {DateTime} from 'luxon'
import {announceCalendarChange} from '../services/calendar'
import FormDialog from './FormDialog'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { localInstant } from '../lib/calendarTime'
import DocumentChangeOrders from './DocumentChangeOrders'
import {useTierUsage} from '../lib/useTierUsage'
import { canAccess,isPrimaryOwner } from '../lib/workspaceAccess'
import './settings/settings.css'
import {RecordResourcesDialog} from './RecordResources'
import DocumentActions from './DocumentActions'
import DocumentRecord, {DocumentTime, type DocumentDates} from './DocumentRecord'
import DocumentSchedule from './calendar/DocumentSchedule'
import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness, type BusinessProfile } from '../lib/business'
import { getInvoiceDetail } from '../services/invoiceDetail'
import RecordPaymentDialog from './RecordPaymentDialog'
import { updateInvoiceStatus } from '../services/invoices'
import DocumentDelivery from './DocumentDelivery'
import DocumentPaper from './DocumentPaper'
import { offersDocumentChangeOrders } from '../lib/documentChangeOrders'

const InvoiceJobDialog=lazy(()=>import('./scheduling/InvoiceJobDialog'))
const ChangeOrdersPage = lazy(() => import('../pages/ChangeOrdersPage'))

type Customer = { id:string; first_name:string|null; last_name:string|null; company:string|null; email:string|null; phone:string|null }
type Invoice = DocumentDates & { properties?:ServiceAddress|ServiceAddress[]|null; deposit_estimate_id:string|null; deposit_source_invoice_id:string|null; deposit_credit:number; payment_links?: unknown; payment_instructions?: string; issuer_snapshot?: Partial<BusinessProfile> | null; id:string; invoice_number:string|null; status:string; issue_date:string; due_date:string|null; subtotal:number; tax_amount:number; total:number; amount_paid:number; balance_due:number; notes:string|null; customer_message:string|null; sent_at:string|null; paid_at:string|null; customer_id:string; job_id:string|null; estimate_id:string|null; customers:Customer|Customer[]|null }
type Item = { id:string; description:string; quantity:number; unit_price:number; tax_rate:number; line_total:number }
type Payment = { id:string; amount:number; method:string|null; status:string; paid_at:string; notes:string|null }
type Message = { id:string; direction:string; channel:string; recipient:string|null; subject:string|null; body:string; status:string; sent_at:string|null; created_at:string }
type Detail = { invoice:Invoice; items:Item[]; payments:Payment[]; messages:Message[] }

function customerName(customer?: Customer | null) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function InvoiceDetail({ business, invoiceId, onBack, initialEdit=false }: { business:CurrentBusiness; invoiceId:string; onBack:()=>void; initialEdit?:boolean }) {
  const plan=useTierUsage(business.id)?.plan
  const [detail,setDetail]=useState<Detail|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [showEdit,setShowEdit]=useState(initialEdit),[showCustomer,setShowCustomer]=useState(false)
  const reminderSaving=useRef(false),reminderRetry=useRef<{signature:string;id:string}|null>(null)
  const [receipt,setReceipt]=useState('')
  const [showJob,setShowJob]=useState(false)
  const [showResources,setShowResources]=useState(false)
  const [jobNotice,setJobNotice]=useState('')
  const [showPayment,setShowPayment]=useState(false)
  const [showReminder,setShowReminder]=useState(false)
  const [showChangeOrders,setShowChangeOrders]=useState<string | null>(null)
  const [reminderAt,setReminderAt]=useState('')
  const [reminderNote,setReminderNote]=useState('Follow up on unpaid invoice')

  async function refresh(){setLoading(true);setError('');try{const next=await getInvoiceDetail(business.id,invoiceId) as Detail;setDetail(next)}catch(err){setError(err instanceof Error?err.message:'Unable to load invoice')}finally{setLoading(false)}}
  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(()=>{setDetail(null);setShowChangeOrders(null);void refresh()},[business.id,invoiceId])

  async function saveReminder(event:FormEvent){
    event.preventDefault();if(!detail||busy||reminderSaving.current)return;reminderSaving.current=true;setBusy(true);setError('')
    try{const due=new Date(localInstant(reminderAt,business.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone));if(Number.isNaN(due.getTime())||due.getTime()<=Date.now())throw new Error('Choose a reminder date and time in the future.');const signature=JSON.stringify({due:due.toISOString(),note:reminderNote});if(reminderRetry.current?.signature!==signature)reminderRetry.current={signature,id:crypto.randomUUID()};await createReminder(business,{id:reminderRetry.current.id,invoiceId:detail.invoice.id,customerId:detail.invoice.customer_id,dueAt:due.toISOString(),note:reminderNote});reminderRetry.current=null;setShowReminder(false);setReminderAt('');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to create reminder')}finally{reminderSaving.current=false;setBusy(false)}
  }

  async function markSent(){if(!detail||busy)return;if(!window.confirm('This only records that you sent the invoice outside Finviant Office. It does not email the customer. Continue?'))return;setBusy(true);setError('');try{await updateInvoiceStatus(detail.invoice.id,'sent');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to mark invoice sent')}finally{setBusy(false)}}

  async function voidInvoice(){if(!detail||busy||detail.invoice.status==='void'||Number(detail.invoice.amount_paid)>0)return;if(!window.confirm('Void this invoice? This cannot be undone, and the invoice will remain in your records.'))return;setBusy(true);setError('');try{await updateInvoiceStatus(detail.invoice.id,'void');await refresh()}catch(err){setError(err instanceof Error?err.message:'Unable to void invoice')}finally{setBusy(false)}}

  if(loading&&!detail)return <div className="detail-loading">Loading invoice…</div>
  if(!detail)return <div className="empty-state"><h2>Invoice unavailable</h2>{error&&<p role="alert">{error}</p>}<button className="secondary-button" onClick={onBack}>Back to invoices</button></div>
  const invoice=detail.invoice
  const customer=Array.isArray(invoice.customers)?invoice.customers[0]:invoice.customers
  const canScheduleJob=!invoice.deposit_estimate_id&&canManageFinances(business.role)&&canAccess(business,'jobs')&&canAccess(business,'calendar')
  const overdue=Number(invoice.balance_due)>0&&!!invoice.due_date&&invoice.due_date<DateTime.now().setZone(business.timezone || 'America/New_York').toISODate()!
  const site=Array.isArray(invoice.properties)?invoice.properties[0]:invoice.properties
  const issuedBrand=invoice.issuer_snapshot?.name ? { ...business, ...invoice.issuer_snapshot, name: invoice.issuer_snapshot.name } : business

  const changeContext = { documentId:invoice.id, documentNumber:invoice.invoice_number || 'Invoice', customerId:invoice.customer_id, jobId:invoice.job_id, estimateId:invoice.estimate_id, documentType: 'invoice' as const }
  if (showChangeOrders && !invoice.deposit_estimate_id) return <Suspense fallback={<p role="status">Loading change orders…</p>}><ChangeOrdersPage business={business} context={changeContext} initialOrder={showChangeOrders} onBack={()=>{setShowChangeOrders(null);void refresh()}} /></Suspense>

  return <div className="page-stack invoice-detail-page">
    <div className="detail-top"><button className="back-button" onClick={onBack}>← Invoices</button></div>
    <section className="invoice-hero">
      <div><p className="eyebrow">{invoice.status}</p><div className="record-resources-title"><h1>{invoice.invoice_number||'Invoice'}</h1><button type="button" className="secondary-button compact record-resources-entry calendar-no-print" onClick={()=>setShowResources(true)}>Photos &amp; expenses</button></div><p>{customerName(customer)}{customer?.email?` · ${customer.email}`:''}</p></div>
      <div className="invoice-hero-balance"><span>Balance due</span><strong>${Number(invoice.balance_due).toFixed(2)}</strong><small>Total ${Number(invoice.total).toFixed(2)}</small></div>
    </section>
    {showEdit&&<DraftDocumentEditor businessId={business.id} kind="invoice" id={invoice.id} onClose={()=>setShowEdit(false)} onSaved={()=>void refresh()}/>}
    {showCustomer&&<CustomerEditDialog businessId={business.id} customerId={invoice.customer_id} onClose={()=>setShowCustomer(false)} onSaved={()=>void refresh()}/>}
    {canManageFinances(business.role)&&invoice.status!=='void'&&<DocumentDelivery onBusyChange={setBusy} key={invoice.id} businessId={business.id} kind="invoice" documentId={invoice.id} email={customer?.email} phone={customer?.phone} disabled={busy} onEditContact={()=>setShowCustomer(true)} onSent={async()=>{await refresh();announceCalendarChange()}}/>}
    <DocumentActions primary={<>
      {canManageFinances(business.role)&&!['draft','void'].includes(invoice.status)&&Number(invoice.balance_due)>0&&<button type="button" disabled={busy} onClick={()=>setShowPayment(true)}>Mark Paid</button>}
      {canManageFinances(business.role)&&invoice.status==='draft'&&<button type="button" disabled={busy} onClick={()=>setShowEdit(true)}>Edit draft</button>}
        {canScheduleJob&&invoice.status!=='void'&&(invoice.job_id?<a href={'/?view=work&document='+encodeURIComponent(invoice.job_id)}>Open linked job</a>:<button type="button" disabled={busy} onClick={()=>setShowJob(true)}>Schedule job</button>)}
      <button type="button" onClick={()=>window.print()}>Print / Save PDF</button>
      {plan==='free'&&isPrimaryOwner(business)&&<a href={planUpgradeHref('basic')}>View Individual upgrade to remove Finviant branding</a>}
      {canManageFinances(business.role)&&invoice.status!=='void'&&Number(invoice.balance_due)>0&&<button type="button" disabled={busy} onClick={()=>setShowReminder(true)}>Schedule reminder</button>}
    </>} secondary={canManageFinances(business.role)&&invoice.status!=='void'?<>
      {invoice.status==='draft'&&<button type="button" onClick={markSent} disabled={busy}>Mark sent manually</button>}
      {!['void','paid'].includes(invoice.status)&&Number(invoice.amount_paid)===0&&<button type="button" className="danger-action" onClick={voidInvoice} disabled={busy}>Void invoice</button>}
    </>:undefined}/>
    {receipt&&<p role="status" className="form-message success-text">{receipt}</p>}
    {jobNotice&&<p className="form-message" role="status">{jobNotice}</p>}
    {error&&<p className="form-message error-text" role="alert">{error}</p>}
    {(invoice.estimate_id||invoice.deposit_estimate_id)&&<p><a href={'/?view=estimates&document='+encodeURIComponent(invoice.estimate_id||invoice.deposit_estimate_id!)}>Open original approved estimate</a>{invoice.deposit_estimate_id&&' · Deposit invoice'}</p>}
    {invoice.deposit_source_invoice_id&&<p><a href={'/?view=invoices&document='+encodeURIComponent(invoice.deposit_source_invoice_id)}>Paid deposit credited: ${Number(invoice.deposit_credit).toFixed(2)}</a></p>}
    {!invoice.deposit_estimate_id && canManageFinances(business.role) && <DocumentChangeOrders key={'changes:' + changeContext.documentId} business={business} context={changeContext} allowNew={offersDocumentChangeOrders('invoice', invoice.status)} onOpen={setShowChangeOrders} />}
    <DocumentRecord dates={invoice} timezone={business.timezone} customerId={invoice.customer_id} customerName={customerName(customer)}/>
    {showResources&&<RecordResourcesDialog business={business} target={{kind:'invoice',id:invoice.id}} title={invoice.invoice_number||'Invoice'} linkedJobId={invoice.job_id} onClose={()=>setShowResources(false)}/>}
    {!['draft','void','paid'].includes(invoice.status)&&Number(invoice.balance_due)>0&&<p className="quiet invoice-attention-policy">{overdue?'This invoice is overdue and remains in Needs Attention until its balance is settled.':'Awaiting payment. This invoice appears in Needs Attention only if it becomes overdue.'}</p>}
    {!canScheduleJob&&<DocumentSchedule business={business} kind="invoice" id={invoice.id} jobId={invoice.job_id} />}
    {showJob&&<Suspense fallback={<p role="status">Opening job scheduling…</p>}><InvoiceJobDialog business={business} invoiceId={invoice.id} onClose={()=>{setShowJob(false);void refresh()}} onSaved={result=>{setJobNotice(result.already_created?'This invoice already has a job. Open linked job to review its saved schedule.':'Job created and scheduled. Open linked job for details and materials.');void refresh()}}/></Suspense>}

    <section className="invoice-detail-grid">
      <div><DocumentPaper finviantBranding={plan==='free'} business={issuedBrand} kind="invoice" customer={customer} serviceAddress={site?formatServiceAddress(site):undefined} number={invoice.invoice_number} issued={invoice.issue_date} ending={invoice.due_date} items={detail.items} subtotal={invoice.subtotal} tax={invoice.tax_amount} total={invoice.total} depositCredit={invoice.deposit_credit} paid={invoice.amount_paid} balance={invoice.balance_due} message={invoice.customer_message} paymentLinks={invoice.payment_links} paymentInstructions={invoice.payment_instructions} status={invoice.status}/>{invoice.notes&&<div className="invoice-note internal"><strong>Internal notes (not printed)</strong><p>{invoice.notes}</p></div>}</div>
      <aside className="invoice-side-stack">
        <article className="detail-card"><p className="eyebrow">Payments</p><h2>Payment history</h2>{detail.payments.length===0?<p className="quiet">No payments recorded.</p>:<div className="history-list">{detail.payments.map(payment=><div className="history-row compact-history" key={payment.id}><div className="row-main"><strong>{payment.method||'Payment'}</strong><span><DocumentTime value={payment.paid_at} timezone={business.timezone}/> · {payment.status}</span></div><strong>${Number(payment.amount).toFixed(2)}</strong></div>)}</div>}</article>
        <article className="detail-card"><p className="eyebrow">Activity</p><h2>Messages</h2>{detail.messages.length===0?<p className="quiet">No invoice messages yet.</p>:<div className="message-list">{detail.messages.map(message=><div className="message-item" key={message.id}><div><strong>{message.channel.toUpperCase()}</strong><span>{message.status==='sent'?'Accepted for delivery':message.status}</span></div><p>{message.body}</p><small><DocumentTime value={message.sent_at||message.created_at} timezone={business.timezone}/></small></div>)}</div>}</article>
      </aside>
    </section>
    {showPayment&&<RecordPaymentDialog businessId={business.id} invoice={{...invoice,customers:customer?[customer]:[]}} onClose={()=>setShowPayment(false)} onSaved={message=>{
      setShowPayment(false);setReceipt(message);void refresh()
    }}/>}
    {showReminder&&<FormDialog label="Schedule reminder" busy={busy} onClose={()=>setShowReminder(false)}><div className="modal-head"><div><p className="eyebrow">Reminder</p><h2>Schedule invoice follow-up</h2></div><button className="icon-button" disabled={busy} onClick={()=>setShowReminder(false)} aria-label="Close" type="button">×</button></div><form className="form-grid" onSubmit={saveReminder}><label className="full">Remind me at<input type="datetime-local" value={reminderAt} onChange={e=>setReminderAt(e.target.value)} required/></label><label className="full">Note<textarea value={reminderNote} onChange={e=>setReminderNote(e.target.value)}/></label>{error&&<p className="form-message error-text full">{error}</p>}<div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setShowReminder(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Schedule reminder'}</button></div></form></FormDialog>}
  </div>
}
