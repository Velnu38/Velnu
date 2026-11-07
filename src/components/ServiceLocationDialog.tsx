import { useRef, useState, type FormEvent } from 'react'
import FormDialog from './FormDialog'
import ServiceAddressFields, { type ServiceAddressDraft } from './ServiceAddressFields'
import { createProperty, updateProperty, type CustomerLocation } from '../services/properties'
import { readableError } from '../lib/errors'

export default function ServiceLocationDialog({ businessId, customerId, location, onClose, onSaved }: { businessId: string; customerId: string; location?: CustomerLocation; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ServiceAddressDraft & {label:string;access_notes:string}>(() => ({ address_line1: location?.address_line1 || '', address_line2: location?.address_line2 || '', city: location?.city || '', state: location?.state || '', postal_code: location?.postal_code || '', label: location?.label || '', access_notes: location?.access_notes || '' }))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const saving = useRef(false), retry = useRef<{ signature: string; id: string } | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault(); if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      const input = { ...form, customer_id: customerId }
      if (location) await updateProperty(businessId, location.id, location.updated_at, input)
      else {
        const signature = JSON.stringify(input)
        if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
        await createProperty(businessId, input, retry.current.id)
      }
      onSaved(); onClose()
    } catch (e) { setError(readableError(e, 'Unable to save this address. Your changes are still here.')) }
    finally { saving.current = false; setBusy(false) }
  }
  const title = location ? 'Edit address' : 'Add address'
  return <FormDialog label={title} busy={busy} onClose={onClose}>
    <div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    <form className="form-grid" onSubmit={save}>
      <label className="full">Location name (optional)<input maxLength={160} placeholder="Home, rental, shop…" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}/></label>
      <ServiceAddressFields value={form} onChange={address => setForm({ ...form, ...address })} required/>
      <label className="full">Access notes<textarea maxLength={4000} placeholder="Gate code, parking, lockbox…" value={form.access_notes} onChange={e => setForm({ ...form, access_notes: e.target.value })}/></label>
      {error && <p role="alert" className="error-text full">{error}</p>}
      <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button></div>
    </form>
  </FormDialog>
}
