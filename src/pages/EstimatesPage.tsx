import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness, type BusinessProfile } from '../lib/business'
import { listCustomers } from '../services/customers'
import { convertEstimateToInvoice, createEstimate, listEstimates, listEstimateItems, updateEstimateStatus } from '../services/estimates'
import DocumentBrand from '../components/DocumentBrand'
import { createApprovalLink } from '../services/approvals'
import { sendDocumentEmail } from '../services/communications'
import { customerActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Estimate = { issuer_snapshot?: Partial<BusinessProfile> | null; id: string; estimate_number: string | null; status: string; issue_date: string; expires_on: string | null; subtotal: number; tax_amount: number; total: number; customer_message?: string | null; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type PreviewItem = { id: string; description: string; quantity: number; unit_price: number; tax_rate: number; line_total: number }
type ApprovalLinkState = { url: string; title: string; expiresAt: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

export default function EstimatesPage({ business }: { business: CurrentBusiness }) {
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null)
  const [previewTarget, setPreviewTarget] = useState<Estimate | null>(null)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [convertDueDate, setConvertDueDate] = useState('')
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [notes, setNotes] = useState('')
  const [customerTerms, setCustomerTerms] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [estimateRows, customerRows] = await Promise.all([listEstimates(business.id), listCustomers(business.id)])
    setEstimates(estimateRows as Estimate[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load estimates')) }, [business.id])

  const previewTotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0)
    const price = Number(line.unit_price || 0)
    const tax = Number(line.tax_rate || 0)
    const base = Number.isFinite(quantity * price) ? quantity * price : 0
    return sum + base + (base * tax / 100)
  }, 0), [lines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }

  function resetForm() {
    setCustomerId(''); setExpiresOn(''); setNotes(''); setCustomerTerms(''); setLines([blankLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const signature = JSON.stringify({ customerId, expiresOn, notes, customerTerms, lines })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      await createEstimate(business.id, { request_id: retryRef.current.requestId,
        customer_id: customerId,
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
      resetForm(); setShowForm(false); await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create estimate')
    } finally { setBusy(false) }
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
      setNotice(status === 'accepted' ? 'Customer acceptance recorded manually. You can now create a draft invoice.' : 'Estimate marked ' + status + '.')
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

  async function emailForApproval(estimate: Estimate) {
    if (!customerActionsEnabled || !window.confirm('Send this estimate to the customer for approval?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const sent = await sendDocumentEmail(business.id, 'estimate', estimate.id)
      setNotice(`Estimate sent to ${sent.recipient}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to email estimate')
    } finally { setBusy(false) }
  }

  async function convert(event: FormEvent) {
    event.preventDefault()
    if (!convertTarget) return
    setBusy(true); setError(''); setNotice('')
    try {
      await convertEstimateToInvoice(convertTarget.id, convertDueDate || undefined)
      setConvertTarget(null); setConvertDueDate('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert estimate')
    } finally { setBusy(false) }
  }


  async function openPreview(target: Estimate) {
    setPreviewBusy(true); setError('')
    try {
      const items = await listEstimateItems(business.id, target.id)
      setPreviewItems(items as PreviewItem[])
      setPreviewTarget(target)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the estimate preview.')
    } finally { setPreviewBusy(false) }
  }

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Estimates</p><h1>Quote the work without the paperwork.</h1></div>{canManageFinances(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New estimate</button>}</div>
    {!customerActionsEnabled && <p className="form-message">Customer emails and approval links are disabled in this private preview until the sender domain and public link are configured. You can preview and print estimates now.</p>}
    {notice && <p className="form-message success-text">{notice}</p>}
    {error && !showForm && !convertTarget && <p className="form-message error-text">{error}</p>}
    <section className="list-card">
      {estimates.length === 0 ? <div className="empty-state"><div className="empty-icon">E</div><h2>No estimates yet</h2><p>Create an estimate here or tell Finviant Office what you want to quote.</p></div> : estimates.map((estimate) => {
        const customer = estimate.customers?.[0]
        return <article className="document-row" key={estimate.id}>
          <div className="row-main"><strong>{estimate.estimate_number || 'Draft estimate'}</strong><span>{customerName(customer)} · {new Date(estimate.issue_date + 'T00:00:00').toLocaleDateString()}</span></div>
          <strong className="money">${Number(estimate.total).toFixed(2)}</strong>
          <div className="document-actions">
            <button className="secondary-button compact" disabled={previewBusy} onClick={() => openPreview(estimate)}>Preview / Print</button>
            <span className={`status-chip ${estimate.status === 'accepted' ? 'paid' : ''}`}>{estimate.status}</span>
            {canManageFinances(business.role) && estimate.status === 'draft' && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(estimate.id, 'sent')}>Mark sent manually</button>}
            {canManageFinances(business.role) && estimate.status === 'sent' && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(estimate.id, 'accepted')}>Record acceptance</button>}
            {canManageFinances(business.role) && estimate.status === 'sent' && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(estimate.id, 'declined')}>Record decline</button>}
            {canManageFinances(business.role) && estimate.status === 'sent' && <button className="secondary-button compact" disabled={busy} onClick={() => changeStatus(estimate.id, 'expired')}>Expire</button>}
            {canManageFinances(business.role) && !['converted','expired','accepted'].includes(estimate.status) && <button className="primary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => emailForApproval(estimate)}>Email customer</button>}
            {canManageFinances(business.role) && estimate.status === 'sent' && <button className="secondary-button compact" disabled={busy || !customerActionsEnabled} onClick={() => shareForApproval(estimate)}>Get customer approval link</button>}
            {canManageFinances(business.role) && estimate.status === 'accepted' && <button className="conversion-button" onClick={() => { setError(''); setNotice(''); setConvertTarget(estimate) }}>Create invoice</button>}
          </div>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">New estimate</p><h2>Create an estimate</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><label className="full">Customer<select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customerName(customer)}</option>)}</select></label><label>Expires on<input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label><label>Internal notes (not shown to customer)<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="full">Customer-facing estimate terms (optional)<textarea rows={3} maxLength={4000} value={customerTerms} onChange={e => setCustomerTerms(e.target.value)} placeholder="For example: Estimate valid for 14 days. A deposit is due before work begins." /></label></div>
        <div className="line-items"><div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" max="100" step="0.01" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="estimate-total"><span>Preview total</span><strong>${previewTotal.toFixed(2)}</strong><small>Final totals are calculated when the estimate is saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create estimate'}</button></div>
      </form>
    </section></div>}
    {convertTarget && <div className="modal-backdrop" onMouseDown={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}><section className="modal conversion-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Accepted estimate</p><h2>Create the invoice</h2></div><button className="icon-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>×</button></div>
      <div className="conversion-summary"><span>{convertTarget.estimate_number || 'Estimate'}</span><strong>${Number(convertTarget.total).toFixed(2)}</strong><p>{customerName(convertTarget.customers?.[0])}</p></div>
      <form onSubmit={convert} className="conversion-form"><label>Invoice due date<input type="date" value={convertDueDate} onChange={(e) => setConvertDueDate(e.target.value)} /></label><p className="quiet">Finviant Office will copy every line item and tax rate into a new draft invoice. The database recalculates the final invoice total.</p>{error && <p className="form-message error-text">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button></div></form>
    </section></div>}


    {previewTarget && <div className="modal-backdrop estimate-preview-backdrop" onMouseDown={() => setPreviewTarget(null)}>
      <section className="estimate-preview-modal" role="dialog" aria-modal="true" aria-label="Estimate preview" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Customer-facing document</p><h2>Estimate preview</h2></div>
          <button className="icon-button" onClick={() => setPreviewTarget(null)} aria-label="Close preview">×</button>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => window.print()}>Print / Save PDF</button>
          <button type="button" className="secondary-button" onClick={() => setPreviewTarget(null)}>Close</button>
        </div>
        <article className="estimate-preview-document print-document">
          <DocumentBrand business={previewTarget.issuer_snapshot?.name ? { ...business, ...previewTarget.issuer_snapshot, name: previewTarget.issuer_snapshot.name } : business} kind="Estimate" />
          <div className="document-bill-to"><small>Prepared for</small><strong>{customerName(previewTarget.customers?.[0])}</strong>
            {previewTarget.customers?.[0]?.email && <span>{previewTarget.customers[0].email}</span>}
            {previewTarget.customers?.[0]?.phone && <span>{previewTarget.customers[0].phone}</span>}
          </div>
          <div className="invoice-meta">
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
            <div><span>Tax</span><strong>{'$' + Number(previewTarget.tax_amount).toFixed(2)}</strong></div>
            <div className="total"><span>Total</span><strong>{'$' + Number(previewTarget.total).toFixed(2)}</strong></div>
          </div>
          {previewTarget.customer_message && <div className="document-customer-message"><strong>Estimate terms</strong><p>{previewTarget.customer_message}</p></div>}
          {(previewTarget.issuer_snapshot?.name ? previewTarget.issuer_snapshot.document_footer : business.document_footer) && <div className="document-footer">{previewTarget.issuer_snapshot?.name ? previewTarget.issuer_snapshot.document_footer : business.document_footer}</div>}
        </article>
      </section>
    </div>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
