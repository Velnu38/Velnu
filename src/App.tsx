import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getCurrentBusiness, type CurrentBusiness } from './lib/business'
import AuthScreen from './components/AuthScreen'
import PasswordRecovery from './components/PasswordRecovery'
import BusinessOnboarding from './components/BusinessOnboarding'
import AppShell from './components/AppShell'
import CustomerApprovalPage from './pages/CustomerApprovalPage'

const initialQuery = new URLSearchParams(window.location.search)
const initialHash = new URLSearchParams(window.location.hash.slice(1))
const initialRecovery = initialQuery.get('recovery') === '1' || initialHash.get('type') === 'recovery'
const invalidAuthLink = initialHash.has('error') || initialQuery.has('error')

export default function App() {
  const approvalToken = initialQuery.get('approval')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovery, setRecovery] = useState(initialRecovery)
  const [business, setBusiness] = useState<CurrentBusiness | null>(null)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [authError, setAuthError] = useState('')
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (approvalToken) return
    let active = true
    let eventReceived = false
    // Keep this callback synchronous. Awaiting a Supabase call here can hold
    // the auth lock and prevent workspace loading or token refresh completing.
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      eventReceived = true
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true)
        const url = new URL(window.location.href)
        url.searchParams.set('recovery', '1')
        url.hash = ''
        window.history.replaceState({}, '', url.pathname + url.search)
      }
      setSession(nextSession)
      setAuthError('')
      setAuthReady(true)
    })
    void supabase.auth.getSession().then(({ data: current, error: sessionError }) => {
      if (!active || eventReceived) return
      setSession(current.session)
      if (sessionError) setAuthError(sessionError.message)
      setAuthReady(true)
    }).catch(() => {
      if (!active || eventReceived) return
      setAuthError('Unable to check your session. Please reload and try again.')
      setAuthReady(true)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [approvalToken])

  useEffect(() => {
    let active = true
    setBusiness(null)
    setLoadedUserId(null)
    setError('')
    if (!userId || recovery || approvalToken) return () => { active = false }
    void getCurrentBusiness().then(next => {
      if (active) setBusiness(next)
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Unable to load your Velnu workspace')
    }).finally(() => {
      if (active) setLoadedUserId(userId)
    })
    return () => { active = false }
  }, [userId, recovery, approvalToken])

  function finishRecovery() {
    window.history.replaceState({}, '', window.location.pathname)
    setRecovery(false)
  }

  if (approvalToken) return <CustomerApprovalPage token={approvalToken} />
  if (!authReady) return <main className="loading-page"><div className="logo-mark">V</div><p>Opening Velnu…</p></main>
  if (recovery) return <PasswordRecovery session={session} invalidLink={invalidAuthLink} onDone={finishRecovery} />
  if (!session) return <AuthScreen initialMessage={authError || (invalidAuthLink ? 'This account link is invalid or expired. Sign in or request a new password-reset link.' : '')} />
  if (loadedUserId !== userId) return <main className="loading-page"><div className="logo-mark">V</div><p>Opening your workspace…</p></main>
  if (error) return <main className="loading-page"><div className="logo-mark">V</div><h2>We couldn’t open your workspace.</h2><p>{error}</p><button className="secondary-button" onClick={() => location.reload()}>Try again</button></main>
  if (!business) return <BusinessOnboarding onCreated={setBusiness} />
  return <AppShell business={business} />
}
