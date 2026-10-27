import { type FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'reset'

export default function AuthScreen({ initialMode = 'signin', initialMessage = '' }: { initialMode?: Mode; initialMessage?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(initialMessage)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setPassword('')
    setMessage('')
    setAwaitingConfirmation(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const address = email.trim()
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/?recovery=1`,
        })
        if (error) throw error
        setMessage('If an account exists for this email, a password-reset link will be sent. Check your inbox and spam folder.')
        return
      }
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: address, password })
        : await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: `${window.location.origin}/` } })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) {
        setAwaitingConfirmation(true)
        setMessage('Your account is pending email confirmation. Open the newest confirmation email and follow its link before signing in. Check spam if needed.')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to connect. Please try again.'
      setMessage(mode === 'signin' && /invalid login credentials/i.test(detail)
        ? 'Sign-in failed. If you just registered, confirm your email first. Otherwise, check your email and password.'
        : detail)
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    if (busy) return
    const address = email.trim()
    if (!address || !address.includes('@')) {
      setMessage('Enter your email address above first.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: `${window.location.origin}/` },
      })
      if (error) throw error
      setAwaitingConfirmation(true)
      setMessage('If your account is waiting for confirmation, a new email has been requested. Check your inbox and spam folder before trying to sign in.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to request a new email.'
      setMessage(/rate limit|only request this after|too many requests/i.test(detail)
        ? 'Please wait a little before requesting another confirmation email. Check the message already sent to your inbox.'
        : detail)
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-hero">
      <a href="/" className="auth-brand-link" title="Back to Velnu home"><div className="logo-mark">V</div><div className="brand-word">Velnu</div></a>
      <h1>Run your business by talking to it.</h1>
      <p>Your AI office manager for customers, jobs, estimates, invoices, payments and follow-up.</p>
      <div className="voice-example">“Create an invoice for Bob Smith for $1,450 due in 15 days.”</div>
    </section>
    <section className="auth-card">
      <div><p className="eyebrow">Welcome to Velnu</p><h2>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password'}</h2></div>
      <form onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" disabled={busy} required /></label>
        {mode !== 'reset' && <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} disabled={busy} required /></label>}
        <button className="primary-button" disabled={busy}>{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</button>
      </form>
      {message && <p className="form-message" role="status" aria-live="polite">{message}</p>}
      {(mode === 'signin' || awaitingConfirmation) && <button type="button" className="text-button" disabled={busy} onClick={resendConfirmation}>Resend confirmation email</button>}
      {mode === 'signin' && <button className="text-button" disabled={busy} onClick={() => switchMode('reset')}>Forgot password?</button>}
      <button className="text-button" disabled={busy} onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New to Velnu? Create an account' : 'Back to sign in'}
      </button>
      <p className="auth-legal-note">By continuing after signup, you will be asked to review and accept the one <a href="/legal" target="_blank" rel="noopener noreferrer">Velnu User Agreement (including AI disclosure and privacy)</a> after selecting your Free, Basic, or Pro tier.</p>
      <a className="text-button auth-home-link" href="/">Return to Velnu homepage</a>
    </section>
  </main>
}
