import { useEffect, useRef, useState } from 'react'
import { getCustomerApproval, submitCustomerApproval } from '../services/approvals'
import DocumentPdfPreview from '../components/DocumentPdfPreview'
import type { DocumentPdfArtifact } from '../services/documentPdf'

type ApprovalData = {
  business_name: string
  document_type: 'estimate' | 'change_order'
  document: { estimate_number?: string; change_order_number?: string; expires_on?: string }
  customer: { first_name?: string | null; last_name?: string | null; company?: string | null } | null
  expires_at: string | null
  action_state?: string
  action_reason?: string
  completed: { action: 'approved' | 'declined'; typed_name: string; amount: number; created_at: string; terms_agreed?: boolean } | null
}

export default function CustomerApprovalPage({ token }: { token: string }) {
  const submitting = useRef(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ApprovalData | null>(null)
  const [pdf, setPdf] = useState<DocumentPdfArtifact | null>(null)
  const [typedName, setTypedName] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError(''); setLoading(true)
    try { setData(await getCustomerApproval(token) as ApprovalData) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'This approval link is unavailable.') }
    finally { setLoading(false) }
  }
  useEffect(() => { setPdf(null); setTypedName(''); setAgreedToTerms(false); void load() }, [token])

  async function submit(action: 'approved' | 'declined') {
    if (submitting.current || !pdf) return
    if (typedName.trim().length < 2) { setError('Enter your full name before recording your decision.'); return }
    if (action === 'approved' && !agreedToTerms) { setError('Please review the document and agree to the displayed terms before approving.'); return }
    if (action === 'declined' && !window.confirm('Decline this document? This records your decision. Contact the business if you only need a revision.')) return
    submitting.current = true; setBusy(true); setError('')
    try {
      await submitCustomerApproval(token, action, typedName, action === 'approved' && agreedToTerms, pdf.revisionId || undefined)
      await load()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your decision could not be recorded.') }
    finally { submitting.current = false; setBusy(false) }
  }
  if (error && !data) return <main className="share-document"><section className="customer-document-live"><h1>Approval link unavailable</h1><p role="alert">{error}</p><button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Retrying…' : 'Retry loading document'}</button><p>Reply to the issuing business if this approval was replaced or revoked.</p></section></main>
  if (!data) return <main className="share-document" role="status">Opening your document…</main>
  const estimate = data.document_type === 'estimate'
  const label = estimate ? 'Estimate' : 'Change order'
  const number = estimate ? data.document.estimate_number : data.document.change_order_number
  const customer = [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ') || data.customer?.company || 'Customer'
  const available = !data.action_state || data.action_state === 'available'
  return <main className="share-document">
    <header><p className="eyebrow">Secure customer approval</p><h1>{label} {number}</h1><p>From <strong>{data.business_name}</strong> for {customer}</p></header>
    <DocumentPdfPreview source={{ token, tokenType: 'approval' }} title={`${label} ${number || ''}`} onReady={setPdf} />
    <section className="customer-document-live">
      {data.completed ? <><h2>{data.completed.action === 'approved' ? label + (estimate ? ' accepted' : ' approved') : label + ' declined'}</h2><p>Recorded for {data.completed.typed_name} on {new Date(data.completed.created_at).toLocaleString()}.</p><p className="quiet">Your decision is recorded against this issued document version and amount. You can keep its PDF for your records.</p></>
        : !available ? <><h2>Approval is unavailable</h2><p>{data.action_reason || 'This document is available for your records. Contact the business to discuss its current status.'}</p></>
        : <>
          <h2>{estimate ? 'Accept or decline this estimate' : 'Approve or decline this change order'}</h2>
          <p>Review the complete PDF above. Enter your name and confirm the terms to approve this version.</p>
          <label>Full name<input autoComplete="name" value={typedName} disabled={busy} onChange={event => setTypedName(event.target.value)} placeholder="Your full name" /></label>
          <label className="approval-consent"><input type="checkbox" checked={agreedToTerms} disabled={busy} onChange={event => { setAgreedToTerms(event.target.checked); setError('') }} /><span>I reviewed the displayed {label.toLowerCase()}, including its scope, prices, taxes, total, dates, and terms. I agree to those terms and authorize {data.business_name} to proceed with this work.</span></label>
          {!pdf && <p role="status">Open the finished PDF before recording your decision.</p>}
          {error && <p role="alert" className="error-text">{error}</p>}
          <div className="personal-delivery-actions"><button type="button" className="secondary-button" disabled={busy || !pdf} onClick={() => void submit('declined')}>Decline {label.toLowerCase()}</button><button type="button" className="primary-button" disabled={busy || !pdf || !agreedToTerms} onClick={() => void submit('approved')}>{busy ? 'Recording…' : estimate ? 'Accept estimate and agree to terms' : 'Approve change order and agree to terms'}</button></div>
          <p className="quiet">Approval records your name, decision, time, and document version. It does not make a payment.</p>
        </>}
    </section>
  </main>
}
