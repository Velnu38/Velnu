import { useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { customerActionsEnabled } from '../lib/releaseFlags'

type Props = { businessId: string; invoiceId: string; recipient?: string | null; disabled?: boolean; onSent: () => Promise<void> }

export default function InvoiceEmailButton({ businessId, invoiceId, recipient, disabled, onSent }: Props) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  const pendingId = useRef<string | null>(null)
  const storageKey = `owedly:invoice-email:${businessId}:${invoiceId}`

  function requestId() {
    if (pendingId.current) return pendingId.current
    try { pendingId.current = sessionStorage.getItem(storageKey) } catch { /* Storage may be disabled. */ }
    if (!pendingId.current) pendingId.current = crypto.randomUUID()
    try { sessionStorage.setItem(storageKey, pendingId.current) } catch { /* Keep the in-memory retry ID. */ }
    return pendingId.current
  }

  async function send() {
    if (inFlight.current || !customerActionsEnabled) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: { business_id: businessId, invoice_id: invoiceId, request_id: requestId() },
      })
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const result = await error.context.json().catch(() => null)
          throw new Error(result?.error || 'Unable to send the invoice. Retry the same send.')
        }
        throw error
      }
      if (data?.status !== 'accepted' || !data?.email_id) throw new Error(data?.error || 'No send confirmation was received. Retry the same send.')
      pendingId.current = null
      try { sessionStorage.removeItem(storageKey) } catch { /* No persistent retry ID. */ }
      setConfirm(false)
      setMessage(data.warning || `Email accepted for delivery to ${data.recipient}.`)
      try { await onSent() } catch { setMessage('Email accepted for delivery, but the screen could not refresh. Do not resend just to refresh it.') }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send. Retry this same send.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function startSeparateSend() {
    if (!window.confirm('The previous email may already have been sent. Check invoice activity first. Start a separate email anyway?')) return
    pendingId.current = null
    try { sessionStorage.removeItem(storageKey) } catch { /* No persistent retry ID. */ }
    setMessage('A separate send is ready. Confirm the recipient before sending.')
  }

  return <div className="invoice-email-control">
    <button className="primary-button" disabled={disabled || busy || !recipient || !customerActionsEnabled} title={!recipient ? 'Add a customer email address first.' : undefined} onClick={() => { setConfirm(true); setMessage('') }}>Email customer</button>
    {!recipient && <p className="quiet">Add a customer email address to send this invoice.</p>}
    {!customerActionsEnabled && <p className="quiet">Customer emails are disabled in this private preview until the sender domain is verified. Use Print / Save PDF for testing.</p>}
    {!confirm && message && <p className="form-message" role="status">{message}</p>}
    {confirm && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="email-invoice-title">
      <h2 id="email-invoice-title">Email this invoice?</h2>
      <p>Send the invoice and line items to <strong>{recipient}</strong>.</p>
      <p>Internal notes are not included. Payment is arranged directly with your business; this does not charge the customer.</p>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button className="primary-button" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send invoice'}</button></div>
      {message && <button className="text-button" disabled={busy} onClick={startSeparateSend}>Start a separate send instead</button>}
    </section></div>}
  </div>
}
