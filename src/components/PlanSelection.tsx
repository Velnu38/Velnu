import { useState } from 'react'
import { savePlanPreference, type PlanTier } from '../lib/plans'
import PrivateBetaNotice from './PrivateBetaNotice'

export default function PlanSelection({ userId, email, currentTier, onSelected, onSignOut }: {
  userId: string
  email: string
  currentTier: PlanTier | null
  onSelected: (tier: PlanTier) => void
  onSignOut: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function continueToTesting() {
    if (busy) return
    setBusy(true)
    setError('')
    const tier = currentTier ?? 'free'
    try {
      await savePlanPreference(userId, tier)
      onSelected(tier)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the test workspace. Please try again.')
    } finally { setBusy(false) }
  }

  return <main className="plan-pick-page">
    <header className="plan-pick-header">
      <a className="marketing-brand" href="/"><span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span><strong>Finviant<span className="brand-dot">.</span></strong></a>
      <button type="button" className="text-button" onClick={onSignOut}>Sign out</button>
    </header>
    <div className="plan-pick-content private-testing-gate">
      <div className="plan-pick-intro">
        <p className="marketing-section-kicker">PRIVATE TESTING</p>
        <h1>Welcome to Finviant Office testing.</h1>
        <p>Signed in as <strong>{email}</strong>. Continue to your test workspace when you are ready.</p>
      </div>
      <PrivateBetaNotice />
      {error && <p className="form-message error-text" role="alert">{error}</p>}
      <button type="button" className="marketing-btn marketing-btn-dark" disabled={busy} onClick={() => void continueToTesting()}>
        {busy ? 'Opening your test workspace…' : 'Continue to private testing'} <span aria-hidden="true">↗</span>
      </button>
    </div>
  </main>
}
