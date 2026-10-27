/**
 * Velnu opt-in product analytics.
 *
 * No SDK network activity before an explicit analytics opt-in. Only predefined,
 * content-free events are allowed. Never include customer, employee or business
 * names, voice/audio/transcripts, document identifiers, financial amounts, URLs,
 * or email addresses.
 */
export const ANALYTICS_CONSENT_KEY = 'velnu_analytics_consent_v1'
export type AnalyticsConsent = 'accepted' | 'declined' | null

const token = (import.meta.env.VITE_POSTHOG_KEY || '').trim()
const configuredHost = (import.meta.env.VITE_POSTHOG_HOST || '').trim()
const host = ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(configuredHost)
  ? configuredHost
  : 'https://us.i.posthog.com'

export type AnalyticsEvent =
  | 'landing_page_viewed'
  | 'signup_page_viewed'
  | 'signup_started'
  | 'login_completed'
  | 'company_setup_completed'
  | 'workspace_viewed'
  | 'invoice_draft_created'
  | 'estimate_draft_created'
  | 'manual_payment_recorded'
  | 'voice_transcription_completed'
  | 'voice_transcription_failed'
  | 'assistant_command_submitted'
  | 'agreement_accepted'
  | 'analytics_enabled'

const allowedEvents = new Set<AnalyticsEvent>([
  'landing_page_viewed',
  'signup_page_viewed',
  'signup_started',
  'login_completed',
  'company_setup_completed',
  'workspace_viewed',
  'invoice_draft_created',
  'estimate_draft_created',
  'manual_payment_recorded',
  'voice_transcription_completed',
  'voice_transcription_failed',
  'assistant_command_submitted',
  'agreement_accepted',
  'analytics_enabled',
])

// Only minimal SDK bookkeeping fields needed to record consented, anonymous
// product events. No URL, search query, referrer, user ID or business ID.
const allowedProperties = new Set([
  'token', 'distinct_id', '$device_id', '$session_id', '$lib', '$lib_version',
])

type PosthogClient = typeof import('posthog-js').default
let client: PosthogClient | null = null
let initializing: Promise<PosthogClient | null> | null = null

export function analyticsConfigured(): boolean {
  return token.startsWith('phc_') && token.length > 8
}

export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY)
    return stored === 'accepted' || stored === 'declined' ? stored : null
  } catch {
    return null
  }
}

function canCapture(): boolean {
  return analyticsConfigured() && getAnalyticsConsent() === 'accepted'
}

async function ensureClient(): Promise<PosthogClient | null> {
  if (!canCapture()) return null
  if (client) return client
  if (initializing) return initializing

  initializing = import('posthog-js').then(({ default: posthog }) => {
    if (!canCapture()) return null
    posthog.init(token, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      opt_out_capturing_by_default: true,
      person_profiles: 'never',
      before_send: (event) => {
        if (!event || !allowedEvents.has(event.event as AnalyticsEvent)) return null
        // Reject any properties added automatically or by future SDK changes.
        event.properties = Object.fromEntries(
          Object.entries(event.properties || {}).filter(([name]) => allowedProperties.has(name))
        )
        return event
      },
    })
    if (!canCapture()) return null
    posthog.opt_in_capturing({ captureEventName: false })
    client = posthog
    return posthog
  }).catch(() => null).finally(() => {
    initializing = null
  })
  return initializing
}

/** Called once at startup; does nothing unless the visitor opted in earlier. */
export function initializeAnalytics(): void {
  if (canCapture()) void ensureClient()
}

/** Manual event names only; no free-form event properties. */
export function trackEvent(event: AnalyticsEvent): void {
  if (!allowedEvents.has(event) || !canCapture()) return
  void ensureClient().then((posthog) => {
    if (posthog && canCapture()) posthog.capture(event)
  })
}

export function chooseAnalyticsConsent(consent: Exclude<AnalyticsConsent, null>): void {
  try { window.localStorage.setItem(ANALYTICS_CONSENT_KEY, consent) }
  catch { /* Storage is optional; fail closed when blocked. */ }
  window.dispatchEvent(new Event('velnu-analytics-consent-changed'))
  if (consent === 'declined') {
    client?.opt_out_capturing()
    // Avoid linking an opted-out user's later activity to a previous ID.
    client?.reset()
    client = null
  } else if (canCapture()) {
    void ensureClient().then((posthog) => {
      if (posthog && canCapture()) {
        posthog.opt_in_capturing({ captureEventName: false })
        posthog.capture('analytics_enabled')
      }
    })
  }
}
