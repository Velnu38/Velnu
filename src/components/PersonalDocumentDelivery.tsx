import { useEffect, useRef, useState } from 'react'
import { confirmPersonalSent, nativeDocumentDraft, preparePersonalDocument, readPendingPersonalSend, releasePersonalApproval, storePendingPersonalSend, type PendingPersonalSend, type PersonalChannel } from '../services/personalDelivery'
import { normalizeMobile } from '../lib/smsPhone'
import type { DeliverySetup } from '../services/tiers'
import type { DeliveryDocumentKind } from '../services/reviewDelivery'
import { validDeliveryEmail } from './DocumentDeliveryOptions'

type Props = {
  businessId: string
  kind: DeliveryDocumentKind
  documentId: string
  email?: string | null
  phone?: string | null
  setup: DeliverySetup
  disabled: boolean
  onEditContact: () => void
  onSent: () => void | Promise<unknown>
  onBusyChange?: (busy: boolean) => void
  reminder?: { subject: string; body: string }
}

export default function PersonalDocumentDelivery({ businessId, kind, documentId, email, phone, setup, disabled, onEditContact, onSent, onBusyChange, reminder }: Props) {
  const [pending, setPending] = useState<PendingPersonalSend | null>(null)
  const [draftHref, setDraftHref] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [copyUrl, setCopyUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)

  useEffect(() => {
    let active = true
    setPending(null); setDraftHref(''); setShareUrl(''); setCopyUrl(''); setNotice(''); setError('')
    void readPendingPersonalSend(businessId, kind, documentId).then(async saved => {
      if (!active || !saved) return
      setPending(saved)
      try {
        const share = await preparePersonalDocument(businessId, kind, documentId, saved.token)
        if (active) setDraftHref(nativeDocumentDraft(share, saved.channel, (saved.channel === 'email' ? email : phone) || '', reminder))
      } catch { /* The send confirmation remains available if the original draft cannot be reopened. */ }
    })
    return () => { active = false }
  }, [businessId, kind, documentId, email, phone, reminder?.subject, reminder?.body])

  async function prepare(channel: PersonalChannel | 'copy') {
    if (flight.current || disabled) return
    flight.current = true; setBusy(true); onBusyChange?.(true); setError(''); setNotice(''); setCopyUrl('')
    try {
      const share = await preparePersonalDocument(businessId, kind, documentId)
      const href = channel === 'copy' ? null : nativeDocumentDraft(share, channel, (channel === 'email' ? email : phone) || '', reminder)
      await releasePersonalApproval(businessId, kind, share.token)
      setShareUrl(share.url)
      const ready = kind === 'invoice' ? '' : 'Ready for customer approval. '
      if (channel === 'copy') {
        try { await navigator.clipboard.writeText(share.url); setNotice(ready + 'Link copied.') }
        catch { setCopyUrl(share.url); setNotice(ready + 'Copy the link below.') }
      } else if (href) {
        const next = { token: share.token, channel }
        await storePendingPersonalSend(businessId, kind, documentId, next)
        setPending(next); setDraftHref(href); setNotice(ready + 'Finish in your app, then confirm here.')
        window.location.href = href
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to prepare the document.') }
    finally { flight.current = false; setBusy(false); onBusyChange?.(false) }
  }

  async function confirm(sent: boolean) {
    if (!pending || flight.current || disabled) return
    flight.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      if (sent) await confirmPersonalSent(businessId, pending.token, pending.channel)
      await storePendingPersonalSend(businessId, kind, documentId, null)
      setPending(null)
      setDraftHref('')
      setNotice(sent ? 'Recorded as sent through your app.' : 'The document is available to share again.')
      if (sent) {
        try { await onSent() }
        catch { setNotice('Sent was recorded. Reload to update the document status.') }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to record the send.') }
    finally { flight.current = false; setBusy(false); onBusyChange?.(false) }
  }

  const emailReady = setup.personal_email_ready && validDeliveryEmail(email || '')
  const smsReady = setup.personal_sms_ready && !!normalizeMobile(phone || '')
  const locked = busy || disabled
  return <section className="document-delivery" aria-label="Send to customer">
    <div className="document-delivery-heading"><h2>Send to customer</h2><button type="button" className="text-button" disabled={locked} onClick={onEditContact}>Edit customer contact</button></div>
    <p>Opens your email or messaging app to finish sending. Replies arrive in that app.</p>
    {pending ? <div className="personal-delivery-actions">
      <p role="status">{kind!=='invoice' && 'Ready for customer approval. '}Confirm after sending in your {pending.channel==='email'?'email':'messaging'} app.</p>
      <button type="button" className="primary-button" disabled={locked} onClick={() => void confirm(true)}>Confirm sent</button>
      {draftHref && <a className="secondary-button" href={draftHref}>Reopen draft in your app</a>}
      <button type="button" className="text-button" disabled={locked} onClick={() => void confirm(false)}>I did not send it</button>
    </div> : <div className="document-delivery-grid">
      <div className="document-delivery-option"><span>{email ? 'To: ' + email : 'Add a customer email'}</span>
        <button type="button" className="primary-button" disabled={locked || !emailReady} onClick={() => void prepare('email')}>Send Email</button>
        {!setup.personal_email_ready && <small>Enable your personal email app in sending setup.</small>}</div>
      <div className="document-delivery-option"><span>{phone ? 'To: ' + phone : 'Add a customer mobile number'}</span>
        <button type="button" className="primary-button" disabled={locked || !smsReady} onClick={() => void prepare('sms')}>Send Text</button>
        {!setup.personal_sms_ready && <small>Enable your personal messaging app in sending setup.</small>}</div>
    </div>}
    <div className="personal-delivery-actions">
      <button type="button" className="secondary-button" disabled={locked || !!pending} onClick={() => void prepare('copy')}>Copy Link</button>
      {shareUrl && <a className="secondary-button" href={shareUrl} target="_blank" rel="noopener noreferrer">View customer link</a>}
    </div>
    {copyUrl && <label>Customer link<input value={copyUrl} readOnly onFocus={event => event.target.select()} /></label>}
    <p className="quiet"><a href="/?view=settings&section=delivery">Sending setup</a> · Use Copy Link or Print / Save PDF to share another way.</p>
    {notice && <p role="status" className="form-message">{notice}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>
}
