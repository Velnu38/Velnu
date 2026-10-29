import { useEffect, useState } from 'react'
import { analyticsConfigured, chooseAnalyticsConsent, getAnalyticsConsent, type AnalyticsConsent } from '../lib/analytics'

export default function AnalyticsConsent() {
  const [choice, setChoice] = useState<AnalyticsConsent>(() => getAnalyticsConsent())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const enabled = analyticsConfigured()

  useEffect(() => {
    const changed = () => setChoice(getAnalyticsConsent())
    window.addEventListener('velnu-analytics-consent-changed', changed)
    return () => window.removeEventListener('velnu-analytics-consent-changed', changed)
  }, [])

  if (!enabled) return null

  function select(value: 'accepted' | 'declined') {
    chooseAnalyticsConsent(value)
    setChoice(value)
    setSettingsOpen(false)
  }

  if (choice !== null && !settingsOpen) return null

  return <section role="region" aria-label="Optional analytics preferences" className="analytics-consent ph-no-capture">
    <div>
      <strong>{settingsOpen ? 'Analytics preferences' : 'Help improve Finviant Office?'}</strong>
      <p>With your permission, we use PostHog to count visits and understand which Finviant Office features are used. We do not use session replay or automatic click tracking, and do not send invoice details, customer names, or voice recordings. Analytics are optional.</p>
      <a href="/privacy" target="_blank" rel="noopener noreferrer">Read our privacy notice</a>
    </div>
    <div className="analytics-consent-actions">
      <button type="button" className="secondary-button compact" onClick={() => select('declined')}>Decline analytics</button>
      <button type="button" className="primary-button compact" onClick={() => select('accepted')}>Allow analytics</button>
    </div>
  </section>
}

export function AnalyticsSettingsButton() {
  const [choice, setChoice] = useState<AnalyticsConsent>(() => getAnalyticsConsent())
  const enabled = analyticsConfigured()
  useEffect(() => {
    const changed = () => setChoice(getAnalyticsConsent())
    window.addEventListener('velnu-analytics-consent-changed', changed)
    return () => window.removeEventListener('velnu-analytics-consent-changed', changed)
  }, [])
  if (!enabled) return <p className="quiet">Optional PostHog analytics are not configured on this preview.</p>
  return <div className="analytics-settings">
    <p>Optional analytics: <strong>{choice === 'accepted' ? 'Allowed' : choice === 'declined' ? 'Declined' : 'Not selected'}</strong>.</p>
    <button type="button" className="secondary-button compact" onClick={() => chooseAnalyticsConsent('declined')}>Turn off analytics</button>
    <button type="button" className="secondary-button compact" onClick={() => chooseAnalyticsConsent('accepted')}>Allow analytics</button>
  </div>
}
