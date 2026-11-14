import CustomerSquareCheckout from '../components/CustomerSquareCheckout'
import RefreshButton from '../components/RefreshButton'
import { useEffect, useRef, useState } from 'react'
import { getSharedDocument, type SharedDocument } from '../services/personalDelivery'
import { supabase } from '../lib/supabase'
import { safePaymentLinks, invoicePaymentUrl, paymentProviderName } from '../lib/paymentLinks'
import DocumentPdfPreview from '../components/DocumentPdfPreview'
import {recordInvoiceOpen} from '../services/workflowActivity'

type PaymentReadiness = { available: boolean; state: string; message?: string }
function payableDocument(doc:SharedDocument|null) {
  return !!doc&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(doc.revision_id||'')&&doc.kind==='invoice'&&['sent','viewed','partial','overdue'].includes(doc.live_status||doc.status)
    &&['read_only','payment_due'].includes(doc.action_state||'')&&Number.isFinite(Number(doc.live_balance_due??doc.balance_due))&&Number(doc.live_balance_due??doc.balance_due)>0
}
export default function SharedDocumentPage({ token }: { token: string }) {
  const [doc, setDoc] = useState<SharedDocument | null>(null)
  const [error, setError] = useState('')
  const [payment, setPayment] = useState<PaymentReadiness | null>(null)
  const [paying, setPaying] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const checkoutRequest = useRef(crypto.randomUUID())
  const statusRequest=useRef(0)
  const opened=useRef(new Set<string>())
  const [statusVerified,setStatusVerified]=useState(false)
  useEffect(() => {
    let active = true
    const request=++statusRequest.current
    setError(''); setDoc(null); setPayment(null);setStatusVerified(false)
    void getSharedDocument(token).then(async next => {
      if (!active||request!==statusRequest.current) return
      setDoc(next);setStatusVerified(true)
      if(next.kind==='invoice'&&next.revision_id&&['sent','viewed','partial','overdue','paid'].includes(next.live_status||next.status)){
        const key=token+':'+next.revision_id
        if(!opened.current.has(key)){opened.current.add(key);void recordInvoiceOpen(token).catch(()=>{opened.current.delete(key)})}
      }
      if (next.kind === 'invoice' && next.pro_actions_enabled && Number(next.live_balance_due ?? next.balance_due) > 0) {
        const { data, error: failure } = await supabase.functions.invoke('customer-invoice-checkout', { body: { token, mode: 'status', request_id: checkoutRequest.current } })
        if (active&&request===statusRequest.current) setPayment(failure ? { available: false, state: 'unavailable', message: 'Online invoice payment is temporarily unavailable. Contact the business to confirm its status.' } : data)
      }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'This document could not be opened.') })
    return () => { active = false;statusRequest.current++ }
  }, [token, attempt])
  useEffect(() => {
    if (!doc || doc.kind !== 'invoice') return
    let active = true
    const update = () => {
      if (document.visibilityState === 'hidden') return
      const request=++statusRequest.current
      void getSharedDocument(token).then(async next => {
        if(!active||request!==statusRequest.current)return
        setDoc(next);setStatusVerified(true);setError('')
        if(next.pro_actions_enabled){
          const {data,error:failure}=await supabase.functions.invoke('customer-invoice-checkout',{body:{token,mode:'status',request_id:checkoutRequest.current}})
          if(active&&request===statusRequest.current)setPayment(failure?{available:false,state:'unavailable',message:'Current payment status could not be verified. Contact the business before paying.'}:data)
        }
      }).catch(()=>{if(active&&request===statusRequest.current){setStatusVerified(false);setPayment(null);setError('Current invoice status could not be verified. Refresh or contact the business before paying.')}})
    }
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    const pending = payment?.state === 'pending' || new URLSearchParams(window.location.search).get('payment') === 'return'
    const timer = window.setInterval(update, pending?10000:30000)
    return () => { active = false; window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); window.clearInterval(timer) }
  }, [token, doc?.kind, doc?.pro_actions_enabled, payment?.state])

  async function pay() {
    if (paying || !payment?.available || !statusVerified || !payableDocument(doc)) return
    setPaying(true); setError('')
    try {
      const { data, error: failure } = await supabase.functions.invoke('customer-invoice-checkout', { body: { token, mode: 'checkout', request_id: checkoutRequest.current } })
      if (failure || !data?.available || typeof data.checkout_url !== 'string') throw new Error(data?.message || 'Payment could not be opened. No payment has been recorded.')
      const url = new URL(data.checkout_url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) throw new Error('The payment address could not be verified. Contact the business.')
      window.location.assign(url.href)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Payment could not be opened.') }
    finally { setPaying(false) }
  }

  if (error && !doc) return <main className="share-document"><h1>Document unavailable</h1><p role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button><p>Contact the issuing business if this link was revoked.</p></main>
  if (!doc) return <main className="share-document" role="status">Opening your document…</main>
  const label = doc.kind === 'invoice' ? 'Invoice' : doc.kind === 'estimate' ? 'Estimate' : 'Change order'
  const status = doc.live_status || doc.status
  const balance = Number(doc.live_balance_due ?? doc.balance_due ?? doc.total)
  const canPay=statusVerified&&payableDocument(doc)&&(!doc.pro_actions_enabled||!!payment&&['ready','not_connected','disabled'].includes(payment.state))
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: doc.currency || 'USD' }).format(value)
  return <main className="share-document">
    <header className="customer-document-summary"><div><p className="eyebrow">{doc.company.name}</p><h1>{label} {doc.number}</h1></div><p>Status: <strong>{status.replaceAll('_', ' ')}</strong></p></header>
    <DocumentPdfPreview source={{ token, tokenType: 'share' }} title={`${label} ${doc.number}`} />
    <section className="customer-document-live" aria-label="Document status and actions">
      <div className="refresh-heading"><h2>{doc.kind === 'invoice' ? 'Payment status' : 'Approval status'}</h2><RefreshButton label="Refresh status" onClick={() => setAttempt(value => value + 1)}/></div>
      {doc.kind === 'invoice' ? <>
        <p>Paid: {money(Number(doc.live_amount_paid ?? doc.amount_paid ?? 0))}</p><p><strong>Current balance: {money(balance)}</strong></p>
        {balance <= 0 && status === 'paid' ? <p>This invoice is paid. Keep the PDF for your records.</p> : <>
          {!payableDocument(doc)&&<p>{doc.action_reason||'This document copy is read only. Contact the business for the current invoice before paying.'}</p>}
          {canPay&&payment?.available && <button type="button" className="primary-button" disabled={paying} onClick={() => void pay()}>{paying ? 'Opening secure payment…' : 'Pay invoice with Stripe'}</button>}
          {doc.pro_actions_enabled&&statusVerified&&payableDocument(doc)&&<CustomerSquareCheckout token={token} blocked={!!payment&&['pending','review_required'].includes(payment.state)}/>}
          {payment && !payment.available && <p>{payment.message || 'Online invoice payment is not activated. Contact the business or use its payment instructions.'}</p>}
          {canPay&&doc.payment_instructions && <p>{doc.payment_instructions}</p>}
          {canPay&&safePaymentLinks(doc.payment_links).length > 0 && <><p>Other payment options are confirmed by the business after payment.</p><div className="personal-delivery-actions">{safePaymentLinks(doc.payment_links).map(link => <a key={link.provider} className="secondary-button" href={invoicePaymentUrl(link, balance, doc.number, doc.currency || 'USD')} rel="noopener noreferrer" target="_blank">Pay with {paymentProviderName(link.provider)}</a>)}</div></>}
        </>}
      </> : doc.completed ? <><p><strong>{doc.completed.action === 'approved' ? 'Approved' : 'Declined'}</strong> by {doc.completed.typed_name} on {new Date(doc.completed.created_at).toLocaleString()}.</p><p>Your decision is recorded with this document version.</p></>
        : doc.approval_token ? <a className="primary-button" href={'/?approval=' + encodeURIComponent(doc.approval_token)}>Review and {doc.kind === 'estimate' ? 'accept estimate' : 'approve change order'}</a>
        : <p>{doc.action_reason || 'This document is available for viewing. Contact the business with your decision or questions.'}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="quiet">The PDF preserves the issued document. Payment and approval status above can update separately.</p>

    </section>
    <p>{doc.company.email} {doc.company.phone}</p><p className="quiet">Keep this private document link secure.</p>
  </main>
}
