import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Entry = { email: string; allowed: boolean; registered: boolean }

/** This panel's RPC independently requires a verified platform administrator with MFA. */
export default function BetaRegistrationPanel() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  async function load(address?: string, allow = true) {
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('manage_private_beta_registration', { p_email: address ?? null, p_allow: allow })
      if (result.error) throw result.error
      if (active.current) { setEntries(result.data?.rows ?? []); if (address) setEmail('') }
    } catch { if (active.current) setError('Beta registration access could not be updated. Verify administrator access and try again.') }
    finally { if (active.current) setBusy(false) }
  }
  useEffect(() => { active.current = true; void load(); return () => { active.current = false } }, [])
  function submit(event: FormEvent) { event.preventDefault(); if (!busy) void load(email.trim(), true) }
  return <section className="admin-panel"><h2>Private beta registration</h2>
    <p>Approve test emails before registration. The existing 10-account limit still applies. Customer document links do not create accounts.</p>
    {error && <p role="alert">{error}</p>}
    <form className="settings-actions" onSubmit={submit}><label>Approved test email<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? 'Updating…' : 'Allow beta registration'}</button></form>
    <ul>{entries.map(entry => <li key={entry.email}>{entry.email} · {entry.registered ? 'Registered' : entry.allowed ? 'Approved to register' : 'Registration disabled'} {!entry.registered && entry.allowed && <button className="text-button" disabled={busy} onClick={() => void load(entry.email, false)}>Stop new registration</button>}</li>)}</ul>
  </section>
}
