import './document-phone.css'
import {JobMenuIcon} from './JobMobileMenu'
import InvoiceReminderHistory from './InvoiceReminderHistory'
import WorkflowActivity from './WorkflowActivity'
import InvoiceReminderPreference from './InvoiceReminderPreference'
import CopyDocumentButton from './CopyDocumentButton'
import SquareInvoicePayment from './SquareInvoicePayment'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import {readableError} from '../lib/errors'
import {invoiceActionPolicy,invoiceDisplayStatus,invoiceIsOverdue} from '../lib/invoiceActions'
import {confirmNavigation} from '../lib/unsavedChanges'
import DraftDocumentEditor from './DraftDocumentEditor'
import CustomerEditDialog from './CustomerEditDialog'
import {createReminder} from '../services/reminders'
import {DateTime} from 'luxon'
import {announceCalendarChange} from '../services/calendar'
import FormDialog from './FormDialog'
import {formatServiceAddress,type ServiceAddress} from '../lib/googleMaps'
import DocumentChangeOrders from './DocumentChangeOrders'
import {useTierUsage} from '../lib/useTierUsage'
import {canAccess,isPrimaryOwner} from '../lib/workspaceAccess'
import UpgradeLink from './UpgradeLink'
import RecordResources from './RecordResources'
import {RecordDetailHeader,RecordTabs,RecordActionBar} from './RecordDetail'
import DocumentRecord,{DocumentTime,type DocumentDates} from './DocumentRecord'
import {type FormEvent,lazy,Suspense,useEffect,useId,useRef,useState} from 'react'
import {canManageFinances,type CurrentBusiness} from '../lib/business'
import {getInvoiceDetail,type InvoicePaymentOperations,type InvoiceWork} from '../services/invoiceDetail'
import RecordPaymentDialog from './RecordPaymentDialog'
import InvoiceReminderDialog from './InvoiceReminderDialog'
import {updateInvoiceStatus} from '../services/invoices'
import DocumentDeliveryDialog,{DocumentDeliveryRecovery} from './DocumentDeliveryDialog'
import DocumentPdfPreview from './DocumentPdfPreview'
import {offersDocumentChangeOrders} from '../lib/documentChangeOrders'

const RepeatInvoiceDialog=lazy(()=>import('./RecurringInvoices').then(module=>({default:module.RepeatInvoiceDialog})))
const InvoiceJobDialog=lazy(()=>import('./scheduling/InvoiceJobDialog'))
const ChangeOrdersPage=lazy(()=>import('../pages/ChangeOrdersPage'))
type Customer={id:string;first_name:string|null;last_name:string|null;company:string|null;email:string|null;phone:string|null}
type Invoice=DocumentDates&{properties?:ServiceAddress|ServiceAddress[]|null;deposit_estimate_id:string|null;deposit_source_invoice_id:string|null;deposit_credit:number;id:string;invoice_number:string|null;status:string;issue_date:string;due_date:string|null;subtotal:number;tax_amount:number;total:number;amount_paid:number;balance_due:number;notes:string|null;customer_message:string|null;customer_reference?:string|null;sent_at:string|null;paid_at:string|null;customer_id:string;job_id:string|null;estimate_id:string|null;customers:Customer|Customer[]|null}
type Item={id:string;description:string;quantity:number;unit_price:number;tax_rate:number;line_total:number}
type Payment={id:string;amount:number;method:string|null;status:string;paid_at:string;notes:string|null;provider?:string|null}
type Message={provider?:string;id:string;direction:string;channel:string;recipient:string|null;subject:string|null;body:string;status:string;sent_at:string|null;created_at:string}
type Detail={invoice:Invoice;items:Item[];payments:Payment[];messages:Message[];messagesUnavailable?:boolean;paymentOperations:InvoicePaymentOperations;work:InvoiceWork;changeOrderContext:{canChange:boolean;workStatus:string}}
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value||0))
function customerName(customer?:Customer|null){return customer?[customer.first_name,customer.last_name].filter(Boolean).join(' ')||customer.company||'Customer':'Customer'}

