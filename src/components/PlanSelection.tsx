import { useState } from 'react'
import { planOptions, savePlanPreference, type PlanTier } from '../lib/plans'

export default function PlanSelection({ userId, email, currentTier, onSelected, onSignOut }: {
  userId: string
  email: string
  currentTier: PlanTier | null
  onSelected: (tier: PlanTier) => void
  onSignOut: () => void
}) {
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null)
  const [error, setError] = useState('')

  async function choose(tier: PlanTier) {
    if (busyTier) return
    setBusyTier(tier)
    setError('')
    try {
      await savePlanPreference(userId, tier)
      onSelected(tier)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your plan. Please try again.')
    } finally { setBusyTier(null) }
  }

  return <main className="plan-pick-page">
    <header className="plan-pick-header">
      <a className="marketing-brand" href="/"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a>
      <button type="button" className="text-button" onClick={onSignOut}>Sign out</button>
    </header>
    <div className="plan-pick-content">
      <div className="plan-pick-intro">
        <p className="marketing-section-kicker">STEP 1 OF 2 · YOUR VELNU ACCOUNT</p>
        <h1>Choose how you want to use Velnu.</h1>
        <p>Signed in as <strong>{email}</strong>. Choose Free, Basic, or Pro. You'll review one combined user agreement, AI disclosure, and privacy notice immediately afterward.</p>
      </div>
      <section className="plan-pick-grid" aria-label="Choose your service tier">
        {planOptions.map(plan => <article key={plan.tier} className={'plan-pick-card' + (plan.tier === 'basic' ? ' plan-pick-featured' : '')}>
          <div className="plan-pick-card-heading">
            <div><span className="plan-pick-status">{plan.status}</span><h2>{plan.name}</h2><p>{plan.subtitle}</p></div>
            {currentTier === plan.tier && <span className="plan-pick-current">Your current choice</span>}
          </div>
          <strong className="plan-pick-price">{plan.price}</strong>
          <ul>{plan.features.map(feature => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
          <button type="button" className={'marketing-btn ' + (plan.tier === 'basic' ? 'marketing-btn-accent' : 'marketing-btn-dark')}
            disabled={Boolean(busyTier)} onClick={() => void choose(plan.tier)}>
            {busyTier === plan.tier ? 'Saving your choice…' : currentTier === plan.tier ? 'Continue with ' + plan.name : 'Select ' + plan.name}
            <span aria-hidden="true">↗</span>
          </button>
        </article>)}
      </section>
      {error && <p className="form-message error-text" role="alert">{error}</p>}
      <div className="plan-pick-notice">
        <strong>Your choice is a preference, not a purchase.</strong>
        <p>Free has 0 customer online acceptances and 0 metered AI, email, SMS or payment-service actions. Basic ($9.99/month) and Pro ($24.99/month) pricing and allowances are proposed, not available for purchase yet. Selecting either does not activate paid functionality, start a subscription, or authorize a charge. All private-beta capabilities remain subject to testing and release controls.</p>
        <p>Looking for extra services à la carte? You can explore optional services under <strong>My services</strong> after entering your workspace. Proposed extras include 100 AI credits for $4.99, 500 AI credits for $17.99, 1 GB storage for $1.99/month, or 5 GB for $4.99/month. Purchases are not active.</p>
      </div>
    </div>
  </main>
}
