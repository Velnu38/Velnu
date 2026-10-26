import { FormEvent, useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listOpenInvoices, listPayments, recordPayment } from '../services/payments'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type OpenInvoice = { id: string; invoice_number: string | null; total: number; amount_paid: number; balance_due: number; customers: Customer[] | null }
type InvoiceRelation = { invoice_number: string | null; total: number; balance_due: number; customers: Customer[] | null }
type Payment = { id: string; amount: number; method: string | null; status: string; paid_at: string; notes: string | null; invoices: InvoiceRelation[] | null }

function customerName(customer?: Customer) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function PaymentsPage({ business }: { business: CurrentBusiness }) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([])
  const [showForm, setShowForm] = useState(false)
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'check' | 'card' | 'ach' | 'other'>('other')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [paymentRows, invoiceRows] = await Promise.all([listPayments(business.id), listOpenInvoices(business.id)])
    setPayments(paymentRows as Payment[])
    setOpenInvoices(invoiceRows as OpenInvoice[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load payments')) }, [business.id])

  const selected = openInvoices.find((invoice) => invoice.id === invoiceId)

  function resetForm() {
    setInvoiceId(''); setAmount(''); setMethod('other'); setNotes(''); setError(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!window.confirm('Confirm that you have actually received this payment? This records money received; it does not charge a card or bank account.')) return
      const signature = JSON.stringify({ invoiceId, amount, method, notes })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      await recordPayment(business.id, { invoice_id: invoiceId, amount: Number(amount), method, notes, request_id: retryRef.current.requestId })
      resetForm(); setShowForm(false); await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record payment')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Payments</p><h1>See what came in and what is still owed.</h1></div>{canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ Record payment</button>}</div>
    <section className="list-card">
      {payments.length === 0 ? <div className="empty-state"><div className="empty-icon">$</div><h2>No payments yet</h2><p>Record a payment here when you have actually received the funds.</p></div> : payments.map((payment) => {
        const invoice = payment.invoices?.[0]
        const customer = invoice?.customers?.[0]
        return <article className="document-row" key={payment.id}>
          <div className="row-main"><strong>{customerName(customer)}</strong><span>{invoice?.invoice_number || 'Invoice'} · {new Date(payment.paid_at).toLocaleDateString()} · {payment.method || 'other'}</span></div>
          <strong className="money paid-money">+${Number(payment.amount).toFixed(2)}</strong>
          <span className={`status-chip ${payment.status === 'succeeded' ? 'paid' : ''}`}>{payment.status === 'succeeded' ? 'Recorded' : payment.status}</span>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Record payment</p><h2>Record a payment already received</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form className="form-grid" onSubmit={submit}>
        <label className="full">Invoice<select value={invoiceId} onChange={(e) => { const id = e.target.value; setInvoiceId(id); const inv = openInvoices.find((x) => x.id === id); if (inv) setAmount(String(inv.balance_due)) }} required><option value="">Choose unpaid invoice…</option>{openInvoices.map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.invoice_number || 'Invoice'} · {customerName(invoice.customers?.[0])} · ${Number(invoice.balance_due).toFixed(2)} due</option>)}</select></label>
        <label>Amount<input type="number" min="0.01" max={selected ? Number(selected.balance_due) : undefined} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <label>Method<select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="ach">ACH</option><option value="other">Other</option></select></label>
        <label className="full">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" /></label>
        {selected && <p className="form-message full">This does not charge a card or bank account. Current invoice balance: ${Number(selected.balance_due).toFixed(2)}</p>}
        {error && <p className="form-message error-text full">{error}</p>}
        <div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></div>
      </form>
    </section></div>}
  </div>
}
