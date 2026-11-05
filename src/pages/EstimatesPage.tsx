import { customerRecordsHref } from '../lib/customerRecords'
import CustomerRecordScope from '../components/CustomerRecordScope'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import DocumentLineEditor from '../components/DocumentLineEditor'
import DraftDocumentEditor from '../components/DraftDocumentEditor'
import CustomerEditDialog from '../components/CustomerEditDialog'
import DocumentActions from '../components/DocumentActions'
import DocumentRecord, {CreatedStamp,DocumentTime,type DocumentDates} from '../components/DocumentRecord'
import FormDialog from '../components/FormDialog'
import DocumentChangeOrderButton from '../components/DocumentChangeOrderButton'
import WorkspaceBack from '../components/WorkspaceBack'
import { DateTime } from 'luxon'
import RecordListControls, { RecordListPagination, useRecordList } from '../components/RecordListControls'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { getDocumentSettings } from '../services/settings'
import { RecordResourcesDialog } from '../components/RecordResources'
import DocumentSchedule from '../components/calendar/DocumentSchedule'
import { previewDocumentTotal } from '../lib/financialValidation'
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness, type BusinessProfile } from '../lib/business'
import { listCustomers } from '../services/customers'
import { convertEstimateToInvoice, createEstimate, listEstimates, listEstimateItems, updateEstimateStatus } from '../services/estimates'
import DocumentBrand from '../components/DocumentBrand'
import { createApprovalLink } from '../services/approvals'
import DocumentDelivery from '../components/DocumentDelivery'
import { customerActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'
import { offersDocumentChangeOrders } from '../lib/documentChangeOrders'
import ScheduleEstimateDialog from '../components/scheduling/ScheduleEstimateDialog'
import { canAccess } from '../lib/workspaceAccess'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import CustomerEntry, { emptyCustomerDraft, newCustomerFields } from '../components/CustomerEntry'
import PaymentOptionsFields, { type DocumentPayments } from '../components/PaymentOptionsFields'
import { validPaymentLink } from '../lib/paymentLinks'

const ChangeOrdersPage = lazy(() => import('./ChangeOrdersPage'))

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Estimate = DocumentDates & { issuer_snapshot?: Partial<BusinessProfile> | null; id: string; customer_id: string; job_id?: string | null; estimate_number: string | null; status: string; issue_date: string; expires_on: string | null; subtotal: number; tax_amount: number; total: number; customer_message?: string | null; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type PreviewItem = { id: string; description: string; quantity: number; unit_price: number; tax_rate: number; line_total: number }
type ApprovalLinkState = { url: string; title: string; expiresAt: string }
type EstimateFilter = 'all' | 'pipeline' | 'draft' | 'sent' | 'approved' | 'declined'

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })
const estimateMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function EstimatesPage({ business }: { business: CurrentBusiness }) {
  const [resourceEstimate, setResourceEstimate] = useState<{ id: string; estimate_number: string | null } | null>(null)
  const customerScope = new URLSearchParams(window.location.search).get('customer') || ''
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [statusFilter, setStatusFilter] = useState<EstimateFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null)
  const [scheduleTarget,setScheduleTarget]=useState<Estimate|null>(null)
  const [previewTarget, setPreviewTarget] = useState<Estimate | null>(null)
  const [showEdit,setShowEdit]=useState(false),[editCustomer,setEditCustomer]=useState(false)
  const [showChangeOrders, setShowChangeOrders] = useState(false)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [convertDueDate, setConvertDueDate] = useState('')
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerDraft,setCustomerDraft]=useState(emptyCustomerDraft)
  const customerRequest=useRef<{signature:string;id:string}|null>(null)
  const saving=useRef(false)
  const [defaultPayments,setDefaultPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [documentPayments,setDocumentPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [propertyId,setPropertyId]=useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [issueDate, setIssueDate] = useState(() => DateTime.now().setZone(business.timezone || 'UTC').toISODate()!)
  const [notes, setNotes] = useState('')
  const [customerTerms, setCustomerTerms] = useState('')
  const [defaultTax, setDefaultTax] = useState(0)
  const [defaultsReady,setDefaultsReady] = useState(false)
  useEffect(() => { let active=true; void getDocumentSettings(business.id).then(d=>{if(active){setDefaultTax(Number(d.default_tax_rate));setDefaultPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDocumentPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDefaultsReady(true)}}).catch(()=>{if(active)setError('Unable to load document defaults. Reload before creating a document.')}); return()=>{active=false} },[business.id])
  const quickCreate=useRef(new URLSearchParams(window.location.search).get('new')==='1')
  useEffect(()=>{if(defaultsReady&&quickCreate.current&&canManageFinances(business.role)){quickCreate.current=false;resetForm();setShowForm(true);const url=new URL(location.href);url.searchParams.delete('new');history.replaceState(history.state,'',url.pathname+url.search)}},[defaultsReady,business.role])
  const newLine = (): Line => ({...blankLine(),tax_rate:String(defaultTax)})
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [estimateRows, customerRows] = await Promise.all([listEstimates(business.id, customerScope), listCustomers(business.id)])
    setEstimates(estimateRows as Estimate[])
    setPreviewTarget(previous=>previous?(estimateRows as Estimate[]).find(row=>row.id===previous.id)||previous:null)
    setCustomers(customerRows as Customer[])
    return estimateRows as Estimate[]
  }

  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load estimates')) }, [business.id])

  const linkedDocumentOpened = useRef(false)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('document')
    const target = estimates.find(row => row.id === id)
    if (target && !linkedDocumentOpened.current) {
      linkedDocumentOpened.current = true
      void openPreview(target)
    }
  }, [estimates])

  const previewTotal = useMemo(() => previewDocumentTotal(lines), [lines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }

  function resetForm() {
    setIssueDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!); setCustomerId('');setCustomerDraft(emptyCustomerDraft());customerRequest.current=null;setDocumentPayments(defaultPayments); setPropertyId(''); setExpiresOn(''); setNotes(''); setCustomerTerms(''); setLines([newLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if(saving.current)return;saving.current=true;setBusy(true); setError(''); setNotice('')
    try {
      if(previewTotal === null)throw new Error('Check the description, quantity, price and tax on each line.')
      if(documentPayments.payment_links.some(link=>!validPaymentLink(link)))throw new Error('Enter a valid HTTPS link for each selected payment method.')
      let customer={customer_id:customerId,new_customer:undefined as ReturnType<typeof newCustomerFields>|undefined}
      if(!customerId){
        const fields=newCustomerFields(customerDraft),signature=JSON.stringify(fields)
        if(customerRequest.current?.signature!==signature)customerRequest.current={signature,id:crypto.randomUUID()}
        customer={customer_id:customerRequest.current.id,new_customer:fields}
      }
      const payments=isPrimaryOwner(business)?documentPayments:{}
      const signature = JSON.stringify({ issueDate, customer, payments, propertyId, expiresOn, notes, customerTerms, lines })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const created = await createEstimate(business.id, { request_id: retryRef.current.requestId,
        ...customer,...payments,
        property_id: propertyId || undefined,
        issue_date: issueDate,
        expires_on: expiresOn || undefined,
        notes,
        customer_message: customerTerms,
        items: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      })
      resetForm(); setShowForm(false); const rows=await refresh(); const saved=rows.find(row=>row.id===created.id); if(saved)await openPreview(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create estimate')
    } finally { saving.current=false;setBusy(false) }
  }

  async function changeStatus(id: string, status: 'sent' | 'accepted' | 'declined' | 'expired') {
    const confirmations: Record<typeof status, string> = {
      sent: 'Mark this estimate as delivered outside Finviant Office? This does not email the customer.',
      accepted: 'Record that the customer accepted this estimate outside Finviant Office? Confirm you have their actual approval.',
      declined: 'Record that the customer declined this estimate outside Finviant Office?',
      expired: 'Mark this estimate as expired?',
    }
    if (!window.confirm(confirmations[status])) return
    setBusy(true); setError(''); setNotice('')
    try {
      await updateEstimateStatus(id, status)
      await refresh()
      setNotice(status === 'accepted' ? 'Customer acceptance recorded. Choose the crew and appointment times next.' : 'Estimate marked ' + status + '.')
      if(status==='accepted'&&canAccess(business,'calendar')&&canAccess(business,'jobs'))setScheduleTarget(estimates.find(row=>row.id===id) || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update estimate')
    } finally { setBusy(false) }
  }

  async function shareForApproval(estimate: Estimate) {
    if (!customerActionsEnabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const link = await createApprovalLink(business.id, 'estimate', estimate.id)
      setApprovalLink({ url: link.url, title: `${estimate.estimate_number || 'Estimate'} approval link`, expiresAt: link.expires_at })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create approval link')
    } finally { setBusy(false) }
  }

  async function convert(event: FormEvent) {
    event.preventDefault()
    if (!convertTarget || saving.current) return
    saving.current=true
    setBusy(true); setError(''); setNotice('')
    try {
      const invoiceId = await convertEstimateToInvoice(convertTarget.id, convertDueDate || undefined)
      setConvertTarget(null); setConvertDueDate('')
      window.history.pushState({finviantIndex:(Number(history.state?.finviantIndex)||0)+1},'', '/?view=invoices&document='+encodeURIComponent(invoiceId));window.dispatchEvent(new PopStateEvent('popstate',{state:{finviantConfirmedSave:true}}))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert estimate')
    } finally { saving.current=false;setBusy(false) }
  }


  async function openPreview(target: Estimate) {
    setPreviewBusy(true); setError('')
    try {
      const items = await listEstimateItems(business.id, target.id)
      setPreviewItems(items as PreviewItem[])
      setPreviewTarget(target)
      history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope,target.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the estimate preview.')
    } finally { setPreviewBusy(false) }
  }

  function estimateStatus(estimate: Estimate) {
    if (estimate.status === 'sent' || estimate.status === 'viewed') return 'Awaiting customer approval'
    if (estimate.status === 'accepted' || estimate.status === 'converted') return 'Approved'
    return estimate.status.replaceAll('_', ' ')
  }
  const filteredEstimates = useMemo(() => estimates.filter(estimate => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'pipeline') return ['draft', 'sent', 'viewed'].includes(estimate.status)
    if (statusFilter === 'draft') return estimate.status === 'draft'
    if (statusFilter === 'sent') return ['sent', 'viewed'].includes(estimate.status)
    if (statusFilter === 'approved') return ['accepted', 'converted'].includes(estimate.status)
    return ['declined', 'expired'].includes(estimate.status)
  }), [estimates, statusFilter])
  const recordList = useRecordList(filteredEstimates, row => [row.estimate_number, customerName(row.customers?.[0]), row.issue_date, row.expires_on, estimateStatus(row)].join(' '))
  const awaitingApproval = estimates.filter(estimate => ['sent', 'viewed'].includes(estimate.status))
  const approvedEstimates = estimates.filter(estimate => ['accepted', 'converted'].includes(estimate.status))
  const pipelineEstimates = estimates.filter(estimate => ['draft', 'sent', 'viewed'].includes(estimate.status))
  function chooseFilter(filter: EstimateFilter) { setStatusFilter(filter); recordList.setPage(0) }
  const emptyFilterMessage = {
    all: 'No estimates in this view.',
    pipeline: 'No draft or sent estimates in this view.',
    draft: 'No draft estimates in this view.',
    sent: 'No estimates are awaiting customer approval.',
    approved: 'No approved estimates in this view.',
    declined: 'No declined or expired estimates in this view.',
  }[statusFilter]

  if (showChangeOrders && previewTarget && offersDocumentChangeOrders('estimate', previewTarget.status)) return <Suspense fallback={<p role="status">Loading change orders…</p>}><ChangeOrdersPage business={business} context={{ documentType: 'estimate', documentId: previewTarget.id, documentNumber: previewTarget.estimate_number || 'Estimate', customerId: previewTarget.customer_id, jobId: previewTarget.job_id, estimateId: previewTarget.id }} onBack={() => setShowChangeOrders(false)} /></Suspense>

  return <div className="page-stack workspace-module estimates-module"><WorkspaceBack />
    <div className="page-heading split-heading module-page-heading"><div><p className="eyebrow">Estimates</p><h1>Quote the work without the paperwork.</h1><p className="module-page-intro">Track approvals, send a quote, or turn approved work into a job.</p></div>{canManageFinances(business.role) && <button type="button" className="primary-button" disabled={!defaultsReady} onClick={() => { resetForm(); if(customers.some(c=>c.id===customerScope))setCustomerId(customerScope); setShowForm(true) }}><span aria-hidden="true">＋</span> Create estimate</button>}</div>
    {notice && !previewTarget && <p className="form-message success-text">{notice}</p>}
    {error && !previewTarget && !showForm && !convertTarget && <p className="form-message error-text">{error}</p>}
    <CustomerRecordScope customerId={customerScope} customers={customers} view="estimates"/>
    <section className="module-summary-grid" aria-label="Estimate summary">
      <button type="button" className="module-summary-card module-summary-card-approval" aria-pressed={statusFilter === 'sent'} onClick={() => chooseFilter('sent')}><span>Awaiting Customer Approval</span><strong>{awaitingApproval.length}</strong><small>{awaitingApproval.length === 1 ? 'estimate' : 'estimates'} sent to customers</small></button>
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'approved'} onClick={() => chooseFilter('approved')}><span>Approved</span><strong>{approvedEstimates.length}</strong><small>{approvedEstimates.length === 1 ? 'estimate' : 'estimates'} accepted or invoiced</small></button>
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'pipeline'} onClick={() => chooseFilter('pipeline')}><span>Pending Estimate Value</span><strong>{estimateMoney.format(pipelineEstimates.reduce((sum, estimate) => sum + Number(estimate.total || 0), 0))}</strong><small>{pipelineEstimates.length} draft and sent {pipelineEstimates.length === 1 ? 'estimate' : 'estimates'}</small></button>
    </section>
    <nav className="module-status-filters" aria-label="Filter estimates">
      {([['all','All',estimates.length],['draft','Draft',estimates.filter(row=>row.status==='draft').length],['declined','Declined / Expired',estimates.filter(row=>['declined','expired'].includes(row.status)).length]] as const).map(([value,label,count])=><button key={value} type="button" aria-pressed={statusFilter===value} onClick={()=>chooseFilter(value)}>{label}<span>{count}</span></button>)}
    </nav>
    <RecordListControls label="estimates" list={recordList} showPagination={false} />
    <section className="module-record-list" aria-label="Estimates" hidden={!!previewTarget}>
      {estimates.length === 0 ? <div className="empty-state"><div className="empty-icon">E</div><h2>No estimates yet</h2><p>Select Create estimate to prepare your first estimate.</p></div> : recordList.visible.map((estimate) => {
        const customer = estimate.customers?.[0]
        const currentStatus = estimateStatus(estimate)
        return <article className="document-row module-record-card estimate-module-record" key={estimate.id}>
          <div className="module-record-main"><button type="button" className="module-record-open" disabled={previewBusy} onClick={() => openPreview(estimate)} aria-label={`Open estimate ${estimate.estimate_number || ''} for ${customerName(customer)}`}><strong>{estimate.estimate_number || 'Draft estimate'}</strong></button><span>{customerName(customer)} · Issued {new Date(estimate.issue_date + 'T00:00:00').toLocaleDateString()}{estimate.expires_on ? ` · Expires ${new Date(estimate.expires_on + 'T00:00:00').toLocaleDateString()}` : ''}</span><CreatedStamp value={estimate.created_at} timezone={business.timezone}/></div>
          <div className="module-record-total"><span>Estimate total</span><strong>{estimateMoney.format(Number(estimate.total))}</strong><small>{estimate.status === 'converted' ? 'Invoice created' : 'Customer quote'}</small></div>
          <div className="module-record-actions"><span className={`module-record-status ${['accepted','converted'].includes(estimate.status) ? 'is-positive' : ['sent','viewed'].includes(estimate.status) ? 'is-pending' : ''}`}>{currentStatus}</span><button type="button" className="primary-button compact" disabled={previewBusy} onClick={() => openPreview(estimate)}>Open estimate</button>{canManageFinances(business.role)&&['accepted'].includes(estimate.status)&&!estimate.job_id&&canAccess(business,'calendar')&&canAccess(business,'jobs')&&<button type="button" className="secondary-button compact" onClick={()=>setScheduleTarget(estimate)}>Schedule job</button>}<button type="button" className="secondary-button compact" aria-label={`Photos and expenses for ${estimate.estimate_number || 'estimate'}`} onClick={() => setResourceEstimate(estimate)}>Photos &amp; expenses</button></div>
        </article>
      })}
      {estimates.length > 0 && recordList.total === 0 && !recordList.search && <div className="module-empty-filter"><strong>{emptyFilterMessage}</strong><span>Choose another status or view all estimates.</span></div>}
    </section>
    {!previewTarget && <RecordListPagination label="estimates" list={recordList} className="estimate-bottom-pagination" />}
    {scheduleTarget&&<ScheduleEstimateDialog business={business} estimateId={scheduleTarget.id} onClose={()=>setScheduleTarget(null)} onSaved={()=>void refresh()}/>}
    {resourceEstimate && <RecordResourcesDialog business={business} target={{ kind: 'estimate', id: resourceEstimate.id }} title={resourceEstimate.estimate_number || 'Estimate'} onClose={() => setResourceEstimate(null)} />}
    {showForm && <FormDialog label="Create an estimate" busy={busy} onClose={() => { setShowForm(false); resetForm() }} wide>
      <div className="modal-head"><div><p className="eyebrow">New estimate</p><h2>Create an estimate</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }} aria-label="Close" type="button">×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><CustomerEntry customers={customers} value={customerId} draft={customerDraft} onChange={setCustomerId} onDraft={setCustomerDraft} disabled={busy}/><label>Issue date<input type="date" required max={DateTime.now().setZone(business.timezone || 'UTC').toISODate()!} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></label><label>Expires on<input type="date" min={issueDate} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label><label>Internal notes (not shown to customer)<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="full"><CustomerPropertySelect businessId={business.id} customerId={customerId} value={propertyId} onChange={setPropertyId} disabled={busy}/></div>
        <label className="full">Customer-facing estimate terms (optional)<textarea rows={3} maxLength={4000} value={customerTerms} onChange={e => setCustomerTerms(e.target.value)} placeholder="For example: Estimate valid for 14 days. A deposit is due before work begins." /></label></div>
        <DocumentLineEditor lines={lines} onChange={setLines} newLine={newLine}/>
        <PaymentOptionsFields value={documentPayments} onChange={setDocumentPayments} editable={isPrimaryOwner(business)}/><div className="estimate-total"><span>Preview total</span><strong>{previewTotal === null ? 'Check line amounts' : '$' + previewTotal.toFixed(2)}</strong><small>Final totals are calculated when the estimate is saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save draft estimate'}</button></div>
      </form>
    </FormDialog>}
    {convertTarget && <FormDialog label="Create the invoice" busy={busy} onClose={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>
      <div className="modal-head"><div><p className="eyebrow">Accepted estimate</p><h2>Create the invoice</h2></div><button className="icon-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }} aria-label="Close" type="button">×</button></div>
      <div className="conversion-summary"><span>{convertTarget.estimate_number || 'Estimate'}</span><strong>${Number(convertTarget.total).toFixed(2)}</strong><p>{customerName(convertTarget.customers?.[0])}</p></div>
      <form onSubmit={convert} className="conversion-form"><label>Invoice due date<input type="date" value={convertDueDate} onChange={(e) => setConvertDueDate(e.target.value)} /></label><p className="quiet">Finviant Office will copy every line item and tax rate into a new draft invoice. The database recalculates the final invoice total.</p>{error && <p className="form-message error-text">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Save draft invoice'}</button></div></form>
    </FormDialog>}


    {previewTarget && <FormDialog label="Estimate preview" wide onClose={()=>{setPreviewTarget(null);history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope))}}><section className="estimate-preview-modal">
        <div className="modal-head">
          <div><p className="eyebrow">Customer-facing document</p><h2>Estimate preview</h2></div>
          <button className="icon-button" onClick={() => {setPreviewTarget(null);history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope))}} aria-label="Close preview" type="button">×</button>
        </div>
        {showEdit&&<DraftDocumentEditor businessId={business.id} kind="estimate" id={previewTarget.id} onClose={()=>setShowEdit(false)} onSaved={()=>{void refresh().then(rows=>{const next=rows.find(r=>r.id===previewTarget.id);if(next)void openPreview(next)})}}/>}
        {editCustomer&&<CustomerEditDialog businessId={business.id} customerId={previewTarget.customer_id} onClose={()=>setEditCustomer(false)} onSaved={()=>{void refresh().then(rows=>{const next=rows.find(r=>r.id===previewTarget.id);if(next)setPreviewTarget(next)})}}/>}
        {canManageFinances(business.role)&&['draft','sent'].includes(previewTarget.status)&&<DocumentDelivery onBusyChange={setBusy} key={"delivery:"+previewTarget.id} businessId={business.id} kind="estimate" documentId={previewTarget.id} email={previewTarget.customers?.[0]?.email} phone={previewTarget.customers?.[0]?.phone} disabled={busy} onEditContact={()=>setEditCustomer(true)} onSent={refresh}/>}
        <DocumentActions primary={<>
          {canManageFinances(business.role)&&previewTarget.status==='draft'&&<button type="button" disabled={busy} onClick={()=>setShowEdit(true)}>Edit draft</button>}
          {canManageFinances(business.role)&&previewTarget.status==='sent'&&<button type="button" disabled={busy} onClick={()=>changeStatus(previewTarget.id,'accepted')}>Record acceptance</button>}
          {canManageFinances(business.role)&&['accepted','converted'].includes(previewTarget.status)&&!previewTarget.job_id&&canAccess(business,'calendar')&&canAccess(business,'jobs')&&<button type="button" disabled={busy} onClick={()=>setScheduleTarget(previewTarget)}>Schedule job</button>}
          {previewTarget.job_id&&canAccess(business,'jobs')&&<a href={`/?view=work&document=${encodeURIComponent(previewTarget.job_id)}`}>Open linked job</a>}
          {canManageFinances(business.role)&&previewTarget.status==='accepted'&&<button type="button" disabled={busy} onClick={()=>{setError('');setNotice('');setConvertTarget(previewTarget)}}>Create invoice</button>}
          <button type="button" onClick={()=>window.print()}>Print / Save PDF</button>
          <button type="button" onClick={()=>setResourceEstimate(previewTarget)}>Photos &amp; expenses</button>
        </>} secondary={canManageFinances(business.role)?<>
          {!['draft','sent'].includes(previewTarget.status)&&<button type="button" disabled={busy} onClick={()=>setEditCustomer(true)}>Edit customer</button>}
          {previewTarget.status==='sent'&&<button type="button" disabled={busy||!customerActionsEnabled} onClick={()=>shareForApproval(previewTarget)}>Approval link</button>}
          {offersDocumentChangeOrders('estimate',previewTarget.status)&&<DocumentChangeOrderButton business={business} kind="estimate" id={previewTarget.id} onClick={()=>setShowChangeOrders(true)}/>}
          {previewTarget.status==='draft'&&<button type="button" disabled={busy} onClick={()=>changeStatus(previewTarget.id,'sent')}>Mark sent manually</button>}
          {previewTarget.status==='sent'&&<><button type="button" disabled={busy} className="danger-action" onClick={()=>changeStatus(previewTarget.id,'declined')}>Record decline</button><button type="button" disabled={busy} className="danger-action" onClick={()=>changeStatus(previewTarget.id,'expired')}>Expire</button></>}
        </>:undefined}/>
        {notice&&<p role="status" className="form-message success-text">{notice}</p>}
        {error&&<p role="alert" className="form-message error-text">{error}</p>}
        <DocumentRecord dates={previewTarget} timezone={business.timezone} customerId={previewTarget.customer_id} customerName={customerName(previewTarget.customers?.[0])}/>
        <DocumentSchedule key={previewTarget.id} business={business} kind="estimate" id={previewTarget.id} jobId={previewTarget.job_id} />
        <article className="estimate-preview-document print-document">
          <DocumentBrand business={previewTarget.issuer_snapshot?.name ? { ...business, ...previewTarget.issuer_snapshot, name: previewTarget.issuer_snapshot.name } : business} kind="Estimate" />
          <div className="document-bill-to"><small>Prepared for</small><strong>{customerName(previewTarget.customers?.[0])}</strong>
            {previewTarget.customers?.[0]?.email && <span>{previewTarget.customers[0].email}</span>}
            {previewTarget.customers?.[0]?.phone && <span>{previewTarget.customers[0].phone}</span>}
          </div>
          <div className="invoice-meta">
            <div><span>Created</span><DocumentTime value={previewTarget.created_at} timezone={business.timezone}/></div>
            <div><span>Estimate</span><strong>{previewTarget.estimate_number || 'Draft'}</strong></div>
            <div><span>Issued</span><strong>{previewTarget.issue_date}</strong></div>
            {previewTarget.expires_on && <div><span>Valid until</span><strong>{previewTarget.expires_on}</strong></div>}
          </div>
          <div className="document-line-head"><span>Description</span><span>Qty</span><span>Rate</span><span>Total</span></div>
          {previewItems.map(item => <div className="document-line-row" key={item.id}>
            <span>{item.description}{Number(item.tax_rate) > 0 && <small>{Number(item.tax_rate)}% tax</small>}</span>
            <span>{Number(item.quantity)}</span><span>{'$' + Number(item.unit_price).toFixed(2)}</span>
            <strong>{'$' + Number(item.line_total).toFixed(2)}</strong>
          </div>)}
          <div className="document-summary">
            <div><span>Subtotal</span><strong>{'$' + Number(previewTarget.subtotal).toFixed(2)}</strong></div>
            {Number(previewTarget.tax_amount)>0&&<div><span>Tax</span><strong>{'$' + Number(previewTarget.tax_amount).toFixed(2)}</strong></div>}
            <div className="total"><span>Total</span><strong>{'$' + Number(previewTarget.total).toFixed(2)}</strong></div>
          </div>
          {previewTarget.customer_message && <div className="document-customer-message"><strong>Estimate terms</strong><p>{previewTarget.customer_message}</p></div>}
          {(previewTarget.issuer_snapshot?.name ? previewTarget.issuer_snapshot.document_footer : business.document_footer) && <div className="document-footer">{previewTarget.issuer_snapshot?.name ? previewTarget.issuer_snapshot.document_footer : business.document_footer}</div>}
        </article>
      </section>
    </FormDialog>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
