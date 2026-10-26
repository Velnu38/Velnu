import { useEffect, useState } from 'react'
import { getCustomerApproval, submitCustomerApproval } from '../services/approvals'

type ApprovalData = {
  business_name: string
  document_type: 'estimate' | 'change_order'
  document: any
  items: Array<{ description: string; quantity: number; unit_price: number; tax_rate: number; line_total: number }>
  customer: { first_name: string | null; last_name: string | null; company: string | null } | null
  expires_at: string
  completed: { action: 'approved' | 'declined'; typed_name: string; amount: number; created_at: string } | null
}

function customerName(customer: ApprovalData['customer']) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function CustomerApprovalPage({ token }: { token: string }) {
  const [data, setData] = useState<ApprovalData | null>(null)
  const [typedName, setTypedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      setData(await getCustomerApproval(token) as ApprovalData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This approval link is unavailable.')
    }
  }

  useEffect(() => { load() }, [token])

  async function submit(action: 'approved' | 'declined') {
    if (typedName.trim().length < 2) {
      setError('Enter your name before recording your decision.')
      return
    }
    setBusy(true); setError('')
    try {
      await submitCustomerApproval(token, action, typedName)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your decision could not be recorded.')
    } finally { setBusy(false) }
  }

  if (error && !data) return <main className="approval-page"><section className="approval-card approval-error"><div className="logo-mark">V</div><p className="eyebrow">Velnu Office</p><h1>Approval link unavailable</h1><p>{error}</p></section></main>
  if (!data) return <main className="approval-page"><section className="approval-card"><div className="logo-mark">V</div><p>Loading document…</p></section></main>

  const doc = data.document
  const number = data.document_type === 'estimate' ? doc.estimate_number : doc.change_order_number
  const heading = data.document_type === 'estimate' ? 'Estimate approval' : 'Change order approval'
  const approvedVerb = data.document_type === 'estimate' ? 'accepted' : 'approved'

  return <main className="approval-page">
    <section className="approval-card">
      <header className="approval-brand"><div className="logo-mark small">V</div><div><strong>Velnu Office</strong><span>AI-assisted office manager</span></div></header>
      <div className="approval-heading"><p className="eyebrow">{heading}</p><h1>{number || heading}</h1><p>From <strong>{data.business_name}</strong> for {customerName(data.customer)}</p></div>
      {data.document_type === 'change_order' && <section className="approval-scope"><h2>{doc.title}</h2>{doc.job_title && <p><strong>Job:</strong> {doc.job_title}</p>}{doc.description && <p>{doc.description}</p>}{doc.reason && <p><strong>Reason:</strong> {doc.reason}</p>}{doc.schedule_impact_days !== 0 && <div className="schedule-impact"><strong>Schedule impact</strong><span>{doc.schedule_impact_days > 0 ? '+' : ''}{doc.schedule_impact_days} day{Math.abs(doc.schedule_impact_days) === 1 ? '' : 's'}</span>{doc.schedule_note && <small>{doc.schedule_note}</small>}</div>}</section>}
      {doc.customer_message && <p className="customer-message">{doc.customer_message}</p>}
      <section className="approval-items">
        <div className="approval-row approval-row-head"><span>Description</span><span>Qty</span><span>Price</span><span>Total</span></div>
        {data.items.map((item, index) => <div className="approval-row" key={`${item.description}-${index}`}><span>{item.description}{Number(item.tax_rate) ? <small>{Number(item.tax_rate)}% tax</small> : null}</span><span>{Number(item.quantity)}</span><span>${Number(item.unit_price).toFixed(2)}</span><span>${Number(item.line_total).toFixed(2)}</span></div>)}
      </section>
      <section className="approval-totals"><div><span>Subtotal</span><strong>${Number(doc.subtotal).toFixed(2)}</strong></div><div><span>Tax</span><strong>${Number(doc.tax_amount).toFixed(2)}</strong></div><div className="approval-grand-total"><span>Total</span><strong>${Number(doc.total).toFixed(2)}</strong></div></section>
      {data.completed ? <section className={`approval-complete ${data.completed.action}`}><h2>{data.completed.action === 'approved' ? `Document ${approvedVerb}` : 'Document declined'}</h2><p>Recorded for {data.completed.typed_name} on {new Date(data.completed.created_at).toLocaleString()}.</p><p className="quiet">Velnu keeps this decision with the document’s approval history.</p></section> : <section className="approval-decision"><h2>Your decision</h2><p>Enter your name to record your approval or decline of the document and amount shown above.</p><label>Full name<input autoComplete="name" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" /></label>{error && <p className="form-message error-text">{error}</p>}<div className="approval-actions"><button className="secondary-button" disabled={busy} onClick={() => submit('declined')}>Decline</button><button className="primary-button" disabled={busy} onClick={() => submit('approved')}>{busy ? 'Recording…' : data.document_type === 'estimate' ? 'Accept estimate' : 'Approve change order'}</button></div><small className="approval-disclaimer">This records your decision and an audit trail for the contractor. Velnu does not provide legal advice or guarantee legal enforceability.</small></section>}
    </section>
  </main>
}
