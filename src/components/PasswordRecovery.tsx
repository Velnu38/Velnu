import FinBrand from './FinBrand'
import { type FormEvent, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { passwordError, authMessage } from '../lib/authPolicy'
import AuthScreen from './AuthScreen'

export default function PasswordRecovery({ session, invalidLink, onDone }: { session: Session | null; invalidLink: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [revoked, setRevoked] = useState(false)
  const [complete, setComplete] = useState(false)

  async function revokeSessions() {
    setBusy(true)
    try {
      const result = await supabase.auth.signOut({ scope: 'global' })
      if (result.error) throw result.error
      setRevoked(true)
      setMessage('')
    } catch {
      setMessage('Unable to confirm session sign-out. Check your connection and retry.')
    } finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const issue = passwordError(password); if (issue) { setMessage(issue); return }
    if (password !== confirmation) { setMessage('The passwords do not match.'); return }
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPassword('')
      setConfirmation('')
      setComplete(true)
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' })
      setRevoked(!signOutError)
      if (signOutError) setMessage('Your password was updated, but signing out of other sessions could not be confirmed.')
    } catch (error) {
      setMessage((error as {code?: string})?.code === 'reauthentication_needed' ? 'This session is too old. Request a fresh password-reset email and open its newest link.' : authMessage(error, 'reset'))
    } finally { setBusy(false) }
  }

  if (!complete && (invalidLink || !session)) return <AuthScreen initialMode="reset" initialMessage="This reset link is invalid or expired. Request a new link below and open the newest email." />

  return <main className="auth-page">
    <section className="auth-hero"><FinBrand/><h1>Get back to your business.</h1><p>Choose a strong password that you do not use for other accounts.</p></section>
    <section className="auth-card">
      <h2>{complete ? 'Password updated' : 'Choose a new password'}</h2>
      {complete ? <><p>Your new password is ready to use. Sign in again with your new password.</p>{!revoked && <button className="secondary-button" disabled={busy} onClick={()=>void revokeSessions()}>Retry signing out other sessions</button>}<button className="primary-button" disabled={busy || !revoked} onClick={onDone}>Return to Finviant Office</button></> : <>
        <p>{session?.user.email}</p>
        <form onSubmit={submit}>
          <label>New password<input type="password" autoComplete="new-password" minLength={15} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" minLength={15} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      </>}
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  </main>
}
