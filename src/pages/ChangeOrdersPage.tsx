import DocumentLineEditor from '../components/DocumentLineEditor'
import FormDialog from '../components/FormDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { previewDocumentTotal } from '../lib/financialValidation'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listJobs } from '../services/jobs'
import { createChangeOrder, listChangeOrders, updateChangeOrderStatus, getDocumentChangeContext, createDocumentChangeOrder, type DocumentChangeSource } from '../services/changeOrders'
import { createApprovalLink } from '../services/approvals'
import { sendDocumentEmail } from '../services/communications'
import { customerActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'
import { matchesChangeOrderContext, type DocumentChangeOrderContext } from '../lib/documentChangeOrders'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Job = { id: string; title: string; status: string; customer_id: string; customers: Customer[] | Customer | null }
type ChangeOrder = { id: string; customer_id: string; job_id: string|null; estimate_id?:string|null; source_invoice_id?:string|null; change_order_number: string | null; status: string; title: string; description: string | null; reason: string | null; schedule_impact_days: number; schedule_note: string | null; issue_date: string; subtotal: number; tax_amount: number; total: number; approved_at: string | null; customers: Customer[] | null; jobs: { id: string; title: string; status: string }[] | null }
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
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load change orders')) }, [business.id])

  const availableJobs = jobs.filter(job => matchesChangeOrderContext({ customer_id: job!.customer_id, job_id: job!.id }, context))
  const visibleOrders = changeOrders.filter(order => !context || (context.documentType==='invoice'?order.source_invoice_id===context.documentId:!order.source_invoice_id&&order.estimate_id===context.documentId) || (!!context.jobId&&!order.source_invoice_id&&!order.estimate_id&&order.job_id===context.jobId))

  const preview = useMemo(() => previewDocumentTotal(lines), [lines])

  function resetForm() {
    setJobId(context?.jobId || ''); setTitle(context?'Change to '+context.documentNumber:''); setDescription(''); setReason(''); setScheduleImpactDays('0'); setScheduleNote(''); setLines([blankLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!canManageFinances(business.role) || saving.current) return;saving.current=true; setBusy(true); setError(''); setNotice('')
    try {
      const job = availableJobs.find((row) => row.id === jobId)
      if (!context&&!job) throw new Error('Choose a job')
      if(context&&!source?.can_change)throw new Error('This work is complete or its source document is unavailable.')
      const sourceNote = context ? `Requested from ${context.documentType} ${context.documentNumber} (${context.documentId}).` : undefined
      const signature = JSON.stringify({jobId,title,description,reason,scheduleImpactDays,scheduleNote,lines,estimateId:context?.estimateId,sourceNote})
      if (retryRef.current?.signature !== signature) retryRef.current = {signature, requestId: crypto.randomUUID()}
      const additions={title,description,reason,schedule_impact_days:Number(scheduleImpactDays||0),schedule_note:scheduleNote,items:lines.map(line=>({description:line.description,quantity:Number(line.quantity),unit_price:Number(line.unit_price),tax_rate:Number(line.tax_rate||0)}))}
      if(context)await createDocumentChangeOrder(context.documentType,context.documentId,retryRef.current.requestId,additions)
      else await createChangeOrder(business.id, {
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
      resetForm(); setShowForm(false); await refresh()
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

  async function emailForApproval(order: ChangeOrder) {
    if (!customerActionsEnabled || !window.confirm('Send this change order to the customer for approval?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const sent = await sendDocumentEmail(business.id, 'change_order', order.id)
      setNotice(`Change order ${sent.status==='delivered'?'delivered':'accepted for delivery'} to ${sent.recipient}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to email change order')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">
    {!onBack&&<WorkspaceBack/>}{onBack && <div className="detail-top"><button type="button" className="back-button" onClick={onBack}>← Back to {context?.documentType || 'document'}</button></div>}
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Change orders</p><h1>Capture scope changes before they become lost revenue.</h1></div>
      {canManageFinances(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New change order</button>}
    </div>
    {context && <section className="document-change-context"><strong>From {context.documentNumber}</strong><p>Changes inherit this document’s customer, service address and linked work.</p></section>}
    <section className="change-order-intro"><strong>Accuracy first.</strong><span>Added work, price, tax and schedule impact stay separate until the customer approves the change.</span></section>
    {!customerActionsEnabled && <p className="form-message">Customer emails and approval links are disabled in this private preview until the sender domain and public link are configured.</p>}
    {notice && <p className="form-message success-text">{notice}</p>}
    {error && !showForm && <p className="form-message error-text">{error}</p>}
    <section className="list-card">
      {visibleOrders.length === 0 ? <div className="empty-state"><div className="empty-icon">CO</div><h2>No change orders yet</h2><p>When the scope changes, document the added work and cost here before doing it.</p></div> : visibleOrders.map((order) => {
        const customer = order.customers?.[0]
        const job = order.jobs?.[0]
        return <article className="document-row change-order-row" key={order.id}>
          <div className="row-main"><strong>{order.change_order_number || 'Draft change order'} · {order.title}</strong><span>{customerName(customer)} · {job?.title || 'Job'}{order.schedule_impact_days ? ` · ${order.schedule_impact_days > 0 ? '+' : ''}${order.schedule_impact_days} day schedule impact` : ''}</span></div>
          <div className="invoice-money"><strong className="money">${Number(order.total).toFixed(2)}</strong><span>{order.status === 'approved' ? 'approved' : 'proposed change'}</span></div>
          <div className="document-actions">
            <span className={`status-chip ${order.status === 'approved' ? 'paid' : ''}`}>{order.status}</span>
            {canManageFinances(business.role) && order.status === 'draft' && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(order.id, 'sent')}>Mark sent manually</button>}
            {canManageFinances(business.role) && ['draft','sent'].includes(order.status) && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(order.id, 'void')}>Void</button>}
            {canManageFinances(business.role) && order.status === 'draft' && <button className="primary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => emailForApproval(order)}>Email customer</button>}
            {canManageFinances(business.role) && order.status === 'sent' && <button className="secondary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => shareForApproval(order)}>Get / create approval link</button>}
          </div>
        </article>
      })}
    </section>
    {showForm && <FormDialog label="Create change order" busy={busy} onClose={() => { if(!saving.current){setShowForm(false); resetForm()} }} wide>
      <div className="modal-head"><div><p className="eyebrow">New change order</p><h2>Document added or changed work</h2></div><button className="icon-button" disabled={busy} onClick={() => { if(!saving.current){setShowForm(false); resetForm()} }} aria-label="Close" type="button">×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid">
          {context&&<section className="document-change-context full" aria-label="Original document">{source?<><strong>{source.number} · {source.customer_name}</strong>{(source.customer_email||source.customer_phone)&&<p>{[source.customer_email,source.customer_phone].filter(Boolean).join(' · ')}</p>}{source.address&&<p>{source.address}</p>}<p>Original total: ${Number(source.total).toFixed(2)} · Work: {source.work_status.replaceAll('_',' ')}</p><details><summary>Original scope and prices</summary><ul>{source.items.map((item,i)=><li key={i}>{item.description} · {item.quantity} × ${Number(item.unit_price).toFixed(2)}</li>)}</ul></details><p className="quiet">For reference. Add only the changed or additional charges below.</p>{!source.can_change&&<p role="alert">This work is complete or the original document is no longer active.</p>}</>:<p role="status">Loading original document…</p>}</section>}
          {!context&&<label className="full">Job<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Choose job…</option>{availableJobs.map((job) => <option value={job.id} key={job.id}>{customerName(jobCustomer(job))} — {job.title}</option>)}</select></label>}
          <label className="full">Change order title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add two recessed lights" required /></label>
          <label className="full">Scope change<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe exactly what is being added, removed, or changed." /></label>
          <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer requested" /></label>
          <label>Schedule impact (days)<input type="number" step="1" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} /></label>
          <label className="full">Schedule note<input value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} placeholder="Adds one working day to completion." /></label>
        </div>
        <DocumentLineEditor lines={lines} onChange={setLines} newLine={blankLine}/>
        <div className="estimate-total"><span>Proposed change</span><strong>{preview === null ? 'Check line amounts' : '$' + preview.toFixed(2)}</strong><small>Final totals are calculated by Finviant Office when saved. Customer approval is the next workflow step.</small></div>
        {error && <p role="alert" className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { if(!saving.current){setShowForm(false); resetForm()} }}>Cancel</button><button className="primary-button" disabled={busy||!!context&&!source?.can_change}>{busy ? 'Saving…' : 'Create change order'}</button></div>
      </form>
    </FormDialog>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
