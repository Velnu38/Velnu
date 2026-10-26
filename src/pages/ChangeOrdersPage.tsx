import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listJobs } from '../services/jobs'
import { createChangeOrder, listChangeOrders, updateChangeOrderStatus } from '../services/changeOrders'
import { createApprovalLink } from '../services/approvals'
import { sendDocumentEmail } from '../services/communications'
import { customerActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Job = { id: string; title: string; status: string; customer_id: string; customers: Customer[] | Customer | null }
type ChangeOrder = { id: string; change_order_number: string | null; status: string; title: string; description: string | null; reason: string | null; schedule_impact_days: number; schedule_note: string | null; issue_date: string; subtotal: number; tax_amount: number; total: number; approved_at: string | null; customers: Customer[] | null; jobs: { id: string; title: string; status: string }[] | null }
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

export default function ChangeOrdersPage({ business }: { business: CurrentBusiness }) {
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [showForm, setShowForm] = useState(false)
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [jobId, setJobId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [scheduleImpactDays, setScheduleImpactDays] = useState('0')
  const [scheduleNote, setScheduleNote] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [orders, jobRows] = await Promise.all([listChangeOrders(business.id), listJobs(business.id)])
    setChangeOrders(orders as ChangeOrder[])
    setJobs((jobRows as unknown as Job[]).filter((job) => job.status !== 'canceled'))
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load change orders')) }, [business.id])

  const preview = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0)
    const price = Number(line.unit_price || 0)
    const tax = Number(line.tax_rate || 0)
    const base = Number.isFinite(quantity * price) ? quantity * price : 0
    return sum + base + (base * tax / 100)
  }, 0), [lines])

  function resetForm() {
    setJobId(''); setTitle(''); setDescription(''); setReason(''); setScheduleImpactDays('0'); setScheduleNote(''); setLines([blankLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const job = jobs.find((row) => row.id === jobId)
      if (!job) throw new Error('Choose a job')
      const signature = JSON.stringify({jobId,title,description,reason,scheduleImpactDays,scheduleNote,lines})
      if (retryRef.current?.signature !== signature) retryRef.current = {signature, requestId: crypto.randomUUID()}
      await createChangeOrder(business.id, {
        request_id: retryRef.current.requestId,
        customer_id: job.customer_id,
        job_id: job.id,
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
    } finally { setBusy(false) }
  }

  async function changeStatus(id: string, status: ChangeOrder['status']) {
    setError(''); setNotice('')
    try { await updateChangeOrderStatus(id, status as 'draft' | 'sent' | 'approved' | 'declined' | 'void'); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update change order') }
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
      setNotice(`Change order sent to ${sent.recipient}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to email change order')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Change orders</p><h1>Capture scope changes before they become lost revenue.</h1></div>
      {canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New change order</button>}
    </div>
    <section className="change-order-intro"><strong>Accuracy first.</strong><span>Added work, price, tax and schedule impact stay separate until the customer approves the change.</span></section>
    {!customerActionsEnabled && <p className="form-message">Customer emails and approval links are disabled in this private preview until the sender domain and public link are configured.</p>}
    {notice && <p className="form-message success-text">{notice}</p>}
    {error && !showForm && <p className="form-message error-text">{error}</p>}
    <section className="list-card">
      {changeOrders.length === 0 ? <div className="empty-state"><div className="empty-icon">CO</div><h2>No change orders yet</h2><p>When the scope changes, document the added work and cost here before doing it.</p></div> : changeOrders.map((order) => {
        const customer = order.customers?.[0]
        const job = order.jobs?.[0]
        const terminal = ['approved', 'declined', 'void'].includes(order.status)
        return <article className="document-row change-order-row" key={order.id}>
          <div className="row-main"><strong>{order.change_order_number || 'Draft change order'} · {order.title}</strong><span>{customerName(customer)} · {job?.title || 'Job'}{order.schedule_impact_days ? ` · ${order.schedule_impact_days > 0 ? '+' : ''}${order.schedule_impact_days} day schedule impact` : ''}</span></div>
          <div className="invoice-money"><strong className="money">${Number(order.total).toFixed(2)}</strong><span>{order.status === 'approved' ? 'approved' : 'proposed change'}</span></div>
          <div className="document-actions">
            {terminal ? <span className={`status-chip ${order.status === 'approved' ? 'paid' : ''}`}>{order.status}</span> : <select value={order.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(order.id, e.target.value)}><option value="draft">Draft</option><option value="sent">Sent</option><option value="void">Void</option></select>}
            {canWrite(business.role) && !['void','approved'].includes(order.status) && <button className="primary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => emailForApproval(order)}>Email customer</button>}
            {canWrite(business.role) && !['void','approved'].includes(order.status) && <button className="secondary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => shareForApproval(order)}>Copy approval link</button>}
          </div>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">New change order</p><h2>Document added or changed work</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid">
          <label className="full">Job<select value={jobId} onChange={(e) => setJobId(e.target.value)} required><option value="">Choose job…</option>{jobs.map((job) => <option value={job.id} key={job.id}>{customerName(jobCustomer(job))} — {job.title}</option>)}</select></label>
          <label className="full">Change order title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add two recessed lights" required /></label>
          <label className="full">Scope change<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe exactly what is being added, removed, or changed." /></label>
          <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer requested" /></label>
          <label>Schedule impact (days)<input type="number" step="1" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} /></label>
          <label className="full">Schedule note<input value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} placeholder="Adds one working day to completion." /></label>
        </div>
        <div className="line-items"><div className="line-items-head"><strong>Price change</strong><button type="button" className="text-button" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" max="100" step="0.01" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="estimate-total"><span>Proposed change</span><strong>${preview.toFixed(2)}</strong><small>Final totals are calculated by Owedly when saved. Customer approval is the next workflow step.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create change order'}</button></div>
      </form>
    </section></div>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
