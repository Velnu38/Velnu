import { useState } from 'react'
import { acceptAgreement } from '../lib/userAgreement'
import { AGREEMENT_EFFECTIVE_DATE, AGREEMENT_VERSION, agreementSections } from '../legal/agreement'
import type { PlanTier } from '../lib/plans'

export default function AccountAgreement({ userId, email, selectedTier, onChangeTier, onAccepted, onSignOut }: {
  userId: string
  email: string
  selectedTier: PlanTier
  onChangeTier: () => void
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
      await acceptAgreement(userId, selectedTier)
      onAccepted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance. Try again.')
    } finally { setBusy(false) }
  }

  return <main className="agreement-gate">
    <div className="agreement-panel">
      <header className="agreement-header">
        <div><a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>Velnu</strong></a>
          <p className="eyebrow">STEP 2 OF 2 · ONE COMBINED AGREEMENT</p>
          <h1>Review your User Agreement, AI Disclosure & Privacy Notice</h1>
          <p>Signed in as {email}. Selected tier: <strong>{selectedTier.toUpperCase()}</strong>. <button type="button" className="text-button" onClick={onChangeTier}>Change tier</button>. Please read the combined agreement before entering your workspace.</p>
        </div>
        <button type="button" className="text-button" onClick={onSignOut}>Not my account? Sign out</button>
      </header>
      <section className="agreement-ai-notice">
        <strong>Important: Velnu uses artificial intelligence.</strong>
        <p>Voice recordings, transcripts, requests, and relevant business information may be processed by third-party AI providers when you use AI tools. AI-generated invoices, estimates, amounts, dates, and advice can be wrong. You must review all results, and your business must obtain any legally required employee or customer notices and recording permissions.</p>
      </section>
      <div className="agreement-reading" tabIndex={0} role="region" aria-label="Scroll to read the complete Velnu agreement including privacy and AI">
        <p className="legal-meta">Version {AGREEMENT_VERSION} · Effective {AGREEMENT_EFFECTIVE_DATE} · Includes business terms, AI disclosure, and privacy/data handling</p>
        {agreementSections.map(section => <section key={section.title} className="legal-section">
          <h2>{section.title}</h2>{section.paragraphs.map((p,i)=><p key={i}>{p}</p>)}
        </section>)}
      </div>
      <p className="agreement-read-copy">You can <a href="/legal" target="_blank" rel="noopener noreferrer">read, save, or print the complete agreement</a> (including the AI and privacy provisions) before accepting.</p>
      <div className="agreement-consents">
        <label><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} /><span>I have reviewed and agree to the complete Velnu User Agreement, including the AI notice, privacy provisions, business responsibilities, and lawful limitations of liability.</span></label>
        <label><input type="checkbox" checked={ai} onChange={e=>setAi(e.target.checked)} /><span>I understand that Velnu uses AI and may send audio, transcripts, and relevant business information to an AI provider. I understand the risks of incorrect AI output and my obligation to check it.</span></label>
        <label><input type="checkbox" checked={electronic} onChange={e=>setElectronic(e.target.checked)} /><span>I agree to receive these account terms and Velnu account notices electronically and understand that I may save or print them.</span></label>
      </div>
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      <div className="agreement-actions"><button type="button" className="secondary-button" onClick={onSignOut} disabled={busy}>Decline & sign out</button><button className="primary-button" type="button" disabled={busy||!agree||!ai||!electronic} onClick={accept}>{busy?'Saving your acceptance…':'I agree · Continue to Velnu'}</button></div>
      <p className="agreement-small">Your chosen {selectedTier.toUpperCase()} tier, agreement version, and acceptance are recorded with a server timestamp. Basic and Pro are preferences only, not paid subscriptions; accepting does not authorize charges.</p>
    </div>
  </main>
}
