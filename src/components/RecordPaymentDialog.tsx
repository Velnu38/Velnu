import { useEffect, useRef, useState, type FormEvent } from 'react'
import { customerDisplayName, type CustomerName } from '../lib/customerRecords'
import { readableError } from '../lib/errors'
import { listOpenInvoices, recordPayment } from '../services/payments'
import FormDialog from './FormDialog'

type Invoice = { id: string; invoice_number: string | null; balance_due: number; customers?: CustomerName[] | null }
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const invoiceLabel = (invoice: Invoice) => (invoice.invoice_number || 'Invoice') + ' · ' + customerDisplayName(invoice.customers?.[0])

export default function RecordPaymentDialog({ businessId, invoice, onClose, onSaved }: {
  businessId: string; invoice?: Invoice; onClose: () => void; onSaved: (message: string, date: string) => void
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceId, setInvoiceId] = useState(invoice?.id ?? '')
  const [amount, setAmount] = useState(invoice ? String(invoice.balance_due) : '')
  const [method, setMethod] = useState<'cash' | 'check' | 'card' | 'ach' | 'other'>('other')
  const [notes, setNotes] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!invoice)
  const [loadError, setLoadError] = useState('')
  const [version, setVersion] = useState(0)
  const flight = useRef(false)
  const retry = useRef<{ signature: string; id: string } | null>(null)

  useEffect(() => {
    if (invoice) return
    let active = true
    setLoading(true); setLoadError('')
    void listOpenInvoices(businessId).then(rows => { if (active) setInvoices(rows) })
      .catch(err => { if (active) setLoadError(readableError(err, 'Unable to load unpaid invoices.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [businessId, invoice?.id, version])

  const selected = invoice ?? invoices.find(row => row.id === invoiceId)
  const isFull = !!selected && Number(amount) === Number(selected.balance_due)
  const heading = invoice ? 'Mark Paid' : 'Record a payment already received'

  async function save(event: FormEvent) {
    event.preventDefault()
    if (flight.current || !selected) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0 || value > Number(selected.balance_due)) {
      setError('Enter an amount up to the balance due.')
      return
    }
    if (!window.confirm('Confirm that you received this payment? Finviant records the funds received.')) return
    flight.current = true; setBusy(true); setError('')
    try {
      const signature = JSON.stringify({ invoiceId, value, method, notes })
      if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
      const result = await recordPayment(businessId, { invoice_id: selected.id, amount: value, method, notes, request_id: retry.current.id })
      onSaved(`Payment of ${dollars.format(value)} recorded by ${method}.`, result.paid_at)
      window.dispatchEvent(new Event('finviant-work-changed'))
    } catch (err) {
      setError(readableError(err, 'Unable to record payment.'))
    } finally { flight.current = false; setBusy(false) }
  }

  return <FormDialog label={heading} busy={busy} onClose={onClose}>
    <div className="modal-head"><h2>{heading}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    {loading && <p role="status">Loading unpaid invoices…</p>}
    {loadError && <p role="alert">{loadError} <button type="button" className="text-button" onClick={() => setVersion(value => value + 1)}>Try again</button></p>}
    <form className="form-grid" onSubmit={save}>
      {!invoice && <>
        <label className="full">Find unpaid invoice<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Invoice number or customer" /></label>
        <label className="full">Invoice<select value={invoiceId} required disabled={loading || !!loadError} onChange={event => {
          setInvoiceId(event.target.value)
          setAmount(String(invoices.find(row => row.id === event.target.value)?.balance_due ?? ''))
        }}><option value="">Choose unpaid invoice…</option>{invoices.filter(row => row.id === invoiceId || invoiceLabel(row).toLowerCase().includes(query.trim().toLowerCase()))
          .map(row => <option key={row.id} value={row.id}>{invoiceLabel(row)} · {dollars.format(row.balance_due)}</option>)}</select></label>
        {!loading && !loadError && !invoices.length && <p className="quiet full">There are no issued invoices with a balance due.</p>}
      </>}
      {selected && <p className="quiet full">Balance due {dollars.format(selected.balance_due)}. Enter a smaller amount to record a partial payment.</p>}
      <label>Amount<input type="number" min="0.01" max={selected?.balance_due} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
      <label>Method<select value={method} onChange={event => setMethod(event.target.value as typeof method)}><option value="other">Other</option><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="ach">ACH</option></select></label>
      <label className="full">Notes<input value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} placeholder="Optional note" /></label>
      <p className="quiet full">Record money you already received from the customer.</p>
      {error && <p className="form-message error-text full" role="alert">{error}</p>}
      <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !selected}>{busy ? 'Saving…' : invoice && isFull ? 'Mark Paid' : invoice ? 'Record partial payment' : 'Record payment'}</button></div>
    </form>
  </FormDialog>
}
