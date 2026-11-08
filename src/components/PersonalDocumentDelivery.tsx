import { useEffect, useRef, useState } from 'react'
import { confirmPersonalSent, nativeDocumentDraft, preparePersonalDocument, readPendingPersonalSend, releasePersonalApproval, storePendingPersonalSend, type PendingPersonalSend, type PersonalChannel, type PreparedShare } from '../services/personalDelivery'
import { canShareDocumentPdf, downloadDocumentPdf, getDocumentPdf, shareDocumentPdf, type DocumentPdfArtifact } from '../services/documentPdf'
import { normalizeMobile } from '../lib/smsPhone'
import { getDeliverySetup, type DeliverySetup } from '../services/tiers'
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
  allowProPersonal?: boolean
  onManagedEmailRequested?: (fresh: DeliverySetup) => void | Promise<void>
  onPendingChange?: (pending: PendingPersonalSend | null) => void
  pdfArtifact?: DocumentPdfArtifact | null
  hidePdfDownload?: boolean
}

export default function PersonalDocumentDelivery({ businessId, kind, documentId, email, phone, setup, disabled, onEditContact, onSent, onBusyChange, reminder, allowProPersonal = false, onManagedEmailRequested, onPendingChange, pdfArtifact, hidePdfDownload = false }: Props) {
  const [pending, setPending] = useState<PendingPersonalSend | null>(null)
  const [draftHref, setDraftHref] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [copyUrl, setCopyUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparedPdf, setPreparedPdf] = useState<{ share: PreparedShare; pdf: DocumentPdfArtifact } | null>(null)
  const flight = useRef(false)

  useEffect(() => {
    let active = true
    setPending(null); setDraftHref(''); setShareUrl(''); setCopyUrl(''); setNotice(''); setError(''); setPreparedPdf(null)
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

  async function prepare(channel: PersonalChannel | 'copy' | 'pdf') {
    if (flight.current || disabled) return
    flight.current = true; setBusy(true); onBusyChange?.(true); setError(''); setNotice(''); setCopyUrl('')
    try {
      if (channel === 'email') {
        const fresh = await getDeliverySetup(businessId)
        if ((fresh.plan === 'pro' || fresh.plan === 'basic' && !reminder) && !allowProPersonal) {
          if (!onManagedEmailRequested) throw new Error('Your paid plan sends email through Finviant. Return to Finviant sending and try again.')
          await onManagedEmailRequested(fresh)
          return
        }
        if (!fresh.personal_email_ready) throw new Error('Complete your email app setup before opening a draft.')
      }
      const share = await preparePersonalDocument(businessId, kind, documentId)
      const attachment = await getDocumentPdf({ token: share.token, tokenType: 'share' })
      if (pdfArtifact?.revisionId && attachment.revisionId !== pdfArtifact.revisionId) throw new Error('This document changed after review. Reload its PDF and review the current version before sending.')
      setPreparedPdf({ share, pdf: attachment })
      const href = channel === 'copy' || channel === 'pdf' ? null : nativeDocumentDraft(share, channel, (channel === 'email' ? email : phone) || '', reminder)
      await releasePersonalApproval(businessId, kind, share.token)
      setShareUrl(share.url)
      const ready = kind !== 'invoice' && setup.plan === 'pro' ? 'Ready for customer approval. ' : ''
      if (channel === 'pdf') {
        setNotice(canShareDocumentPdf(attachment) ? 'PDF ready. Choose Share PDF by email, then select your email app.' : 'PDF ready. Download it and attach it in your email app.')
      } else if (channel === 'copy') {
        try { await navigator.clipboard.writeText(share.url); setNotice(ready + 'Link copied.') }
        catch { setCopyUrl(share.url); setNotice(ready + 'Copy the link below.') }
      } else if (href) {
        const next = { token: share.token, channel }
        await storePendingPersonalSend(businessId, kind, documentId, next)
        onPendingChange?.(next)
        if (channel === 'email') downloadDocumentPdf(attachment)
        setPending(next); setDraftHref(href); setNotice(ready + (channel === 'email' ? 'PDF downloaded. Attach it to this email draft before sending, then confirm here.' : 'Finish in your messaging app, then confirm here.'))
        window.location.href = href
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to prepare the document.') }
    finally { flight.current = false; setBusy(false); onBusyChange?.(false) }
  }

  async function sharePdfByEmail() {
    if (flight.current || disabled) return
    if (!preparedPdf) { await prepare('pdf'); return }
    flight.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      // The file is already prepared, so sharing starts within this user click.
      const result = await shareDocumentPdf(preparedPdf.pdf, preparedPdf.share.subject, 'Please review the attached document. ' + preparedPdf.share.url)
      if (result === 'cancelled') { setNotice('Sharing cancelled. No send was recorded.'); return }
      if (result === 'unsupported') { setNotice('Download the PDF and attach it in your email app.'); return }
      const next: PendingPersonalSend = { token: preparedPdf.share.token, channel: 'email' }
      await storePendingPersonalSend(businessId, kind, documentId, next)
      setPending(next); onPendingChange?.(next)
      setNotice('Confirm here only after sending the PDF to this customer in your email app.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The PDF could not be shared.') }
    finally { flight.current = false; setBusy(false); onBusyChange?.(false) }
  }

  async function confirm(sent: boolean) {
    if (!pending || flight.current || disabled) return
    flight.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      if (sent) await confirmPersonalSent(businessId, pending.token, pending.channel)
      await storePendingPersonalSend(businessId, kind, documentId, null)
      onPendingChange?.(null)
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
    <p>Personal email downloads the finished PDF and opens a draft. Attach that PDF before sending. Replies arrive in your app.</p>
    {pending ? <div className="personal-delivery-actions">
      <p role="status">{kind!=='invoice' && setup.plan==='pro' && 'Ready for customer approval. '}Confirm after sending to this customer in your {pending.channel==='email'?'email':'messaging'} app.</p>
      <button type="button" className="primary-button" disabled={locked} onClick={() => void confirm(true)}>Confirm sent</button>
      {draftHref && <a className="secondary-button" href={draftHref}>Reopen draft in your app</a>}
      <button type="button" className="text-button" disabled={locked} onClick={() => void confirm(false)}>I did not send it</button>
    </div> : <div className="document-delivery-grid">
      <div className="document-delivery-option"><span>{email ? 'To: ' + email : 'Add a customer email'}</span>
        <button type="button" className="primary-button" disabled={locked || !emailReady} onClick={() => void prepare('email')}>{setup.plan !== 'free' ? 'Open email app' : 'Send Email'}</button>
        {!setup.personal_email_ready && <small>Enable your personal email app in sending setup.</small>}</div>
      <div className="document-delivery-option"><span>{phone ? 'To: ' + phone : 'Add a customer mobile number'}</span>
        <button type="button" className="primary-button" disabled={locked || !smsReady} onClick={() => void prepare('sms')}>Send Text</button>
        {!setup.personal_sms_ready && <small>Enable your personal messaging app in sending setup.</small>}</div>
    </div>}
    <div className="personal-delivery-actions">
      <button type="button" className="secondary-button" disabled={locked || !!pending} onClick={() => void prepare('copy')}>Copy Link</button>
      {!hidePdfDownload && (preparedPdf?.pdf || pdfArtifact) && <button type="button" className="secondary-button" disabled={locked} onClick={() => downloadDocumentPdf((preparedPdf?.pdf || pdfArtifact)!)}>Download PDF</button>}
      {!pending && (!preparedPdf || canShareDocumentPdf(preparedPdf.pdf)) && <button type="button" className="secondary-button" disabled={locked} onClick={() => void sharePdfByEmail()}>{preparedPdf ? 'Share PDF by email' : 'Prepare PDF to share'}</button>}
      {shareUrl && <a className="secondary-button" href={shareUrl} target="_blank" rel="noopener noreferrer">View customer link</a>}
    </div>
    {copyUrl && <label>Customer link<input value={copyUrl} readOnly onFocus={event => event.target.select()} /></label>}
    <p className="quiet"><a href="/?view=settings&section=delivery">Sending setup</a> · A customer link opens this same issued document. Sharing or downloading alone does not record a completed send.</p>
    {notice && <p role="status" className="form-message">{notice}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>
}
