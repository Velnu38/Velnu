import { useEffect, useState } from 'react'
import { getCustomerApproval, submitCustomerApproval } from '../services/approvals'
import DocumentBrand from '../components/DocumentBrand'
import type { BusinessProfile } from '../lib/business'

type ApprovalData = {
  business_name: string
  business_profile?: Partial<BusinessProfile> | null
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
  const [agreedToTerms, setAgreedToTerms] = useState(false)
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
    if (action === 'approved' && data?.document_type === 'estimate' && !agreedToTerms) {
      setError('Please review the estimate and check the agreement box before accepting.')
      return
    }
    setBusy(true); setError('')
    try {
      await submitCustomerApproval(token, action, typedName, action === 'approved' && data?.document_type === 'estimate' && agreedToTerms)
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
      <DocumentBrand business={{ ...data.business_profile, name: data.business_name }} kind={data.document_type === 'estimate' ? 'Estimate' : 'Preview'} />
      <p className="approval-powered">Secure customer approval · Powered by Velnu</p>
      <div className="approval-heading"><p className="eyebrow">{heading}</p><h1>{number || heading}</h1><p>From <strong>{data.business_name}</strong> for {customerName(data.customer)}</p></div>
      {data.document_type === 'change_order' && <section className="approval-scope"><h2>{doc.title}</h2>{doc.job_title && <p><strong>Job:</strong> {doc.job_title}</p>}{doc.description && <p>{doc.description}</p>}{doc.reason && <p><strong>Reason:</strong> {doc.reason}</p>}{doc.schedule_impact_days !== 0 && <div className="schedule-impact"><strong>Schedule impact</strong><span>{doc.schedule_impact_days > 0 ? '+' : ''}{doc.schedule_impact_days} day{Math.abs(doc.schedule_impact_days) === 1 ? '' : 's'}</span>{doc.schedule_note && <small>{doc.schedule_note}</small>}</div>}</section>}
      {doc.customer_message && data.document_type !== 'estimate' && <p className="customer-message">{doc.customer_message}</p>}
      <section className="approval-items">
        <div className="approval-row approval-row-head"><span>Description</span><span>Qty</span><span>Price</span><span>Total</span></div>
        {data.items.map((item, index) => <div className="approval-row" key={`${item.description}-${index}`}><span>{item.description}{Number(item.tax_rate) ? <small>{Number(item.tax_rate)}% tax</small> : null}</span><span>{Number(item.quantity)}</span><span>${Number(item.unit_price).toFixed(2)}</span><span>${Number(item.line_total).toFixed(2)}</span></div>)}
      </section>
      <section className="approval-totals"><div><span>Subtotal</span><strong>${Number(doc.subtotal).toFixed(2)}</strong></div><div><span>Tax</span><strong>${Number(doc.tax_amount).toFixed(2)}</strong></div><div className="approval-grand-total"><span>Total</span><strong>${Number(doc.total).toFixed(2)}</strong></div></section>
      {data.document_type === 'estimate' && <section className="estimate-terms" aria-label="Estimate terms">
        <h2>Estimate terms</h2>
        <p>The services, quantities, prices, tax, and total shown above describe the work being offered.</p>
        {doc.expires_on && <p><strong>Estimate valid through:</strong> {new Date(doc.expires_on + 'T00:00:00').toLocaleDateString()}</p>}
        {doc.customer_message && <div className="estimate-customer-terms"><strong>Additional terms from {data.business_name}</strong><p>{doc.customer_message}</p></div>}
      </section>}
      {data.business_profile?.document_footer && <p className="document-footer">{data.business_profile.document_footer}</p>}
      {data.completed ? <section className={`approval-complete ${data.completed.action}`}><h2>{data.completed.action === 'approved' ? `Document ${approvedVerb}` : 'Document declined'}</h2><p>Recorded for {data.completed.typed_name} on {new Date(data.completed.created_at).toLocaleString()}.</p><p className="quiet">{data.document_type === 'estimate' && data.completed.action === 'approved' ? 'Agreement to the displayed estimate terms was recorded with the document and amount at acceptance.' : 'This decision is recorded with the document’s approval history.'}</p></section> :
      <section className="approval-decision">
        <h2>{data.document_type === 'estimate' ? 'Accept or decline this estimate' : 'Your decision'}</h2>
        <p>Review the scope and total above. Enter your full name to identify your decision.</p>
        <label>Full name<input autoComplete="name" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" /></label>
        {data.document_type === 'estimate' && <label className="approval-consent">
          <input type="checkbox" checked={agreedToTerms} onChange={(e) => { setAgreedToTerms(e.target.checked); setError('') }} />
          <span>I have reviewed the estimate, including the scope of work, prices, taxes, total amount, validity date, and any additional terms shown above. I agree to these terms and authorize {data.business_name} to proceed with the quoted work.</span>
        </label>}
        {error && <p className="form-message error-text" role="alert">{error}</p>}
        <div className="approval-actions"><button className="secondary-button" disabled={busy} onClick={() => submit('declined')}>Decline</button><button className="primary-button" disabled={busy || (data.document_type === 'estimate' && !agreedToTerms)} onClick={() => submit('approved')}>{busy ? 'Recording…' : data.document_type === 'estimate' ? 'Accept estimate and agree to terms' : 'Approve change order'}</button></div>
        <small className="approval-disclaimer">Accepting records your name, decision, time, and a snapshot of the quoted work and agreement. This is not a payment. Velnu does not provide legal advice or guarantee legal enforceability.</small>
      </section>}
    </section>
  </main>
}
