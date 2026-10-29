import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getCurrentBusiness, type CurrentBusiness } from './lib/business'
import { hasAcceptedAgreement } from './lib/userAgreement'
import { getPlanPreference, type PlanTier } from './lib/plans'
import PlanSelection from './components/PlanSelection'
import AuthScreen from './components/AuthScreen'
import PasswordRecovery from './components/PasswordRecovery'
import BusinessOnboarding from './components/BusinessOnboarding'
import AppShell from './components/AppShell'
import AccountAgreement from './components/AccountAgreement'
import CustomerApprovalPage from './pages/CustomerApprovalPage'
import LandingPage from './pages/LandingPage'
import InstallPage from './pages/InstallPage'
import LegalPage from './pages/LegalPage'

const initialQuery = new URLSearchParams(window.location.search)
const initialHash = new URLSearchParams(window.location.hash.slice(1))
const initialRecovery = initialQuery.get('recovery') === '1' || initialHash.get('type') === 'recovery'
const invalidAuthLink = initialHash.has('error') || initialQuery.has('error')
const initialAuthMode = initialQuery.get('mode') === 'signup' ? 'signup' : 'signin'
export default function App() {
  const publicPath = window.location.pathname
  const approvalToken = initialQuery.get('approval')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovery, setRecovery] = useState(initialRecovery)
  const [planStatus, setPlanStatus] = useState<'checking' | 'needed' | 'selected'>('checking')
  const [selectedTier, setSelectedTier] = useState<PlanTier | null>(null)
  const [planRequested, setPlanRequested] = useState(publicPath === '/plans' || initialQuery.get('next') === 'plans')
  const [agreementStatus, setAgreementStatus] = useState<'checking' | 'needed' | 'accepted'>('checking')
  const [business, setBusiness] = useState<CurrentBusiness | null>(null)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [authError, setAuthError] = useState('')
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (approvalToken || ['/legal', '/terms', '/privacy', '/services', '/install'].includes(publicPath)) return
    let active = true
    let eventReceived = false
    // Keep the auth callback synchronous to avoid holding the session lock.
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
      setAuthError('Unable to check your session. Reload and try again.')
      setAuthReady(true)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [approvalToken])

  // Step 1: fetch the user's plan preference. This is not a paid entitlement.
  useEffect(() => {
    let active = true
    setBusiness(null)
    setLoadedUserId(null)
    setError('')
    setSelectedTier(null)
    setPlanStatus('checking')
    setAgreementStatus('checking')
    if (!userId || recovery || approvalToken) return () => { active = false }
    void getPlanPreference(userId).then(tier => {
      if (!active) return
      setSelectedTier(tier)
      setPlanStatus(tier ? 'selected' : 'needed')
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Unable to load your service tier.')
    })
    return () => { active = false }
  }, [userId, recovery, approvalToken])

  // Step 2: check the current combined agreement after a tier exists.
  useEffect(() => {
    let active = true
    setAgreementStatus('checking')
    if (!userId || recovery || approvalToken || planStatus !== 'selected') return () => { active = false }
    void hasAcceptedAgreement(userId).then(accepted => {
      if (active) setAgreementStatus(accepted ? 'accepted' : 'needed')
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Unable to verify your user agreement.')
    })
    return () => { active = false }
  }, [userId, recovery, approvalToken, planStatus])

  // Step 3: only load the company workspace after terms have been accepted.
  useEffect(() => {
    let active = true
    if (!userId || recovery || agreementStatus !== 'accepted' || planStatus !== 'selected' || approvalToken) return () => { active = false }
    void getCurrentBusiness().then(next => {
      if (active) setBusiness(next)
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Unable to load your Finviant Office workspace')
    }).finally(() => {
      if (active) setLoadedUserId(userId)
    })
    return () => { active = false }
  }, [userId, agreementStatus, planStatus, recovery, approvalToken])

  function savePlanChoice(tier: PlanTier) {
    setSelectedTier(tier)
    setPlanStatus('selected')
    setPlanRequested(false)
    if (window.location.pathname === '/plans' || window.location.search.includes('next=plans')) {
      window.history.replaceState({}, '', '/')
    }
  }

  function finishRecovery() {
    window.history.replaceState({}, '', '/auth?mode=signin')
    setRecovery(false)
  }

  if (approvalToken) return <CustomerApprovalPage token={approvalToken} />
  if (['/legal', '/terms', '/privacy'].includes(publicPath)) return <LegalPage />
  if (publicPath === '/services') return <LandingPage />
  if (publicPath === '/install') return <InstallPage />
  if (!authReady) return <main className="loading-page"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><p>Opening Finviant Office…</p></main>
  if (recovery) return <PasswordRecovery session={session} invalidLink={invalidAuthLink} onDone={finishRecovery} />
  if (!session) {
    if (publicPath === '/auth' || publicPath === '/plans' || invalidAuthLink) {
      return <AuthScreen initialMode={initialAuthMode} initialMessage={authError || (invalidAuthLink ? 'This account link is invalid or expired. Sign in or request a new password-reset link.' : '')} />
    }
    return <LandingPage />
  }
  if (error) return <main className="loading-page"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><h2>We couldn’t open your workspace.</h2><p>{error}</p><button className="secondary-button" onClick={() => location.reload()}>Try again</button><button className="text-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></main>
  if (planStatus === 'checking') return <main className="loading-page"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><p>Checking your service tier…</p></main>
  if (planStatus === 'needed' || planRequested) return <PlanSelection
    userId={session.user.id} email={session.user.email ?? 'your account'} currentTier={selectedTier}
    onSelected={savePlanChoice} onSignOut={() => void supabase.auth.signOut()}
  />
  if (agreementStatus === 'checking') return <main className="loading-page"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><p>Checking your agreement…</p></main>
  if (agreementStatus === 'needed') return <AccountAgreement
    userId={session.user.id} email={session.user.email ?? 'your account'} selectedTier={selectedTier!}
    onAccepted={() => setAgreementStatus('accepted')}
    onSignOut={() => void supabase.auth.signOut()}
  />
  if (loadedUserId !== userId) return <main className="loading-page"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><p>Opening your workspace…</p></main>
  if (!business) return <BusinessOnboarding onCreated={setBusiness} />
  return <AppShell business={business} />
}