export default function InvoiceDetail({business,invoiceId,onBack,initialEdit=false}:{business:CurrentBusiness;invoiceId:string;onBack:()=>void;initialEdit?:boolean}){
  const [showSquare,setShowSquare]=useState(false)
  const [showRepeat,setShowRepeat]=useState(false)
  const plan=useTierUsage(business.id)?.plan
  const canManage=canManageFinances(business.role)&&canAccess(business,'billing')
  const canSeeWork=canAccess(business,'jobs'),canCalendar=canAccess(business,'calendar')
  const [detail,setDetail]=useState<Detail|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [showEdit,setShowEdit]=useState(initialEdit&&canManage),[showCustomer,setShowCustomer]=useState(false)
  const [showPayment,setShowPayment]=useState(false),[showReminder,setShowReminder]=useState(false),[showFollowUp,setShowFollowUp]=useState(false)
  const [showJob,setShowJob]=useState(false),[showChangeOrders,setShowChangeOrders]=useState<string|null>(null)
  const [delivery,setDelivery]=useState<'send'|'share'|'schedule'|'retry'|null>(null),[recovery,setRecovery]=useState(false)
  const [receipt,setReceipt]=useState(''),[jobNotice,setJobNotice]=useState('')
  const [tab,setTab]=useState('document'),[resourcesOpened,setResourcesOpened]=useState(false)
  const tabsId=useId(),tabIds={document:tabsId+'-document',resources:tabsId+'-resources',activity:tabsId+'-activity'}
  const [reminderAt,setReminderAt]=useState(''),[reminderNote,setReminderNote]=useState('Follow up on unpaid invoice')
  const reminderSaving=useRef(false),reminderRetry=useRef<{signature:string;id:string}|null>(null)
  const refreshGeneration=useRef(0),refreshMounted=useRef(false),refreshScope=useRef('')
  refreshScope.current=business.id+':'+invoiceId
  async function refresh(){
    const generation=++refreshGeneration.current,scope=business.id+':'+invoiceId
    const current=()=>refreshMounted.current&&generation===refreshGeneration.current&&scope===refreshScope.current
    setLoading(true)
    try{const next=await getInvoiceDetail(business.id,invoiceId,{work:canSeeWork,calendar:canCalendar,paymentOperations:canManage}) as Detail;if(current()){setDetail(next);setError('')}}
    catch(failure){if(current())setError(readableError(failure,'Unable to load invoice.'))}
    finally{if(current())setLoading(false)}
  }
  useAssistantRefresh(refresh,failure=>setError(readableError(failure,'The saved change could not refresh. Reload; do not repeat the save.')))
  useBusinessRefresh(business.id,()=>refresh())
  useEffect(()=>{
    refreshMounted.current=true;setDetail(null);setShowChangeOrders(null);setRecovery(false);setDelivery(null);setTab('document');setResourcesOpened(false)
    void refresh();return()=>{refreshMounted.current=false;refreshGeneration.current++}
  },[business.id,invoiceId,canManage,canSeeWork,canCalendar])
  async function saveReminder(event:FormEvent){
    event.preventDefault();if(!detail||busy||reminderSaving.current)return
    reminderSaving.current=true;setBusy(true);setError('')
    try{
      const due=DateTime.fromISO(reminderAt,{zone:business.timezone||'UTC'})
      if(!due.isValid||due.toMillis()<=Date.now())throw Error('Choose a reminder date and time in the future.')
      const signature=JSON.stringify({due:due.toISO(),note:reminderNote})
      if(reminderRetry.current?.signature!==signature)reminderRetry.current={signature,id:crypto.randomUUID()}
      await createReminder(business,{id:reminderRetry.current.id,invoiceId:detail.invoice.id,customerId:detail.invoice.customer_id,dueAt:due.toUTC().toISO()!,note:reminderNote})
      reminderRetry.current=null;setShowFollowUp(false);setReminderAt('');setReceipt('Your follow-up reminder was saved. No customer message was sent.');await refresh()
    }catch(failure){setError(readableError(failure,'Unable to create reminder.'))}finally{reminderSaving.current=false;setBusy(false)}
  }
  async function markSent(){
    if(!detail||busy||recovery||detail.invoice.status!=='draft'||!canManage)return
    if(!window.confirm('Record that you already sent this invoice outside Finviant? This does not send a customer message.'))return
    setBusy(true);try{await updateInvoiceStatus(detail.invoice.id,'sent');setReceipt('Recorded as sent outside Finviant.');await refresh()}catch(failure){setError(readableError(failure,'Unable to mark invoice sent.'))}finally{setBusy(false)}
  }
  async function voidInvoice(){
    if(!detail||busy||!canManage||detail.paymentOperations.state!=='clear'||detail.invoice.status==='void'||Number(detail.invoice.amount_paid)>0)return
    if(!window.confirm('Void this invoice? It will remain in your records.'))return
    setBusy(true);try{await updateInvoiceStatus(detail.invoice.id,'void');await refresh()}catch(failure){setError(readableError(failure,'Unable to void invoice.'))}finally{setBusy(false)}
  }
  // Panels stay mounted after opening, so changing tabs preserves expense drafts.
  function changeTab(id:string){setTab(id===tabIds.resources?'resources':id===tabIds.activity?'activity':'document');if(id===tabIds.resources)setResourcesOpened(true)}
  if(loading&&!detail)return <div className="detail-loading" role="status">Loading invoice…</div>
  if(!detail)return <div className="empty-state"><h2>Invoice unavailable</h2>{error&&<p role="alert">{error}</p>}<button className="secondary-button" onClick={()=>void refresh()}>Retry invoice</button><button className="text-button" onClick={onBack}>Back to invoices</button></div>
  const {invoice}=detail,customer=Array.isArray(invoice.customers)?invoice.customers[0]:invoice.customers
  const today=DateTime.now().setZone(business.timezone||'UTC').toISODate()!
  const policy=invoiceActionPolicy(invoice,{today,canManage,paymentState:detail.paymentOperations.state,recovery})
  const overdue=invoiceIsOverdue(invoice,today),status=invoiceDisplayStatus(invoice,today)
  const canSchedule=canManage&&canSeeWork&&canCalendar&&!invoice.deposit_estimate_id&&invoice.status!=='void'
  const job=detail.work.job,appointment=detail.work.appointment
  const jobHref=invoice.job_id?'/?view=work&document='+encodeURIComponent(invoice.job_id):null
  const hasAppointment=canCalendar?!!appointment:!!job?.scheduled_start
  const activeJob=job&&!['completed','canceled'].includes(job.status)
  const canChange=!invoice.deposit_estimate_id&&canManage&&detail.changeOrderContext.canChange&&offersDocumentChangeOrders('invoice',invoice.status,detail.changeOrderContext.workStatus)
  const hasMore=canManage
  const grossReceived=detail.payments.filter(payment=>['succeeded','partially_refunded','refunded'].includes(payment.status)).reduce((sum,payment)=>sum+Number(payment.amount),0)
  const netReceived=detail.paymentOperations.state==='unavailable'?null:grossReceived-detail.paymentOperations.refunds.reduce((sum,refund)=>sum+Number(refund.amount),0)
  const context={documentId:invoice.id,documentNumber:invoice.invoice_number||'Invoice',customerId:invoice.customer_id,jobId:invoice.job_id,estimateId:invoice.estimate_id,documentType:'invoice' as const}
  const site=Array.isArray(invoice.properties)?invoice.properties[0]:invoice.properties
  const action=(id:'send'|'mark_paid'|'reminder'|'edit'|null,primary:boolean)=>id?<button type="button" className={primary?'primary-button':'secondary-button'} disabled={busy} onClick={()=>id==='send'?setDelivery('send'):id==='mark_paid'?setShowPayment(true):id==='reminder'?setShowReminder(true):setShowEdit(true)}>{id==='send'?'Send invoice':id==='mark_paid'?'Mark Paid':id==='reminder'?'Send reminder':'Edit draft'}</button>:null
  if(showChangeOrders&&!invoice.deposit_estimate_id)return <Suspense fallback={<p role="status">Loading change orders…</p>}><ChangeOrdersPage business={business} context={context} initialOrder={showChangeOrders} onBack={()=>{setShowChangeOrders(null);void refresh()}}/></Suspense>
  return <div className="page-stack invoice-detail-page document-phone-page">
    <div className="detail-top"><button className="back-button" onClick={()=>{if(confirmNavigation())onBack()}}>← Invoices</button></div>
    <RecordDetailHeader title={invoice.invoice_number||'Invoice'} eyebrow="Invoice" status={status} subtitle={<>{customerName(customer)}{customer?.email?' · '+customer.email:''}</>}>
      <div className="invoice-hero-balance"><span>{invoice.status==='void'?'Voided total':'Balance due'}</span><strong>{money(invoice.status==='void'?invoice.total:invoice.balance_due)}</strong><small>Applied payments {money(invoice.amount_paid)} · {invoice.status==='void'?'No payment requested':'Total '+money(invoice.total)}</small></div>
    </RecordDetailHeader>
    {canManage&&<DocumentDeliveryRecovery businessId={business.id} kind="invoice" documentId={invoice.id} refreshKey={invoice.updated_at||''} onOpen={()=>setDelivery('retry')} onRecoveryChange={setRecovery}/>}
    {canManage&&detail.paymentOperations.state!=='clear'&&<aside role="status" className="form-message"><p>{detail.paymentOperations.message||(detail.paymentOperations.state==='pending'?'An online payment is processing. Wait for confirmation before recording or requesting another payment.':detail.paymentOperations.state==='review_required'?'An online payment needs reconciliation. Review the payment before requesting or recording more funds.':'Payment processing status is unavailable. Refresh before recording another payment.')}</p>{detail.paymentOperations.state==='unavailable'&&<button type="button" className="text-button" disabled={loading} onClick={()=>void refresh()}>Retry payment status</button>}</aside>}
    <RecordActionBar primary={action(policy.primary,true)} secondary={action(policy.secondary,false)} disabled={busy} more={hasMore?<>
      {isPrimaryOwner(business)&&plan&&plan!=="free"&&invoice.status!=="void"&&!invoice.deposit_estimate_id&&!invoice.deposit_source_invoice_id&&!Number(invoice.deposit_credit)&&<button type="button" onClick={()=>setShowRepeat(true)}>Repeat invoice</button>}
      <CopyDocumentButton businessId={business.id} kind="invoice" id={invoice.id} disabled={busy}/>
      {plan==='pro'&&!recovery&&!['draft','paid','void'].includes(invoice.status)&&<button type="button" onClick={()=>setShowSquare(true)}>Take payment with Square</button>}
      {policy.canSendCopy&&!recovery&&<button type="button" onClick={()=>setDelivery('share')}>Send invoice copy</button>}
      {canManage&&invoice.status==='draft'&&policy.primary!=='send'&&!recovery&&<button type="button" onClick={()=>setDelivery('send')}>Send invoice</button>}
      {canManage&&plan==='pro'&&!['paid','void'].includes(invoice.status)&&!recovery&&detail.paymentOperations.state==='clear'&&<button type="button" onClick={()=>setDelivery('schedule')}>Schedule email delivery</button>}
      {canManage&&invoice.status!=='void'&&!recovery&&<button type="button" onClick={()=>setShowCustomer(true)}>Edit customer contact</button>}
      {canManage&&invoice.status==='draft'&&!recovery&&<button type="button" onClick={()=>void markSent()}>Mark sent manually</button>}
      {canManage&&canCalendar&&!['draft','paid','void'].includes(invoice.status)&&Number(invoice.balance_due)>0&&<button type="button" onClick={()=>setShowFollowUp(true)}>Remind me to follow up</button>}
      {canSchedule&&invoice.job_id&&activeJob&&!hasAppointment&&<a href={jobHref+'&schedule=1'}>Schedule existing job</a>}
      {canSchedule&&!invoice.job_id&&<button type="button" onClick={()=>setShowJob(true)}>Schedule job</button>}
      {canChange&&<button type="button" onClick={()=>setShowChangeOrders('new')}>New change order</button>}
      {policy.canVoid&&!recovery&&<button type="button" className="danger-action" onClick={()=>void voidInvoice()}>Void invoice</button>}
    </>:undefined}/>
    {showRepeat&&isPrimaryOwner(business)&&<Suspense fallback={<p role="status">Opening recurring setup…</p>}><RepeatInvoiceDialog key={business.id+invoice.id} business={business} invoiceId={invoice.id} invoiceNumber={invoice.invoice_number||"Invoice"} onClose={()=>setShowRepeat(false)} onSaved={()=>void refresh()}/></Suspense>}
    {showSquare&&<SquareInvoicePayment business={business} invoiceId={invoice.id} onClose={()=>{setShowSquare(false);void refresh()}}/>}
    {receipt&&<p role="status" className="form-message success-text">{receipt}</p>}{jobNotice&&<p role="status" className="form-message">{jobNotice}</p>}{error&&<p role="alert" className="form-message error-text">{error}</p>}
    {invoice.job_id&&canSeeWork&&<p className="quiet">{job?.status==='completed'?'Linked work completed.':job?.status==='canceled'?'Linked job canceled.':hasAppointment?<>{canCalendar?'Appointment: ':'Work scheduled: '}<DocumentTime value={appointment?.starts_at||job?.scheduled_start} timezone={business.timezone}/>{job?.status==='in_progress'?' · Work in progress.':''}</>:detail.work.available?'Linked job has no active appointment.':'Linked job status could not be verified.'} <a href={jobHref!}>Open linked job</a></p>}
    {plan==='free'&&<UpgradeLink plan="free" required="basic" canUpgrade={isPrimaryOwner(business)}>View Individual upgrade to remove Finviant branding</UpgradeLink>}
    <button type="button" className="text-button" onClick={()=>changeTab(tabIds.activity)}>Reminder history</button>
    <RecordTabs tabs={[{id:tabIds.document,label:'Details'},{id:tabIds.resources,label:'Photos & expenses'},{id:tabIds.activity,label:'Activity',badge:detail.payments.length+detail.paymentOperations.refunds.length+detail.messages.length}]} active={tabIds[tab as keyof typeof tabIds]} onChange={changeTab} label="Invoice details"/>
    <section id={tabIds.document+'-panel'} role="tabpanel" aria-labelledby={tabIds.document+'-tab'} hidden={tab!=='document'}>
      <div className="document-phone-only document-phone-summary"><h3>Invoice summary</h3><dl><div><dt>Invoice total</dt><dd>{money(invoice.total)}</dd></div><div><dt>Applied payments</dt><dd>{money(invoice.amount_paid)}</dd></div><div><dt>{invoice.status==='void'?'Voided invoice':'Balance due'}</dt><dd>{money(invoice.balance_due)}</dd></div></dl></div>
      <div className="document-phone-actions"><DocumentPdfPreview compact source={{businessId:business.id,kind:'invoice',documentId:invoice.id}} title="Issued invoice PDF" refreshKey={invoice.updated_at||''}/>
        <button type="button" className="document-phone-only document-action-tile" onClick={()=>changeTab(tabIds.activity)}><JobMenuIcon kind="costs"/><strong>Payments</strong><small>Review payments</small></button>
        {!invoice.deposit_estimate_id&&canManage&&<button type="button" className="document-phone-only document-action-tile" onClick={()=>document.getElementById(tabIds.document+'-changes')?.scrollIntoView({behavior:'smooth',block:'start'})}><JobMenuIcon kind="changes"/><strong>Change orders</strong><small>Review changes</small></button>}
        {canSeeWork&&jobHref&&<a className="document-phone-only document-action-tile" href={jobHref}><JobMenuIcon kind="billing"/><strong>Linked job</strong><small>Review linked work</small></a>}
      </div>
      <p className="quiet">The PDF preserves the issued document. Current received funds and balance are shown above and in Activity.</p>
      <dl className="mini-metrics"><div><dt>Issued</dt><dd>{invoice.issue_date}</dd></div><div><dt>Due</dt><dd>{invoice.due_date||'No due date'}</dd></div>{invoice.customer_reference&&<div><dt>Customer PO / reference</dt><dd>{invoice.customer_reference}</dd></div>}{site&&<div><dt>Service address</dt><dd>{formatServiceAddress(site)}</dd></div>}</dl>
      {invoice.customer_message&&<p className="paper-message">{invoice.customer_message}</p>}
      {invoice.deposit_credit>0&&<p>Deposit credited: {money(invoice.deposit_credit)}{invoice.deposit_source_invoice_id&&<> · <a href={'/?view=invoices&document='+encodeURIComponent(invoice.deposit_source_invoice_id)}>Open deposit invoice</a></>}</p>}
      {(invoice.estimate_id||invoice.deposit_estimate_id)&&<p><a href={'/?view=estimates&document='+encodeURIComponent(invoice.estimate_id||invoice.deposit_estimate_id!)}>Open original approved estimate</a>{invoice.deposit_estimate_id&&' · Schedule the approved estimate, not this deposit invoice.'}</p>}
      {invoice.notes&&<div className="invoice-note internal"><strong>Internal notes (not printed)</strong><p>{invoice.notes}</p></div>}
      {!invoice.deposit_estimate_id&&canManage&&<div id={tabIds.document+'-changes'}><DocumentChangeOrders business={business} context={context} allowNew={false} onOpen={setShowChangeOrders}/></div>}
      {!['draft','void','paid'].includes(invoice.status)&&Number(invoice.balance_due)>0&&<p className="quiet">{overdue?'This invoice is overdue and remains in Needs Attention until its balance is settled.':'Awaiting payment. This invoice appears in Needs Attention only if it becomes overdue.'}</p>}
      {canManage&&<InvoiceReminderPreference key={business.id+':'+invoice.id} businessId={business.id} invoiceId={invoice.id}/>}
      <DocumentRecord dates={invoice} timezone={business.timezone} customerId={invoice.customer_id} customerName={customerName(customer)}/>
    </section>
    <section id={tabIds.resources+'-panel'} role="tabpanel" aria-labelledby={tabIds.resources+'-tab'} hidden={tab!=='resources'}>{canSeeWork&&jobHref&&<p><a href={jobHref+'&tab=photos-expenses'}>View linked job photos &amp; expenses</a></p>}{resourcesOpened&&<RecordResources business={business} target={{kind:'invoice',id:invoice.id}} active={tab==='resources'}/>}</section>
    <section id={tabIds.activity+'-panel'} role="tabpanel" aria-labelledby={tabIds.activity+'-tab'} hidden={tab!=='activity'}>
      {tab==='activity'&&<article className="detail-card"><h2>Workflow activity</h2><WorkflowActivity businessId={business.id} invoiceId={invoice.id} timezone={business.timezone} refreshKey={invoice.updated_at||''}/></article>}
      <article className="detail-card"><h2>Payment history</h2><p>Received funds, net of refunds: <strong>{netReceived===null?'Not verified':money(netReceived)}</strong> · Applied to invoice: <strong>{money(invoice.amount_paid)}</strong></p>
        {!detail.payments.length&&!detail.paymentOperations.refunds.length?<p className="quiet">No payments recorded.</p>:<div className="history-list">{detail.payments.map(payment=><div className="history-row compact-history" key={payment.id}><div className="row-main"><strong>{payment.method||'Payment'} · {payment.provider==='stripe_customer'?'Verified online payment':'Recorded payment'}</strong><span><DocumentTime value={payment.paid_at} timezone={business.timezone}/> · {payment.status}</span>{payment.notes&&<small>{payment.notes}</small>}</div><strong>{money(payment.amount)}</strong></div>)}{detail.paymentOperations.refunds.map(refund=><div className="history-row compact-history" key={refund.id}><div className="row-main"><strong>Customer refund</strong><DocumentTime value={refund.refunded_at} timezone={business.timezone}/></div><strong>−{money(refund.amount)}</strong></div>)}</div>}
        {canManage&&detail.paymentOperations.state==='unavailable'&&<p role="alert">Refund history could not be verified. Refresh before reconciling this ledger.</p>}
      </article>
      <InvoiceReminderHistory businessId={business.id} invoiceId={invoice.id} timezone={business.timezone}/><article className="detail-card"><h2>Messages</h2>{detail.messagesUnavailable?<p role="alert">Invoice messages are unavailable. Refresh to verify activity.</p>:!detail.messages.length?<p className="quiet">No invoice messages yet.</p>:<div className="message-list">{detail.messages.map(message=><div className="message-item" key={message.id}><div><strong>{message.channel.toUpperCase()}</strong><span>{message.provider==='personal_app'?'User-reported sent — delivery unverified':message.provider==='personal_app_reminder'?(message.status==='failed'?'Draft canceled':'Draft opened'):['sent','accepted'].includes(message.status)?'Accepted for delivery':message.status}</span></div>{message.subject&&<strong>{message.subject}</strong>}<p>{message.body}</p><small><DocumentTime value={message.sent_at||message.created_at} timezone={business.timezone}/></small></div>)}</div>}</article>
    </section>
    {showEdit&&canManage&&invoice.status==='draft'&&<DraftDocumentEditor businessId={business.id} kind="invoice" id={invoice.id} onClose={()=>setShowEdit(false)} onSaved={()=>void refresh()}/>}
    {showCustomer&&canManage&&<CustomerEditDialog businessId={business.id} customerId={invoice.customer_id} onClose={()=>setShowCustomer(false)} onSaved={()=>void refresh()}/>}
    <DocumentDeliveryDialog open={delivery!==null} onClose={()=>setDelivery(null)} initialIntent={delivery||'send'} title={delivery==='share'?'Send invoice copy':delivery==='retry'?'Review earlier invoice send':delivery==='schedule'?'Schedule invoice email':'Send invoice'} businessId={business.id} kind="invoice" documentId={invoice.id} refreshKey={invoice.updated_at||''} email={customer?.email} phone={customer?.phone} disabled={busy||!canManage||invoice.status==='void'} onEditContact={()=>setShowCustomer(true)} onBusyChange={setBusy} onSent={async()=>{await refresh();announceCalendarChange()}}/>
    {showJob&&canSchedule&&!invoice.job_id&&<Suspense fallback={<p role="status">Opening job scheduling…</p>}><InvoiceJobDialog business={business} invoiceId={invoice.id} onClose={()=>setShowJob(false)} onSaved={result=>{setJobNotice(result.already_created?'This invoice already has a job. Open linked job to review its saved appointment.':'Job and appointment saved. No customer message was sent.');setShowJob(false);void refresh()}}/></Suspense>}
    {showPayment&&policy.canRecordPayment&&<RecordPaymentDialog businessId={business.id} invoice={{...invoice,customers:customer?[customer]:[]}} onClose={()=>setShowPayment(false)} onSaved={message=>{setShowPayment(false);setReceipt(message);void refresh()}}/>}
    {showReminder&&policy.canRemind&&<InvoiceReminderDialog business={business} invoiceId={invoice.id} onClose={()=>setShowReminder(false)} onSent={()=>void refresh()}/>}
    {showFollowUp&&<FormDialog label="Remind me to follow up" busy={busy} onClose={()=>setShowFollowUp(false)}><div className="modal-head"><h2>Remind me to follow up</h2><button type="button" className="icon-button" aria-label="Close reminder" onClick={()=>setShowFollowUp(false)}>×</button></div><p>This creates an internal reminder. It does not send a customer message.</p><form className="form-grid" onSubmit={saveReminder}><label>Remind me at ({business.timezone||'UTC'})<input type="datetime-local" value={reminderAt} onChange={event=>setReminderAt(event.target.value)} required/></label><label>Note<textarea value={reminderNote} onChange={event=>setReminderNote(event.target.value)} required/></label>{error&&<p role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setShowFollowUp(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save reminder'}</button></div></form></FormDialog>}
  </div>
}
