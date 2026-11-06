import DocumentDelivery from '../components/DocumentDelivery'
import DocumentActions from '../components/DocumentActions'
import DocumentBrand from '../components/DocumentBrand'
import CustomerEditDialog from '../components/CustomerEditDialog'
import DocumentRecord,{type DocumentDates} from '../components/DocumentRecord'
import DocumentLineEditor from '../components/DocumentLineEditor'
import FormDialog from '../components/FormDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { previewDocumentTotal } from '../lib/financialValidation'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listJobs } from '../services/jobs'
import { createChangeOrder, listChangeOrders, listChangeOrderItems, updateChangeOrderStatus, getDocumentChangeContext, createDocumentChangeOrder, getChangeOrderSourceLines, getChangeOrderBilling, billApprovedChangeOrder, type ChangeOrderBilling, type ChangeSourceLine, type DocumentChangeSource } from '../services/changeOrders'
import { createApprovalLink } from '../services/approvals'
import { customerActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'
import { matchesChangeOrderContext, type DocumentChangeOrderContext } from '../lib/documentChangeOrders'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?:string|null; phone?:string|null }
type Job = { id: string; title: string; status: string; customer_id: string; customers: Customer[] | Customer | null }
type ChangeOrder = DocumentDates & { id: string; customer_id: string; job_id: string|null; estimate_id?:string|null; source_invoice_id?:string|null; change_order_number: string | null; status: string; title: string; description: string | null; reason: string | null; schedule_impact_days: number; schedule_note: string | null; issue_date: string; subtotal: number; tax_amount: number; total: number; approved_at: string | null; customers: Customer[] | null; jobs: { id: string; title: string; status: string }[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type ApprovalLinkState = { url: string; title: string; expiresAt: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

function customerName(customer?: Customer | null) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

function jobCustomer(job: Job) {
  return Array.isArray(job.customers) ? job.customers[0] : job.customers
}

export default function ChangeOrdersPage({ business, context, onBack }: { business: CurrentBusiness; context?: DocumentChangeOrderContext; onBack?: () => void }) {
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [showForm, setShowForm] = useState(!!context)
  const [reviewId,setReviewId]=useState<string|null>(null),[reviewItems,setReviewItems]=useState<Awaited<ReturnType<typeof listChangeOrderItems>>>([]),[reviewLoading,setReviewLoading]=useState(false),[reviewError,setReviewError]=useState(''),[editCustomer,setEditCustomer]=useState(false)
  const reviewFetch=useRef(0)
  const billingFlight=useRef(false)
  const [billing,setBilling]=useState<ChangeOrderBilling|null>(null)
  const [billingError,setBillingError]=useState('')
  const [billingVersion,setBillingVersion]=useState(0)
  useEffect(()=>()=>{reviewFetch.current++},[business.id])
  const reviewed=changeOrders.find(order=>order.id===reviewId)
  const canBill=canManageFinances(business.role)
  const approvedId=reviewed?.status==='approved'?reviewed.id:null
  useEffect(()=>{
    setBilling(null);setBillingError('')
    if(!approvedId||!canBill)return
    let active=true
    void getChangeOrderBilling(approvedId).then(value=>{if(active)setBilling(value)})
      .catch(err=>{if(active)setBillingError(err.message||'Unable to check billing.')})
    return()=>{active=false}
  },[approvedId,canBill,billingVersion])

  async function billChange(){
    if(billingFlight.current||!approvedId||!billing||billing.total===undefined)return
    const {action,total}=billing
    if(action!=='add_to_draft'&&action!=='create_invoice')return
    if(!window.confirm(action==='add_to_draft'?'Add the approved change to this draft invoice?':'Create a separate draft invoice for this approved change?'))return
    billingFlight.current=true;setBusy(true);setBillingError('')
    try{setBilling(await billApprovedChangeOrder(approvedId,action,total))}
    catch(err){setBillingError(err instanceof Error?err.message:'Unable to bill this change. Reload billing before retrying.')}
    finally{billingFlight.current=false;setBusy(false)}
  }

  const [sourceLines,setSourceLines]=useState<ChangeSourceLine[]>([])
  const [lineLoadError,setLineLoadError]=useState('')
  const [lineLoadComplete,setLineLoadComplete]=useState(false)
  const [revision,setRevision]=useState<{line:ChangeSourceLine;quantity:string;price:string}|null>(null)
  const [source,setSource]=useState<DocumentChangeSource|null>(null)
  const saving=useRef(false)
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [jobId, setJobId] = useState(context?.jobId || '')
  const [title, setTitle] = useState(context?'Change to '+context.documentNumber:'')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [scheduleImpactDays, setScheduleImpactDays] = useState('0')
  const [scheduleNote, setScheduleNote] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [orders, jobRows, source] = await Promise.all([listChangeOrders(business.id), context?Promise.resolve([]):listJobs(business.id),context?getDocumentChangeContext(context.documentType,context.documentId):Promise.resolve(null)])
    if(context)setSource(source)
    setChangeOrders(orders as ChangeOrder[])
    setJobs((jobRows as unknown as Job[]).filter((job) => job.status !== 'canceled'))
    return orders as ChangeOrder[]
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load change orders')) }, [business.id])

  useEffect(()=>{
    if(!context||!showForm)return
    let active=true
    setSourceLines([]);setLineLoadError('');setLineLoadComplete(false)
    void getChangeOrderSourceLines(context.documentType,context.documentId)
      .then(rows=>{if(active){setSourceLines(rows);setLineLoadError('');setLineLoadComplete(true)}})
      .catch(()=>{if(active)setLineLoadError('Could not load editable items. Reopen the document to try again.')})
    return()=>{active=false}
  },[context?.documentType,context?.documentId,showForm])

  const availableJobs = jobs.filter(job => matchesChangeOrderContext({ customer_id: job!.customer_id, job_id: job!.id }, context))
  const visibleOrders = changeOrders.filter(order => !context || (context.documentType==='invoice'?order.source_invoice_id===context.documentId:!order.source_invoice_id&&order.estimate_id===context.documentId) || (!!context.jobId&&!order.source_invoice_id&&!order.estimate_id&&order.job_id===context.jobId))

  const addedLines=useMemo(()=>lines.filter(line=>!revision||line.description.trim()||line.unit_price!==''),[lines,revision])
  const additionsTotal=addedLines.length?previewDocumentTotal(addedLines):revision?0:null
  const previousTotal=revision?previewDocumentTotal([revision.line]):null
  const revisedTotal=revision&&revision.price!==''?previewDocumentTotal([{...revision.line,quantity:revision.quantity,unit_price:revision.price}]):null
  const adjustment=revisedTotal!==null&&previousTotal!==null?Math.round((revisedTotal-previousTotal)*100)/100:null
  const preview=additionsTotal===null||revision&&adjustment===null?null:additionsTotal+(adjustment??0)
  const currentTotal=source?.kind==='estimate'?Number(source.total)+visibleOrders.filter(order=>order.status==='approved').reduce((sum,order)=>sum+Number(order.total),0):null

  function resetForm() {
    setRevision(null);setJobId(context?.jobId || ''); setTitle(context?'Change to '+context.documentNumber:''); setDescription(''); setReason(''); setScheduleImpactDays('0'); setScheduleNote(''); setLines([blankLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!canManageFinances(business.role) || saving.current) return;saving.current=true; setBusy(true); setError(''); setNotice('')
    try {
      const job = availableJobs.find((row) => row.id === jobId)
      if (!context&&!job) throw new Error('Choose a job')
      if(context&&!source?.can_change)throw new Error('This work is complete or its source document is unavailable.')
      if(revision&&(adjustment===null||adjustment<=0))throw new Error('Review a positive price adjustment before saving. Reductions and scope-only changes need a separate review.')
      const change=revision?{id:revision.line.id,previous:revision.line,quantity:Number(revision.quantity),unit_price:Number(revision.price)}:undefined
      const sourceNote = context ? `Requested from ${context.documentType} ${context.documentNumber} (${context.documentId}).` : undefined
      const signature = JSON.stringify({jobId,title,description,reason,scheduleImpactDays,scheduleNote,lines,change,estimateId:context?.estimateId,sourceNote})
      if (retryRef.current?.signature !== signature) retryRef.current = {signature, requestId: crypto.randomUUID()}
      const additions={title,description,reason,schedule_impact_days:Number(scheduleImpactDays||0),schedule_note:scheduleNote,items:addedLines.map(line=>({description:line.description,quantity:Number(line.quantity),unit_price:Number(line.unit_price),tax_rate:Number(line.tax_rate||0)}))}
      const created=context?await createDocumentChangeOrder(context.documentType,context.documentId,retryRef.current.requestId,additions,change):await createChangeOrder(business.id, {
        request_id: retryRef.current.requestId,
        customer_id: job!.customer_id,
        job_id: job!.id,
        estimate_id: undefined,
        notes: sourceNote,
        title,
        description,
        reason,
        schedule_impact_days: Number(scheduleImpactDays || 0),
        schedule_note: scheduleNote,
        items: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      })
      resetForm(); setShowForm(false); const orders=await refresh(); const saved=orders.find(order=>order.id===created.id); if(saved)void openReview(saved);else setNotice('Change order saved. Open it below to review and send.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create change order')
    } finally { saving.current=false;setBusy(false) }
  }

  async function changeStatus(id: string, status: 'sent' | 'void') {
    if (!window.confirm(status === 'sent'
      ? 'Mark this change order as sent outside Finviant Office? This does not email the customer.'
      : 'Void this change order? This removes it from the approval workflow but keeps a record of it.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await updateChangeOrderStatus(id, status)
      await refresh()
      setNotice(status === 'sent' ? 'Marked as sent manually. No customer email was generated.' : 'Change order voided.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update change order')
    } finally { setBusy(false) }
  }

  async function shareForApproval(order: ChangeOrder) {
    if (!customerActionsEnabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const link = await createApprovalLink(business.id, 'change_order', order.id)
      setApprovalLink({ url: link.url, title: `${order.change_order_number || 'Change order'} approval link`, expiresAt: link.expires_at })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create approval link')
    } finally { setBusy(false) }
  }

  function closeReview(){reviewFetch.current++;setReviewId(null);setReviewError('');setReviewLoading(false)}
  async function openReview(order:ChangeOrder){
    const request=++reviewFetch.current
    setReviewId(order.id);setReviewItems([]);setReviewLoading(true);setReviewError('')
    try{const items=await listChangeOrderItems(business.id,order.id);if(request===reviewFetch.current)setReviewItems(items)}catch{if(request===reviewFetch.current)setReviewError('Could not load the saved line items. Reload them before sending.')}finally{if(request===reviewFetch.current)setReviewLoading(false)}
  }

  return <div className="page-stack">
    {!onBack&&<WorkspaceBack/>}{onBack && <div className="detail-top"><button type="button" className="back-button" onClick={onBack}>← Back to {context?.documentType || 'document'}</button></div>}
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Change orders</p><h1>{context?`Changes to ${context.documentNumber}`:'Change orders'}</h1></div>
      {canManageFinances(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New change order</button>}
    </div>
    {context && <section className="document-change-context"><strong>From {context.documentNumber}</strong><p>Changes inherit this document’s customer, service address and linked work.</p></section>}
    <section className="change-order-intro"><strong>Accuracy first.</strong><span>Added work, price, tax and schedule impact stay separate until the customer approves the change.</span></section>
    {notice && <p className="form-message success-text">{notice}</p>}
    {error && !showForm && <p className="form-message error-text">{error}</p>}
    <section className="list-card">
      {visibleOrders.length === 0 ? <div className="empty-state"><div className="empty-icon">CO</div><h2>No change orders yet</h2><p>When the scope changes, document the added work and cost here before doing it.</p></div> : visibleOrders.map((order) => {
        const customer = order.customers?.[0]
        const job = order.jobs?.[0]
        return <article className="document-row change-order-row" key={order.id}>
          <button type="button" className="row-main estimate-document-open" onClick={()=>void openReview(order)}><strong>{order.change_order_number || 'Draft change order'} · {order.title}</strong><span>{customerName(customer)} · {job?.title || 'Job'}{order.schedule_impact_days ? ` · ${order.schedule_impact_days > 0 ? '+' : ''}${order.schedule_impact_days} day schedule impact` : ''}</span></button>
          <div className="invoice-money"><strong className="money">${Number(order.total).toFixed(2)}</strong><span>{order.status === 'approved' ? 'approved' : 'proposed change'}</span></div>
          <div className="document-actions">
            <button type="button" className="primary-button compact" onClick={()=>void openReview(order)}>Review / Send</button>
            <span className={`status-chip ${order.status === 'approved' ? 'paid' : ''}`}>{order.status}</span>
          </div>
        </article>
      })}
    </section>
    {showForm && <FormDialog label="Create change order" busy={busy} onClose={() => { if(!saving.current){setShowForm(false); resetForm()} }} wide>
      <div className="modal-head"><div><p className="eyebrow">New change order</p><h2>Document added or changed work</h2></div><button className="icon-button" disabled={busy} onClick={() => { if(!saving.current){setShowForm(false); resetForm()} }} aria-label="Close" type="button">×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid">
          {context&&<section className="document-change-context full" aria-label="Original document">{source?<><strong>{source.number} · {source.customer_name}</strong>{(source.customer_email||source.customer_phone)&&<p>{[source.customer_email,source.customer_phone].filter(Boolean).join(' · ')}</p>}{source.address&&<p>{source.address}</p>}<p>Original total: ${Number(source.total).toFixed(2)} · Work: {source.work_status.replaceAll('_',' ')}</p><details><summary>Original scope and prices</summary><ul>{source.items.map((item,i)=><li key={i}>{item.description} · {item.quantity} × ${Number(item.unit_price).toFixed(2)}</li>)}</ul></details><p className="quiet">Choose an existing item to adjust its quantity or rate, or add new work below.</p>{!source.can_change&&<p role="alert">This work is complete or the original document is no longer active.</p>}</>:<p role="status">Loading original document…</p>}</section>}
          {context&&sourceLines.length>0&&<fieldset className="full">
            <legend>Change an existing item</legend>
            <label>Current item<select value={revision?.line.id??''} onChange={event=>{
              const line=sourceLines.find(item=>item.id===event.target.value)
              setRevision(line?{line,quantity:String(line.quantity),price:String(line.unit_price)}:null)
            }}><option value="">Add new work only</option>{sourceLines.map(line=><option key={line.id} value={line.id}>{line.description} · {line.quantity} × ${line.unit_price}</option>)}</select></label>
            {revision&&<><div className="form-grid">
              <label>Revised quantity<input type="number" min="0.01" step="0.01" required value={revision.quantity} onChange={event=>setRevision({...revision,quantity:event.target.value})}/></label>
              <label>Revised unit price<input type="number" min="0" step="0.01" required value={revision.price} onChange={event=>setRevision({...revision,price:event.target.value})}/></label>
            </div><p>Current: ${previousTotal?.toFixed(2)} · Revised: {revisedTotal===null?'Enter the revised values':'$'+revisedTotal.toFixed(2)}{adjustment!==null&&<> · Difference: {adjustment<0?'−':'+'}${Math.abs(adjustment).toFixed(2)}</>}. Includes the original tax rate.</p>
            {adjustment!==null&&adjustment<=0&&<p role="status">Price reductions and scope-only changes need a separate review. No charge has been created.</p>}</>}
          </fieldset>}
          {context&&lineLoadComplete&&sourceLines.length===0&&!!source?.items.length&&<p className="quiet full">These older invoice lines could not be matched to the approved scope. Review the linked records before adjusting an existing charge.</p>}
          {lineLoadError&&<p className="quiet full" role="status">{lineLoadError}</p>}
          {!context&&<label className="full">Job<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Choose job…</option>{availableJobs.map((job) => <option value={job.id} key={job.id}>{customerName(jobCustomer(job))} — {job.title}</option>)}</select></label>}
          <label className="full">Change order title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add two recessed lights" required /></label>
          <label className="full">Scope change<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the requested change." /></label>
          <details className="full"><summary>Reason and schedule impact</summary><div className="form-grid"><label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer requested" /></label>
          <label>Schedule impact (days)<input type="number" step="1" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} /></label>
          <label className="full">Schedule note<input value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} placeholder="Adds one working day to completion." /></label></div></details>
        </div>
        {(!revision||addedLines.length>0)&&<DocumentLineEditor lines={lines} onChange={setLines} newLine={blankLine}/>}
        {revision&&addedLines.length===0&&<button type="button" className="text-button" onClick={()=>setLines([{...blankLine(),description:'Additional work'}])}>Add new item</button>}
        <div className="estimate-total"><span>Proposed change</span><strong>{preview === null ? 'Check line amounts' : '$' + preview.toFixed(2)}</strong>{currentTotal!==null&&preview!==null&&<small>Current total: ${currentTotal.toFixed(2)} · Revised total: ${(currentTotal+preview).toFixed(2)}</small>}<small>Save and review, then send for approval. Your original document is preserved.</small></div>
        {error && <p role="alert" className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { if(!saving.current){setShowForm(false); resetForm()} }}>Cancel</button><button className="primary-button" disabled={busy||!!context&&!source?.can_change||!!revision&&(adjustment===null||adjustment<=0)}>{busy ? 'Saving…' : 'Save and review'}</button></div>
      </form>
    </FormDialog>}
    {reviewId&&<FormDialog label="Review change order" wide busy={busy} onClose={closeReview}><section className="change-order-review">
      <div className="modal-head"><div><p className="eyebrow">{reviewed?.status||'Saved document'}</p><h2>Review change order</h2></div><button type="button" className="icon-button" aria-label="Close review" onClick={closeReview}>×</button></div>
      {reviewed?<>
        <p className="quiet">{reviewed.status==='draft'?'Next: send this change to the customer for approval.':reviewed.status==='sent'?'Waiting for customer approval.':reviewed.status==='approved'?'Customer approved this change.':''}</p>
        {canManageFinances(business.role)&&['draft','sent'].includes(reviewed.status)&&<DocumentDelivery onBusyChange={setBusy} key={reviewed.id} businessId={business.id} kind="change_order" documentId={reviewed.id} email={reviewed.customers?.[0]?.email} phone={reviewed.customers?.[0]?.phone} disabled={busy||reviewLoading||!!reviewError} onEditContact={()=>setEditCustomer(true)} onSent={refresh}/>}
        {editCustomer&&<CustomerEditDialog businessId={business.id} customerId={reviewed.customer_id} onClose={()=>setEditCustomer(false)} onSaved={()=>void refresh()}/>}
        {reviewLoading&&<p role="status">Loading saved line items…</p>}
        {reviewError&&<div><p role="alert">{reviewError}</p><button type="button" className="secondary-button" onClick={()=>void openReview(reviewed)}>Reload line items</button></div>}
        <article className="print-document change-order-preview-summary">
          <DocumentBrand business={business} kind="Change order"/>
          <div className="document-bill-to"><small>Prepared for</small><strong>{customerName(reviewed.customers?.[0])}</strong>{reviewed.customers?.[0]?.email&&<span>{reviewed.customers[0].email}</span>}{reviewed.customers?.[0]?.phone&&<span>{reviewed.customers[0].phone}</span>}</div>
          <h3>{reviewed.change_order_number||'Draft'} · {reviewed.title}</h3>
          {reviewed.description&&<p>{reviewed.description}</p>}{reviewed.reason&&<p><strong>Reason: </strong>{reviewed.reason}</p>}
          {reviewItems.map(item=><div className="document-line-row" key={item.id}><span>{item.description}</span><span>{Number(item.quantity)} × ${Number(item.unit_price).toFixed(2)}</span><strong>${Number(item.line_total).toFixed(2)}</strong></div>)}
          <div className="estimate-total"><span>Proposed change total</span><strong>${Number(reviewed.total).toFixed(2)}</strong>{Number(reviewed.tax_amount)>0&&<small>Includes ${Number(reviewed.tax_amount).toFixed(2)} tax.</small>}</div>
          {!!reviewed.schedule_impact_days&&<p>Schedule impact: {reviewed.schedule_impact_days>0?'+':''}{reviewed.schedule_impact_days} days</p>}{reviewed.schedule_note&&<p>{reviewed.schedule_note}</p>}
        </article>
        {approvedId&&canBill&&<section aria-label="Change order billing">
          <h3>Billing next step</h3>
          {!billing&&!billingError&&<p role="status">Checking billing…</p>}
          {billing?.action==='included_on_final'&&<p>This approved change will be included when you create the final invoice from the estimate.</p>}
          {billing?.action==='verify_existing'&&<p>Review the existing final invoice before charging this change. It may already be included.</p>}
          {billing?.action==='manual_review'&&<p>Review the linked records before billing this change.</p>}
          {(billing?.action==='add_to_draft'||billing?.action==='create_invoice')&&<>
            <p>{billing.action==='add_to_draft'
              ?`Draft invoice total: $${Number(billing.total).toFixed(2)} → $${(Number(billing.total)+Number(billing.change_total)).toFixed(2)}`
              :`Separate draft invoice: $${Number(billing.change_total).toFixed(2)}. The issued invoice stays intact.`}</p>
            <button type="button" className="primary-button" disabled={busy} onClick={()=>void billChange()}>{billing.action==='add_to_draft'?'Add to draft invoice':'Create change invoice'}</button>
          </>}
          {billing?.action==='billed'&&<p role="status">{billing.status==='void'?'The linked invoice was voided. Review billing history before creating a replacement.':`Included on ${billing.number||'the linked invoice'}.`}</p>}
          {billing?.invoice_id&&['billed','verify_existing'].includes(billing.action)&&<a href={'/?view=invoices&document='+encodeURIComponent(billing.invoice_id)}>Open invoice</a>}
          {billingError&&<p role="alert">{billingError} <button type="button" className="text-button" disabled={busy} onClick={()=>setBillingVersion(value=>value+1)}>Reload billing</button></p>}
        </section>}
        <DocumentRecord dates={reviewed} timezone={business.timezone} customerId={reviewed.customer_id} customerName={customerName(reviewed.customers?.[0])}/>
        <DocumentActions primary={<><button type="button" onClick={()=>window.print()}>Print / Save PDF</button></>} secondary={canManageFinances(business.role)&&<>
          {reviewed.status==='draft'&&<button type="button" disabled={busy} onClick={()=>void changeStatus(reviewed.id,'sent')}>Mark sent manually</button>}
          {reviewed.status==='sent'&&<button type="button" disabled={busy||!customerActionsEnabled} onClick={()=>void shareForApproval(reviewed)}>Approval link</button>}
          {['draft','sent'].includes(reviewed.status)&&<button type="button" className="danger-action" disabled={busy} onClick={()=>void changeStatus(reviewed.id,'void')}>Void</button>}
        </>}/>
        {error&&<p role="alert" className="form-message error-text">{error}</p>}{notice&&<p role="status" className="form-message">{notice}</p>}
      </>:<p role="status">Loading saved change order…</p>}
    </section></FormDialog>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
