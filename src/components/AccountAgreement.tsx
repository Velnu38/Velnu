import { useState } from 'react'
import { acceptAgreement } from '../lib/userAgreement'
import { AGREEMENT_EFFECTIVE_DATE, termsSections } from '../legal/agreement'

export default function AccountAgreement({ userId, email, onAccepted, onSignOut }: {
  userId: string
  email: string
  onAccepted: () => void
  onSignOut: () => void
}) {
  const [agree, setAgree] = useState(false)
  const [ai, setAi] = useState(false)
  const [electronic, setElectronic] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function accept() {
    if (!agree || !ai || !electronic || busy) return
    setBusy(true)
    setError('')
    try {
      await acceptAgreement(userId)
      onAccepted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance. Try again.')
    } finally { setBusy(false) }
  }

  return <main className="agreement-gate">
    <div className="agreement-panel">
      <header className="agreement-header">
        <div><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>Velnu</strong></a>
          <p className="eyebrow">One more step before your workspace</p>
          <h1>Review and accept the Velnu user agreement</h1>
          <p>Signed in as {email}. The agreement applies to your use of Velnu and to users you authorize to act for your business.</p>
        </div>
        <button type="button" className="text-button" onClick={onSignOut}>Not my account? Sign out</button>
      </header>
      <section className="agreement-ai-notice">
        <strong>Important: Velnu uses artificial intelligence.</strong>
        <p>Voice recordings, transcripts, requests, and relevant business information may be processed by third-party AI providers when you use AI tools. AI-generated invoices, estimates, amounts, dates, and advice can be wrong. You must review all results, and your business must obtain any legally required employee or customer notices and recording permissions.</p>
      </section>
      <div className="agreement-reading" tabIndex={0} role="region" aria-label="Scroll to read the Velnu user agreement">
        <p className="legal-meta">Effective {AGREEMENT_EFFECTIVE_DATE} · Private preview legal draft</p>
        {termsSections.map(section => <section key={section.title} className="legal-section">
          <h2>{section.title}</h2>{section.paragraphs.map((p,i)=><p key={i}>{p}</p>)}
        </section>)}
      </div>
      <p className="agreement-read-copy">You can <a href="/terms" target="_blank" rel="noopener noreferrer">open or print the full agreement</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">read the privacy notice</a> before deciding.</p>
      <div className="agreement-consents">
        <label><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} /><span>I have read and agree to the Velnu Business User Agreement, including permitted-use responsibilities and legally limited liability provisions.</span></label>
        <label><input type="checkbox" checked={ai} onChange={e=>setAi(e.target.checked)} /><span>I understand that Velnu uses AI and may send audio, transcripts, and relevant business information to an AI provider. I understand the risks of incorrect AI output and my obligation to check it.</span></label>
        <label><input type="checkbox" checked={electronic} onChange={e=>setElectronic(e.target.checked)} /><span>I agree to receive these account terms and Velnu account notices electronically and understand that I may save or print them.</span></label>
      </div>
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      <div className="agreement-actions"><button type="button" className="secondary-button" onClick={onSignOut} disabled={busy}>Decline & sign out</button><button className="primary-button" type="button" disabled={busy||!agree||!ai||!electronic} onClick={accept}>{busy?'Saving your acceptance…':'I agree · Continue to Velnu'}</button></div>
      <p className="agreement-small">Your acceptance is recorded with your account, the agreement version, and a server timestamp. No charges are authorized by accepting.</p>
    </div>
  </main>
}
