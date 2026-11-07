import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { confirmPersonalSent, nativeDocumentDraft, preparePersonalDocument, releasePersonalApproval, storePendingPersonalSend, type PersonalChannel } from '../services/personalDelivery'
import { useDeliverySetup } from '../lib/useDeliverySetup'
import { normalizeMobile } from '../lib/smsPhone'
import { emailDeliveryEnabled, privateBetaEmailEnabled } from '../lib/releaseFlags'
import DocumentPaper from './DocumentPaper'
import { validDeliveryEmail } from './DocumentDeliveryOptions'
import FormDialog from './FormDialog'
import ManagedSmsDelivery from './ManagedSmsDelivery'
import PlanRestriction from './PlanRestriction'
import DeliverySetup from './settings/DeliverySetup'

type Props = {
  paper: ComponentProps<typeof DocumentPaper>
  busy: boolean
  error: string
  saved?: boolean
  onBack: () => void
  onSave: () => void
  onEmail: () => void
  saveForDelivery: () => Promise<string | undefined>
  canUpgrade?: boolean
  onEditContact?: (field: 'email' | 'phone') => void
  onDraftContact?: (field: 'email' | 'phone', value: string) => void
}
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function CreationPreview({ paper, busy, error, saved = false, onBack, onSave, onEmail, saveForDelivery, canUpgrade = false, onEditContact, onDraftContact }: Props) {
  const [showSetup, setShowSetup] = useState(false)
  const [usePersonal, setUsePersonal] = useState(false)
  const [contactField, setContactField] = useState<'email' | 'phone' | null>(null)
  const [sending, setSending] = useState(false)
  const [deliveryError, setDeliveryError] = useState('')
  const [shareNotice, setShareNotice] = useState('')
  const [copyUrl, setCopyUrl] = useState('')
  const [handoff, setHandoff] = useState<{ id: string; token: string; href: string; channel: PersonalChannel } | null>(null)
  const flight = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const businessId = paper.business.id
  const { setup, error: setupError, refresh } = useDeliverySetup(businessId)
  const personal = setup?.plan !== 'pro' || usePersonal
  const locked = busy || sending
  const email = paper.customer?.email?.trim() || ''
  const phone = paper.customer?.phone?.trim() || ''
  const emailValid = validDeliveryEmail(email)
  const phoneValid = !!normalizeMobile(phone)

  useEffect(() => { setUsePersonal(false) }, [businessId, setup?.plan])
  useEffect(() => { heading.current?.focus(); heading.current?.closest('dialog')?.scrollTo({ top: 0 }) }, [])

  async function prepare(action: PersonalChannel | 'copy' | 'setup') {
    if (flight.current || !businessId) return
    flight.current = true; setSending(true); setDeliveryError(''); setShareNotice(''); setCopyUrl('')
    try {
      if (action === 'email') {
        const fresh = await refresh()
        if (fresh.plan === 'pro' && !usePersonal) {
          if (!fresh.managed_email_ready || !emailDeliveryEnabled) throw new Error('Finviant email sending needs activation. Review Email & Text Setup.')
          await onEmail()
          return
        }
        if (!fresh.personal_email_ready) throw new Error('Complete your email app setup before opening a draft.')
      }
      const id = await saveForDelivery()
      if (!id) return
      if (action === 'setup') {
        setShowSetup(true)
        return
      }
      const share = await preparePersonalDocument(businessId, paper.kind, id)
      if (action === 'copy') {
        await releasePersonalApproval(businessId, paper.kind, share.token)
        try { await navigator.clipboard.writeText(share.url) }
        catch { setCopyUrl(share.url) }
        setShareNotice(paper.kind === 'estimate' ? 'Ready for customer approval. Share this link with the customer.' : 'Customer link ready to share.')
        return
      }
      const href = nativeDocumentDraft(share, action, action === 'email' ? email : phone)
      await releasePersonalApproval(businessId, paper.kind, share.token)
      const pending = { token: share.token, channel: action }
      await storePendingPersonalSend(businessId, paper.kind, id, pending)
      setHandoff({ id, href, ...pending })
      window.location.href = href
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : 'Unable to prepare this document.')
    } finally { flight.current = false; setSending(false) }
  }

  async function finishHandoff(sent: boolean) {
    if (!businessId || !handoff || flight.current) return
    flight.current = true; setSending(true); setDeliveryError('')
    try {
      if (sent) await confirmPersonalSent(businessId, handoff.token, handoff.channel)
      await storePendingPersonalSend(businessId, paper.kind, handoff.id, null)
      setHandoff(null)
      if (sent) onSave()
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : 'Unable to record the send.')
    } finally { flight.current = false; setSending(false) }
  }

  function editContact(field: 'email' | 'phone') {
    if (onEditContact) onEditContact(field)
    else setContactField(field)
  }

  return <section className="creation-preview" data-saving={locked ? 'true' : undefined}>
    <button type="button" className="back-button" data-keep-dialog disabled={locked} onClick={onBack}>← Back to edit</button>
    <h2 ref={heading} tabIndex={-1}>{paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} preview</h2>
    <section className="creation-review-bar" aria-label="Review and send">
      <div className="creation-review-summary">
        <div><strong>{[paper.customer?.first_name, paper.customer?.last_name].filter(Boolean).join(' ') || paper.customer?.company || 'Customer'}</strong>
          {email && <small>{email}</small>}{phone && <small>{phone}</small>}</div>
        <strong>{usd.format(Number(paper.total))}</strong>
      </div>
      {handoff ? <div className="creation-handoff">
        <p role="status">{paper.kind === 'estimate' && 'Ready for customer approval. '}Finish in your {handoff.channel === 'email' ? 'email' : 'messaging'} app, then confirm here.</p>
        <button type="button" className="primary-button" disabled={locked} onClick={() => void finishHandoff(true)}>Confirm sent</button>
        <button type="button" className="text-button" disabled={locked} onClick={() => void finishHandoff(false)}>I did not send it</button>
        <a href={handoff.href}>Reopen draft in your app</a>
      </div> : <>
        <div className="creation-delivery-actions">
          {setup && !personal && businessId
            ? <ManagedSmsDelivery businessId={businessId} kind={paper.kind} phone={phone} ready={setup.managed_sms_ready} disabled={locked} saveDocument={saveForDelivery} onBusyChange={setSending} onSent={onSave} />
            : <div><button type="button" className="primary-button" disabled={locked || !setup?.personal_sms_ready || !phoneValid} onClick={() => void prepare('sms')}>Send Text</button>
              <small>{setup?.personal_sms_ready && phoneValid ? 'Opens your texting app' : phoneValid ? 'Text setup required' : ''}</small></div>}
          <div><button type="button" className="primary-button" disabled={locked || !emailValid || !setup || !(personal ? setup.personal_email_ready : setup.managed_email_ready && emailDeliveryEnabled)}
            onClick={() => void prepare('email')}>{setup?.plan === 'pro' && usePersonal ? 'Open email app' : 'Send Email'}</button>
            {setup && emailValid && (personal ? <small>{setup.personal_email_ready?'Opens your email app':'Email setup required'}</small> : !setup.managed_email_ready && <small>Sender activation required</small>)}</div>
          <div><button type="button" className="secondary-button" disabled={locked} onClick={onSave}>{saved ? 'Open saved draft' : 'Save Draft'}</button></div>
        </div>
        {setup?.plan === 'pro' && !personal && privateBetaEmailEnabled && <p className="quiet">Private beta email sends only to approved test addresses.</p>}
        <div className="creation-review-links">
          {!emailValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('email')}>Add email</button>}
          {!phoneValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('phone')}>Add phone</button>}
          {canUpgrade && <button type="button" className="text-button" disabled={locked} onClick={() => void prepare('setup')}>Email &amp; Text Setup</button>}
          {setup?.plan === 'pro' && <button type="button" className="text-button" disabled={locked} onClick={() => setUsePersonal(value => !value)}>{usePersonal ? 'Use Finviant sending' : 'Use my email or text app'}</button>}
          {personal && setup && <button type="button" className="text-button" disabled={locked} onClick={() => void prepare('copy')}>Copy customer link</button>}
        </div>
      </>}
      {contactField && onDraftContact && !onEditContact && <label>{contactField === 'email' ? 'Customer email' : 'Customer phone'}<input
        type={contactField === 'email' ? 'email' : 'tel'} maxLength={contactField === 'email' ? 254 : 40} value={contactField === 'email' ? email : phone}
        disabled={locked} onChange={event => onDraftContact(contactField, event.target.value)} /></label>}
      {setupError && <p role="alert">{setupError} <button type="button" className="text-button" onClick={() => { void refresh().catch(() => {}) }}>Try again</button></p>}
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      {deliveryError && <p role="alert" className="form-message error-text">{deliveryError}</p>}
      {shareNotice && <p role="status">{shareNotice}</p>}
      {copyUrl && <label>Customer link<input readOnly value={copyUrl} onFocus={event => event.target.select()} /></label>}
    </section>
    <DocumentPaper {...paper} finviantBranding={setup?.plan === 'free'} />
    {canUpgrade && setup?.plan === 'free' && <PlanRestriction plan="free" required="basic" feature="Removing Finviant branding" canUpgrade />}
    {showSetup && businessId && <FormDialog label="Email & Text Setup" onClose={() => setShowSetup(false)} wide>
      <div className="modal-head"><div><h2>Email &amp; Text Setup</h2><p role="status">Your draft is saved. Return to review it when setup is complete.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div>
      <DeliverySetup businessId={businessId} continueLabel="Save and return to preview" onComplete={() => { setShowSetup(false); void refresh().catch(() => {}) }} />
    </FormDialog>}
  </section>
}
