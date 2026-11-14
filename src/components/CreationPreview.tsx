import {previewAmounts} from '../lib/documentPreview'
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
  simple?: boolean
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

export default function CreationPreview({ paper, busy, error, saved = false, onBack, onSave, onEmail, saveForDelivery, canUpgrade = false, onEditContact, onDraftContact, simple = false }: Props) {
  const [showSetup, setShowSetup] = useState(false)
  const [usePersonal, setUsePersonal] = useState(false)
  const [deliveryExpanded,setDeliveryExpanded]=useState(false)
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
  const locked = busy || sending
  const email = paper.customer?.email?.trim() || ''
  const phone = paper.customer?.phone?.trim() || ''
  const emailValid = validDeliveryEmail(email)
  const phoneValid = !!normalizeMobile(phone)
  const managedEmail=!!setup&&setup.plan!=='free'&&setup.managed_email_ready&&emailDeliveryEnabled&&emailValid
  const managedSms=!!setup&&setup.plan==='pro'&&setup.managed_sms_ready&&/^\+1\d{10}$/.test(normalizeMobile(phone)||'')
  const personalFallback=!!setup&&simple&&setup.plan!=='free'&&!managedEmail&&!managedSms&&((setup.personal_email_ready&&emailValid)||(setup.personal_sms_ready&&phoneValid))
  const personal = !setup || setup.plan === 'free' || usePersonal || personalFallback
  const emailAvailable=!!setup&&emailValid&&(personal?setup.personal_email_ready:managedEmail)
  const smsAvailable=!!setup&&phoneValid&&(personal?setup.personal_sms_ready:managedSms)
  const suggested=emailAvailable?'email':smsAvailable?'sms':null


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
        if (fresh.plan !== 'free' && !usePersonal && !personalFallback) {
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

  function sharePdf(){if(!pdf||locked)return;void shareDocumentPdf(pdf, `${paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} PDF`).then(result => setShareNotice(result === 'shared' ? 'PDF shared. Use your document sending options to record a completed send.' : result === 'unsupported' ? 'Download the PDF and attach it in your email app.' : 'Sharing cancelled. No send was recorded.')).catch(failure => setDeliveryError(failure.message))}

  function editContact(field: 'email' | 'phone') {
    if (onEditContact) onEditContact(field)
    else setContactField(field)
  }

  return <section className={"creation-preview"+(simple?" invoice-simple-review":"")} data-saving={locked ? 'true' : undefined}>
    {simple&&<button type="button" className="icon-button invoice-review-close" aria-label={`Close ${paper.kind} review`} disabled={locked||!documentId} onClick={onSave}>×</button>}
    <button type="button" className="back-button" data-keep-dialog disabled={locked} onClick={onBack}>← Back to edit</button>
    <h2 ref={heading} tabIndex={-1}>{simple?`Review ${paper.kind}`:`${paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} preview`}</h2>
    <p role="status" className="quiet">{documentId?(simple?`Draft saved · Not sent. Check the ${paper.kind} and recipient before sending.`:'Draft saved. Review the PDF before choosing a delivery option.'):deliveryError?'Draft preparation needs attention. Your edits remain available.':'Preparing your saved draft…'}</p>
    {simple&&<article className="invoice-review-paper" aria-label={`${paper.kind==='invoice'?'Invoice':'Estimate'} summary`}><small>{paper.kind==='invoice'?'DRAFT INVOICE':'DRAFT ESTIMATE'}</small><h3>{paper.business.name}</h3>{paper.number&&<p className="quiet">{paper.number}</p>}<p>{paper.kind==='invoice'?'Bill to':'Prepared for'} <strong>{[paper.customer?.first_name,paper.customer?.last_name].filter(Boolean).join(' ')||paper.customer?.company||'Customer'}</strong></p><ul>{paper.items.map((item,index)=><li key={index}><span>{item.description}{Number(item.quantity)!==1&&<small>{item.quantity} × {usd.format(Number(item.unit_price))}</small>}</span><strong>{usd.format(previewAmounts([{...item,tax_rate:0}]).subtotal)}</strong></li>)}</ul>{Number(paper.tax)>0&&<p>Tax <strong>{usd.format(Number(paper.tax))}</strong></p>}<div className="invoice-review-total"><strong>{paper.kind==='invoice'?'Total due':'Estimate total'}</strong><strong>{usd.format(Number(paper.total))}</strong></div><p className="quiet">{paper.kind==='invoice'?'Due':'Valid until'} {paper.ending}</p>{paper.kind==='estimate'&&paper.message&&<p className="quiet">{paper.message}</p>}</article>}
    <section className="creation-review-bar" aria-label="Review and send">
      {!simple&&<div className="creation-review-summary">
        <div><strong>{[paper.customer?.first_name, paper.customer?.last_name].filter(Boolean).join(' ') || paper.customer?.company || 'Customer'}</strong>
          {email && <small>{email}</small>}{phone && <small>{phone}</small>}</div>
        <strong>{usd.format(Number(paper.total))}</strong>
      </div>}
      {handoff ? <div className="creation-handoff">
        <p role="status">{paper.kind === 'estimate' && 'Ready for customer approval. '}Finish in your {handoff.channel === 'email' ? 'email' : 'messaging'} app, then confirm here.</p>
        <button type="button" className="primary-button" disabled={locked} onClick={() => void finishHandoff(true)}>Confirm sent</button>
        <button type="button" className="text-button" disabled={locked} onClick={() => void finishHandoff(false)}>I did not send it</button>
        <a href={handoff.href}>Reopen draft in your app</a>
      </div> : <>
        {simple&&!deliveryExpanded&&<div className="invoice-suggested-delivery">
          {emailAvailable&&<div><p>Email to <strong>{email}</strong></p><button type="button" className="primary-button" disabled={locked||!pdf||!documentId} onClick={()=>void prepare('email')}>{personal?'Open email app':error?'Retry Finviant Email':'Send Finviant Email'}</button></div>}
          {smsAvailable&&(personal?<div><p>Text to <strong>{phone}</strong></p><button type="button" className="secondary-button" disabled={locked||!pdf||!documentId} onClick={()=>void prepare('sms')}>Open text app</button></div>:<ManagedSmsDelivery businessId={businessId!} kind={paper.kind} phone={phone} ready={!!setup?.managed_sms_ready} disabled={locked||!pdf||!documentId} saveDocument={saveForDelivery} onBusyChange={setSending} onSent={onSave} sendLabel="Send Finviant SMS" consentFirst/>)}
          {!suggested&&<p className="quiet">{setup?'No sending method is ready for this customer. Add contact details or review sending setup below.':'Checking available sending methods…'}</p>}
          {privateBetaEmailEnabled&&!personal&&emailAvailable&&<p className="quiet">Private beta email sends only to approved test addresses.</p>}
          <p className="quiet">{personal&&suggested?'Review and send in your app, then confirm here.':'Check the recipient and amount, then tap Send.'}</p>
          <button type="button" className="text-button" onClick={()=>setDeliveryExpanded(true)}>{suggested?'Other delivery options':'Contact & delivery options'}</button>
        </div>}
        {(!simple||deliveryExpanded)&&<><div className="creation-delivery-actions">
          {(!simple||smsAvailable)&&(setup?.plan === 'pro' && !personal && businessId
            ? <ManagedSmsDelivery sendLabel={simple?"Send Finviant SMS":"Send Text"} businessId={businessId} kind={paper.kind} phone={phone} ready={setup.managed_sms_ready} disabled={locked || !pdf} saveDocument={saveForDelivery} onBusyChange={setSending} onSent={onSave} />
            : <div><button type="button" className="primary-button" disabled={locked || !pdf || !setup?.personal_sms_ready || !phoneValid} onClick={() => void prepare('sms')}>{simple?'Open text app':'Send Text'}</button>
              <small>{setup?.personal_sms_ready && phoneValid ? 'Opens your texting app' : phoneValid ? 'Text setup required' : ''}</small></div>)}
          {(!simple||emailAvailable)&&<div><button type="button" className="primary-button" disabled={locked || !pdf || !emailValid || !setup || !(personal ? setup.personal_email_ready : setup.managed_email_ready && emailDeliveryEnabled)}
            onClick={() => void prepare('email')}>{simple?(personal?'Open email app':'Send Finviant Email'):setup && setup.plan !== 'free' && usePersonal ? 'Open email app' : 'Send Email'}</button>
            {setup && emailValid && (personal ? <small>{setup.personal_email_ready?'Opens your email app':'Email setup required'}</small> : !setup.managed_email_ready && <small>Sender activation required</small>)}</div>}
          {!simple&&<div><button type="button" className="secondary-button" disabled={locked} onClick={onSave}>{saved ? 'Open saved draft' : 'Save Draft'}</button></div>}
        </div>
        {setup && setup.plan !== 'free' && !personal && privateBetaEmailEnabled && <p className="quiet">Private beta email sends only to approved test addresses.</p>}
        <div className="creation-review-links">
          {!emailValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('email')}>Add email</button>}
          {!phoneValid && (onEditContact || onDraftContact) && <button type="button" className="text-button" disabled={locked} onClick={() => editContact('phone')}>Add phone</button>}
          {canUpgrade && <button type="button" className="text-button" disabled={locked} onClick={() => void prepare('setup')}>Email &amp; Text Setup</button>}
          {setup && setup.plan !== 'free' && (!simple||(personal?(managedEmail||managedSms):(setup.personal_email_ready||setup.personal_sms_ready))) && <button type="button" className="text-button" disabled={locked} onClick={() => setUsePersonal(simple?!personal:!usePersonal)}>{(simple?personal:usePersonal) ? 'Use Finviant sending' : 'Use my email or text app'}</button>}
          {personal && setup && <button type="button" className="text-button" disabled={locked || !pdf} onClick={() => void prepare('copy')}>Copy customer link</button>}
        </div>{simple&&<button type="button" className="text-button" onClick={()=>setDeliveryExpanded(false)}>Return to suggested delivery</button>}</>}
      </>}
      {contactField && onDraftContact && !onEditContact && <label>{contactField === 'email' ? 'Customer email' : 'Customer phone'}<input
        type={contactField === 'email' ? 'email' : 'tel'} maxLength={contactField === 'email' ? 254 : 40} value={contactField === 'email' ? email : phone}
        disabled={locked} onChange={event => onDraftContact(contactField, event.target.value)} /></label>}
      {setupError && <p role="alert">{setupError} <button type="button" className="text-button" onClick={() => { void refresh().catch(() => {}) }}>Try again</button></p>}
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      {deliveryError && <p role="alert" className="form-message error-text">{deliveryError}</p>}{simple&&deliveryError&&!documentId&&<button type="button" className="secondary-button" disabled={locked} onClick={()=>{publication.current=null;setPublicationAttempt(value=>value+1)}}>Retry preparation</button>}
      {shareNotice && <p role="status">{shareNotice}</p>}
      {copyUrl && <label>Customer link<input readOnly value={copyUrl} onFocus={event => event.target.select()} /></label>}
    </section>
    {simple?<details className="invoice-pdf-export"><summary>PDF &amp; export</summary>{documentId&&businessId?<DocumentPdfPreview source={{businessId,kind:paper.kind,documentId}} title={`${paper.kind==='invoice'?'Invoice':'Estimate'} PDF`} onReady={setPdf} refreshKey={JSON.stringify([paper.customer,paper.business.document_accent,paper.business.document_footer])}/>:<p role="status">Preparing the saved document…</p>}{personal&&pdf&&<button type="button" className="secondary-button" disabled={locked} onClick={sharePdf}>Share PDF</button>}</details>:<>
    {documentId && businessId ? <DocumentPdfPreview source={{ businessId, kind: paper.kind, documentId }} title={`${paper.kind === 'invoice' ? 'Invoice' : 'Estimate'} PDF`} onReady={setPdf} refreshKey={JSON.stringify([paper.customer, paper.business.document_accent, paper.business.document_footer])} />
      : <div><p role="status">Preparing the saved document and final number…</p>{deliveryError && <button type="button" className="secondary-button" disabled={locked} onClick={() => { publication.current = null; setPublicationAttempt(value => value + 1) }}>Retry preparation</button>}</div>}
    {personal && pdf && <div className="personal-delivery-actions"><button className="secondary-button" disabled={locked} type="button" onClick={() => downloadDocumentPdf(pdf)}>Download PDF to attach</button><button className="secondary-button" disabled={locked} type="button" onClick={sharePdf}>Share PDF</button></div>}
    </>}
    {canUpgrade && setup?.plan === 'free' && (!simple||deliveryExpanded) && <PlanRestriction plan="free" required="basic" feature="Removing Finviant branding" canUpgrade />}
    {showSetup && businessId && <FormDialog label="Email & Text Setup" onClose={() => setShowSetup(false)} wide>
      <div className="modal-head"><div><h2>Email &amp; Text Setup</h2><p role="status">Your draft is saved. Return to review it when setup is complete.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div>
      <DeliverySetup businessId={businessId} continueLabel="Save and return to preview" onComplete={() => { setShowSetup(false); void refresh().catch(() => {}) }} />
    </FormDialog>}
  </section>
}
