import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import ServicePicker from '../components/ServicePicker'
import { clearPendingServiceInterests, getPendingServiceInterests, hasPendingServiceInterests, setPendingServiceInterests, type ServiceInterest } from '../lib/serviceCatalog'
import { loadBusinessServiceInterests, saveBusinessServiceInterests } from '../lib/businessServices'

export default function WorkspaceServicesPage({ business }: { business: CurrentBusiness }) {
  const [interest, setInterest] = useState<ServiceInterest>(getPendingServiceInterests)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const editable = business.role === 'owner' || business.role === 'admin'
  useEffect(() => {
    let active = true
    setLoading(true)
    void loadBusinessServiceInterests(business.id).then(saved => {
      if (active && saved && !hasPendingServiceInterests()) setInterest(saved)
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load your service choices.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id])

  function change(value: ServiceInterest) {
    setInterest(value); setPendingServiceInterests(value); setNotice('')
  }
  async function save() {
    if (busy || loading || !editable) return
    setBusy(true); setError(''); setNotice('')
    try {
      await saveBusinessServiceInterests(business.id,interest)
      clearPendingServiceInterests()
      setNotice('Your preferences were saved to your business account. No services were purchased or activated.')
    } catch(err) {
      setError(err instanceof Error ? err.message : 'Unable to save preferences. Try again.')
    } finally { setBusy(false) }
  }
  return <div className="page-stack workspace-services">
    <div className="page-heading"><p className="eyebrow">My services · Beta preferences</p><h1>Build your Velnu workspace.</h1>
      <p className="quiet">Use Velnu's existing tools now. Select the optional services you'd like, and we'll use these preferences to plan future packages. No prices or service activations are applied yet.</p></div>
    {loading ? <p className="form-message">Loading service preferences…</p> : <>
      <ServicePicker value={interest} onChange={change} disabled={!editable}/>
      {error && <p className="form-message error-text" role="alert">{error}</p>}
      {notice && <p className="form-message success-text" role="status">{notice}</p>}
      {editable
        ? <div className="service-workspace-actions"><button className="primary-button" disabled={busy} onClick={save}>{busy ? 'Saving preferences…' : 'Save my service preferences'}</button></div>
        : <p className="form-message">Ask your company owner or administrator to change service preferences.</p>}
    </>}
  </div>
}
