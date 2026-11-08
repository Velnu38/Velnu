import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { confirmPersonalSent, nativeDocumentDraft, preparePersonalDocument, releasePersonalApproval, storePendingPersonalSend, type PersonalChannel } from '../services/personalDelivery'
import { useDeliverySetup } from '../lib/useDeliverySetup'
import { normalizeMobile } from '../lib/smsPhone'
import { emailDeliveryEnabled, privateBetaEmailEnabled } from '../lib/releaseFlags'
import type DocumentPaper from './DocumentPaper'
import DocumentPdfPreview from './DocumentPdfPreview'
import { downloadDocumentPdf, getDocumentPdf, shareDocumentPdf, type DocumentPdfArtifact } from '../services/documentPdf'
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
  onEmail: (expectedRevisionId?: string) => void | Promise<void>
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
  const publication = useRef<Promise<string | undefined> | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [pdf, setPdf] = useState<DocumentPdfArtifact | null>(null)
  const [publicationAttempt, setPublicationAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const businessId = paper.business.id
  const { setup, error: setupError, refresh } = useDeliverySetup(businessId)
  const personal = !setup || setup.plan === 'free' || usePersonal
  const locked = busy || sending
  const email = paper.customer?.email?.trim() || ''
  const phone = paper.customer?.phone?.trim() || ''
  const emailValid = validDeliveryEmail(email)
  const phoneValid = !!normalizeMobile(phone)

  useEffect(() => { setUsePersonal(false) }, [businessId, setup?.plan])
  useEffect(() => { heading.current?.focus(); heading.current?.closest('dialog')?.scrollTo({ top: 0 }) }, [])
  useEffect(() => {
    let active = true
    if (!businessId) return
    if (!publication.current) publication.current = saveForDelivery()
    void publication.current.then(id => {
      if (!active) return
      if (id) setDocumentId(id)
      else setDeliveryError('The draft could not be prepared. Check the details and try again.')
    }).catch(failure => { if (active) setDeliveryError(failure instanceof Error ? failure.message : 'The draft could not be prepared.') })
    return () => { active = false }
  }, [businessId, paper.kind, publicationAttempt])

  async function prepare(action: PersonalChannel | 'copy' | 'setup') {
    if (flight.current || !businessId) return
    flight.current = true; setSending(true); setDeliveryError(''); setShareNotice(''); setCopyUrl('')
    try {
      if (action === 'email') {
        const fresh = await refresh()
        if (fresh.plan !== 'free' && !usePersonal) {
          if (!fresh.managed_email_ready || !emailDeliveryEnabled) throw new Error('Finviant email sending needs activation. Review Email & Text Setup.')
          if (!pdf?.revisionId) throw new Error('Wait for the finished PDF before sending.')
          await onEmail(pdf.revisionId)
          return
        }
        if (!fresh.personal_email_ready) throw new Error('Complete your email app setup before opening a draft.')
      }
      const id = documentId || await saveForDelivery()
      if (!id) return
      if (action === 'setup') {
        setShowSetup(true)
        return
      }
      const share = await preparePersonalDocument(businessId, paper.kind, id)
      const attachment = await getDocumentPdf({ token: share.token, tokenType: 'share' })
      if (pdf?.revisionId && attachment.revisionId !== pdf.revisionId) throw new Error('This document changed after review. Reload the PDF and review the current version before sending.')
      if (action === 'copy') {
        await releasePersonalApproval(businessId, paper.kind, share.token)
        try { await navigator.clipboard.writeText(share.url) }
        catch { setCopyUrl(share.url) }
        setShareNotice(paper.kind === 'estimate' ? 'Ready for customer approval. Share this link with the customer.' : 'Customer link ready to share.')
        return
      }
      const href = nativeDocumentDraft(share, action, action === 'email' ? email : phone)
      await releasePersonalApproval(businessId, paper.kind, share.token)
      if (action === 'email') downloadDocumentPdf(attachment)
      const pending = { token: share.token, channel: action }
      await storePendingPersonalSend(businessId, paper.kind, id, pending)
      setHandoff({ id, href, ...pending })
      setShareNotice(action === 'email' ? 'PDF downloaded. Attach it to the email draft before sending, then confirm here.' : 'Finish in your messaging app, then confirm here.')
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
          {setup?.plan === 'pro' && !personal && businessId
            ? <ManagedSmsDelivery businessId={businessId} kind={paper.kind} phone={phone} ready={setup.managed_sms_ready} disabled={locked || !pdf} saveDocument={saveForDelivery} onBusyChange={setSending} onSent={onSave} />
            : <div><button type="button" className="primary-button" disabled={locked || !pdf || !setup?.personal_sms_ready || !phoneValid} onClick={() => void prepare('sms')}>Send Text</button>
              <small>{setup?.personal_sms_ready && phoneValid ? 'Opens your texting app' : phoneValid ? 'Text setup required' : ''}</small></div>}
          <div><button type="button" className="primary-button" disabled={locked || !pdf || !emailValid || !setup || !(personal ? setup.personal_email_ready : setup.managed_email_ready && emailDeliveryEnabled)}
            onClick={() => void prepare('email')}>{setup && setup.plan !== 'free' && usePersonal ? 'Open email app' : 'Send Email'}</button>
            {setup && emailValid && (personal ? <small>{setup.personal_email_ready?'Opens your email app':'Email setup required'}</small> : !setup.managed_email_ready && <small>Sender activation required</small>)}</div>
          <div><button type="button" className="secondary-button" disabled={locked} onClick={onSave}>{saved ? 'Open saved draft' : 'Save Draft'}</button></div>
        </div>
        {setup && setup.plan !== 'free' && !personal && privateBetaEmailEnabled && <p className="quiet">Private beta email sends only to approved test addresses.</p>}
        <div className="creation-review-links">
          {!emailValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('email')}>Add email</button>}
          {!phoneValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('phone')}>Add phone</button>}
          {canUpgrade && <button type="button" className="text-button" disabled={locked} onClick={() => void prepare('setup')}>Email &amp; Text Setup</button>}
          {setup && setup.plan !== 'free' && <button type="button" className="text-button" disabled={locked} onClick={() => setUsePersonal(value => !value)}>{usePersonal ? 'Use Finviant sending' : 'Use my email or text app'}</button>}
          {personal && setup && <button type="button" className="text-button" disabled={locked || !pdf} onClick={() => void prepare('copy')}>Copy customer link</button>}
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
    {documentId && businessId ? <DocumentPdfPreview source={{ businessId, kind: paper.kind, documentId }} title={`${paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} PDF`} onReady={setPdf} refreshKey={JSON.stringify([paper.customer, paper.business.document_accent, paper.business.document_footer])} />
      : <div><p role="status">Preparing the saved document and final number…</p>{deliveryError && <button type="button" className="secondary-button" disabled={locked} onClick={() => { publication.current = null; setPublicationAttempt(value => value + 1) }}>Retry preparation</button>}</div>}
    {personal && pdf && <div className="personal-delivery-actions"><button className="secondary-button" disabled={locked} type="button" onClick={() => downloadDocumentPdf(pdf)}>Download PDF to attach</button><button className="secondary-button" disabled={locked} type="button" onClick={() => { void shareDocumentPdf(pdf, `${paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} PDF`).then(result => setShareNotice(result === 'shared' ? 'PDF shared. Use your document sending options to record a completed send.' : result === 'unsupported' ? 'Download the PDF and attach it in your email app.' : 'Sharing cancelled. No send was recorded.')).catch(failure => setDeliveryError(failure.message)) }}>Share PDF</button></div>}
    {canUpgrade && setup?.plan === 'free' && <PlanRestriction plan="free" required="basic" feature="Removing Finviant branding" canUpgrade />}
    {showSetup && businessId && <FormDialog label="Email & Text Setup" onClose={() => setShowSetup(false)} wide>
      <div className="modal-head"><div><h2>Email &amp; Text Setup</h2><p role="status">Your draft is saved. Return to review it when setup is complete.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div>
      <DeliverySetup businessId={businessId} continueLabel="Save and return to preview" onComplete={() => { setShowSetup(false); void refresh().catch(() => {}) }} />
    </FormDialog>}
  </section>
}
