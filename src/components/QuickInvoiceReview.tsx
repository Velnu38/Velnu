import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { canWrite } from '../lib/business'
import { parseQuickInvoice } from '../lib/quickInvoice'
import { createCustomer, listCustomers } from '../services/customers'
import { createInvoice } from '../services/invoices'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type SavedInvoice = { id: string; invoice_number: string | null; balance_due: number }

function customerLabel(customer: Customer) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Unnamed customer'
}

export default function QuickInvoiceReview({ business, command, onCancel, onSaved }: {
  business: CurrentBusiness
  command: string
  onCancel: () => void
  onSaved: (invoice: SavedInvoice) => void
}) {
  const seed = parseQuickInvoice(command)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [customerId, setCustomerId] = useState('')
  const [createdCustomerId, setCreatedCustomerId] = useState('')
  const [customerName, setCustomerName] = useState(seed.customerName)
  const [description, setDescription] = useState(seed.description)
  const [amount, setAmount] = useState(seed.amount)
  const [taxRate, setTaxRate] = useState('0')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  useEffect(() => {
    let active = true
    void listCustomers(business.id).then((rows) => {
      if (!active) return
      const data = rows as Customer[]
      setCustomers(data)
      const matching = data.find((item) => customerLabel(item).trim().toLowerCase() === seed.customerName.toLowerCase())
      if (matching) setCustomerId(matching.id)
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load your customers')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id, command])

  async function saveDraft(event: FormEvent) {
    event.preventDefault()
    if (busy || loading || !canWrite(business.role) || seed.multipleAmounts) return
    const cost = Number(amount)
    const tax = Number(taxRate)
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(tax) || tax < 0 || tax > 100) {
      setError('Enter a positive amount and a tax rate between 0% and 100%.')
      return
    }
    if (!customerId && !createdCustomerId && !customerName.trim()) {
      setError('Choose an existing customer or enter a new customer name.')
      return
    }
    setBusy(true)
    setError('')
    try {
      let chosenCustomerId = customerId || createdCustomerId
      if (!chosenCustomerId) {
        // Preserve the dictated name; do not guess at individual versus company name.
        const added = await createCustomer(business.id, { company: customerName.trim() })
        chosenCustomerId = added.id
        setCreatedCustomerId(chosenCustomerId)
      }
      const signature = JSON.stringify({ chosenCustomerId, description, cost, tax, dueDate })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const invoice = await createInvoice(business.id, { request_id: retryRef.current.requestId,
        customer_id: chosenCustomerId,
        due_date: dueDate || undefined,
        items: [{ description: description.trim(), quantity: 1, unit_price: cost, tax_rate: tax }],
      })
      onSaved(invoice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the invoice. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="quick-invoice-review" aria-label="Review invoice draft">
    <p className="eyebrow">Quick invoice · Owner review required</p>
    <h3>Review the invoice before saving</h3>
    <p className="quick-invoice-original">You said: “{command}”</p>
    {seed.multipleAmounts && <p role="alert" className="form-message error-text">Your request contains multiple amounts. This quick form supports one line item; use Invoices → New invoice to list each charge separately. Nothing has been saved.</p>}
    <form onSubmit={saveDraft} className="quick-invoice-fields">
      <label>Customer
        <select value={customerId} disabled={loading || busy || !!createdCustomerId} onChange={event => { setCustomerId(event.target.value); setError('') }}>
          <option value="">Create a new customer</option>
          {customers.map(customer => <option value={customer.id} key={customer.id}>{customerLabel(customer)}</option>)}
        </select>
      </label>
      {!customerId && <label>New customer name or company
        <input value={customerName} disabled={busy || !!createdCustomerId} onChange={event => setCustomerName(event.target.value)} placeholder="Customer or business name" required />
      </label>}
      <label>Work performed / line-item description
        <input value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="e.g. Replace bathroom faucet" required />
      </label>
      <div className="quick-invoice-money">
        <label>Amount ($)
          <input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} required />
        </label>
        <label>Tax (%)
          <input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={event => setTaxRate(event.target.value)} disabled={busy} required />
        </label>
      </div>
      <label>Due date (optional)
        <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={busy} />
      </label>
      <p className="quick-invoice-note">Saves a draft only. No invoice is sent or payment requested. Review customer, work, amount, and tax before saving.</p>
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      <div className="preview-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Back</button>
        <button type="submit" className="primary-button" disabled={busy || loading || !canWrite(business.role) || seed.multipleAmounts}>{busy ? 'Saving draft…' : 'Save draft invoice'}</button>
      </div>
    </form>
  </section>
}
