import { FormEvent, useState } from 'react'
import { createBusiness, type CurrentBusiness } from '../lib/business'

export default function BusinessOnboarding({ onCreated }: { onCreated: (business: CurrentBusiness) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await createBusiness(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create business')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card">
        <div className="logo-mark">V</div>
        <p className="eyebrow">One quick setup</p>
        <h1>What should Velnu call your business?</h1>
        <p>This is the workspace your customers, jobs, estimates, invoices and schedule will belong to.</p>
        <form onSubmit={submit}>
          <label>Business name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Smith Plumbing" autoFocus required /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create my workspace'}</button>
        </form>
        {error && <p className="form-message error-text">{error}</p>}
      </section>
    </main>
  )
}
