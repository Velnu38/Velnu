import { useEffect, useState, type FormEvent } from 'react'
import {
  createBusiness, draftFromBusiness, emptyBusinessProfile,
  updateBusinessProfile, uploadBusinessLogo, businessLogoUrl,
  type BusinessProfileDraft, type CurrentBusiness,
} from '../lib/business'

const stages = ['Company details', 'Document appearance', 'Your business']

export default function BusinessProfileEditor({ business, onSaved }: {
  business?: CurrentBusiness
  onSaved: (business: CurrentBusiness) => void
}) {
  const [draft, setDraft] = useState<BusinessProfileDraft>(() => business ? draftFromBusiness(business) : { ...emptyBusinessProfile })
  const [step, setStep] = useState(0)
  const [logo, setLogo] = useState<File | null>(null)
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [created, setCreated] = useState<CurrentBusiness | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const editing = !!business
  const logoUrl = localLogoUrl || (business && !removeLogo ? businessLogoUrl(business) : null)

  useEffect(() => {
    if (!logo) { setLocalLogoUrl(null); return }
    const objectUrl = URL.createObjectURL(logo)
    setLocalLogoUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [logo])

  function update(key: keyof BusinessProfileDraft, value: string) {
    setDraft(old => ({ ...old, [key]: value }))
    setError('')
  }

  function chooseLogo(file: File | null) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Logo must be PNG, JPG or WebP. SVG files are not accepted.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Your logo must be no larger than 2 MB.')
      return
    }
    setLogo(file)
    setRemoveLogo(false)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (step < 2) { setStep(step + 1); setError(''); return }
    setBusy(true); setError(''); setNotice('')
    try {
      let saved: CurrentBusiness
      if (business || created) saved = await updateBusinessProfile(business || created!, draft, removeLogo ? null : undefined)
      else {
        saved = await createBusiness(draft)
        setCreated(saved) // If the logo upload fails, retry edits to this record instead of duplicating the business.
      }
      if (logo) {
        const path = await uploadBusinessLogo(saved, logo)
        saved = await updateBusinessProfile(saved, draft, path)
      }
      setLogo(null)
      setCreated(null)
      onSaved(saved)
      if (editing) setNotice('Company profile saved. Future invoice and estimate previews will use these details.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save your business details. Try again.')
    } finally { setBusy(false) }
  }

  const field = (key: keyof BusinessProfileDraft, title: string, placeholder = '', props: { required?: boolean; type?: string; maxLength?: number } = {}) =>
    <label key={key}>{title}<input type={props.type || 'text'} value={draft[key]} onChange={e => update(key, e.target.value)}
      placeholder={placeholder} required={props.required} maxLength={props.maxLength ?? 160} disabled={busy} /></label>

  return <section className="profile-editor">
    <div className="profile-steps" role="list">
      {stages.map((stage, i) => <div key={stage} role="listitem" className={'profile-step ' + (i === step ? 'active' : i < step ? 'complete' : '')}>
        <strong>{i + 1}</strong><span>{stage}</span>
      </div>)}
    </div>
    <form onSubmit={submit} className="profile-form">
      {step === 0 && <>
        <h2>Make every invoice look like it comes from your company</h2>
        <p className="quiet">The name, address, phone, and email you add here appear on your invoice and estimate documents. All fields except company name are optional.</p>
        <div className="profile-field-grid">
          {field('name', 'Company name', 'Your business name', { required: true })}
          {field('legal_name', 'Legal name (if different)', 'Optional registered name')}
          {field('phone', 'Business phone', '(555) 555-1234', { type: 'tel' })}
          {field('email', 'Business email', 'office@example.com', { type: 'email' })}
          {field('website', 'Website', 'yourbusiness.com')}
          {field('address_line1', 'Street address', '123 Main Street')}
          {field('address_line2', 'Address line 2', 'Suite or unit')}
          {field('city', 'City', 'City')}
          {field('state', 'State / region', 'VA')}
          {field('postal_code', 'Postal / ZIP code', '23320')}
        </div>
      </>}
      {step === 1 && <>
        <h2>Personalize invoices and estimates</h2>
        <p className="quiet">Use your company logo and choose an accent color. The preview shows the company details customers will see.</p>
        <div className="profile-logo-row">
          {logoUrl && <img src={logoUrl} className="profile-current-logo" alt="Current company logo" />}
          <label>Company logo (optional, up to 2 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => chooseLogo(e.target.files?.[0] || null)} disabled={busy} />
          </label>
        </div>
        {logo && <p className="quiet">Selected logo: {logo.name}</p>}
        {logoUrl && !logo && <button className="text-button" type="button" disabled={busy} onClick={() => { setRemoveLogo(true); setLogo(null) }}>Remove current logo from documents</button>}
        <div className="profile-field-grid">
          <label>Document accent color
            <input type="color" value={draft.document_accent} onChange={e => update('document_accent', e.target.value)} disabled={busy} />
          </label>
          <label className="full">Optional footer on invoices and estimates
            <textarea value={draft.document_footer} onChange={e => update('document_footer', e.target.value)} placeholder="Thank you for choosing our company." maxLength={500} rows={2} disabled={busy} />
          </label>
        </div>
        <div className="profile-preview" style={{ borderTopColor: draft.document_accent }}>
          <p className="eyebrow">Live letterhead preview</p>
          <strong>{draft.name || 'Your company'}</strong>
          <span>{[draft.address_line1, draft.city, draft.state, draft.postal_code].filter(Boolean).join(' · ') || 'Company address (optional)'}</span>
          <span>{[draft.phone, draft.email].filter(Boolean).join(' · ') || 'Business phone and email (optional)'}</span>
          {logoUrl && <img className="profile-current-logo" src={logoUrl} alt="Company logo preview" />}
          {logo && <small>Selected logo will be saved with your company profile.</small>}
          {draft.document_footer && <small>{draft.document_footer}</small>}
        </div>
      </>}
      {step === 2 && <>
        <h2>Help Velnu understand your business</h2>
        <p className="quiet">This is optional context for future assistant features. It is saved to your business profile, not used to train a public AI model. The assistant should still ask before deciding prices, dates, or staffing.</p>
        <label>What does your business do?
          <textarea value={draft.business_description} onChange={e => update('business_description', e.target.value)}
            placeholder="We are a residential plumbing company specializing in service calls…" maxLength={1500} rows={3} disabled={busy} />
        </label>
        <label>Services offered
          <textarea value={draft.services_offered} onChange={e => update('services_offered', e.target.value)}
            placeholder="Faucet repairs, water heater installation, drain cleaning…" maxLength={1200} rows={2} disabled={busy} />
        </label>
        <div className="profile-field-grid">
          {field('service_area', 'Service area', 'Chesapeake and surrounding areas', { maxLength: 300 })}
          {field('team_size', 'Number of people (including owner)', '3', { type: 'number', maxLength: 6 })}
        </div>
        <label>Team responsibilities (optional)
          <textarea value={draft.team_roles} onChange={e => update('team_roles', e.target.value)}
            placeholder="Owner handles quotes, two technicians do field work, office manager schedules jobs." maxLength={1200} rows={3} disabled={busy} />
        </label>
        <p className="profile-safety">Avoid entering employee Social Security numbers, payroll information, personal addresses, or other sensitive employee records.</p>
      </>}
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      {notice && <p role="status" className="form-message">{notice}</p>}
      <div className="profile-actions">
        {step > 0 && <button className="secondary-button" type="button" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}>Back</button>}
        <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : step < 2 ? 'Continue' : editing ? 'Save company profile' : 'Create my business'}</button>
      </div>
    </form>
  </section>
}
