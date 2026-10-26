import { type FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'reset'

export default function AuthScreen({ initialMode = 'signin', initialMessage = '' }: { initialMode?: Mode; initialMessage?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(initialMessage)

  function switchMode(next: Mode) {
    setMode(next)
    setPassword('')
    setMessage('')
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
      if (mode === 'signup' && !result.data.session) setMessage('Check your email to confirm your Velnu account.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-hero">
      <div className="logo-mark">V</div><div className="brand-word">Velnu</div>
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
      {mode === 'signin' && <button className="text-button" disabled={busy} onClick={() => switchMode('reset')}>Forgot password?</button>}
      <button className="text-button" disabled={busy} onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New to Velnu? Create an account' : 'Back to sign in'}
      </button>
    </section>
  </main>
}
