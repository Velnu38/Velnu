import { type FormEvent, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import AuthScreen from './AuthScreen'

export default function PasswordRecovery({ session, invalidLink, onDone }: { session: Session | null; invalidLink: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < 8) { setMessage('Use at least 8 characters.'); return }
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
      if (signOutError) setMessage('Your password was updated, but signing out of other sessions could not be confirmed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update your password. Please try again.')
    } finally { setBusy(false) }
  }

  if (!complete && (invalidLink || !session)) return <AuthScreen initialMode="reset" initialMessage="This reset link is invalid or expired. Request a new link below and open the newest email." />

  return <main className="auth-page">
    <section className="auth-hero"><div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div><div className="brand-word">Finviant Office</div><h1>Get back to your business.</h1><p>Choose a strong password that you do not use for other accounts.</p></section>
    <section className="auth-card">
      <h2>{complete ? 'Password updated' : 'Choose a new password'}</h2>
      {complete ? <><p>Your new password is ready to use.</p><button className="primary-button" disabled={busy} onClick={onDone}>Return to Finviant Office</button></> : <>
        <p>{session?.user.email}</p>
        <form onSubmit={submit}>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      </>}
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  </main>
}
