import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { canManageFinances } from '../lib/business'
import { parseQuickInvoice } from '../lib/quickInvoice'
import {getDocumentSettings,type DocumentSettings} from '../services/settings'
import {previewDocumentTotal} from '../lib/financialValidation'
import { listCustomers } from '../services/customers'
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
  const [defaults,setDefaults]=useState<DocumentSettings|null>(null)
  const saving=useRef(false),customerRetry=useRef<{name:string;id:string}|null>(null)
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
    void Promise.all([listCustomers(business.id),getDocumentSettings(business.id)]).then(([rows,settings]) => {
      if(active){setDefaults(settings);setTaxRate(String(settings.default_tax_rate))}
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
    if (saving.current || busy || loading || !defaults || !canManageFinances(business.role) || seed.multipleAmounts) return
    const cost = Number(amount)
    const tax = Number(taxRate)
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(tax) || tax < 0 || tax > 100) {
      setError('Enter a positive amount and a tax rate between 0% and 100%.')
      return
    }
    if (!customerId && !customerName.trim()) {
      setError('Choose an existing customer or enter a new customer name.')
      return
    }
    saving.current=true;setBusy(true)
    setError('')
    try {
      if(customerRetry.current?.name!==customerName.trim())customerRetry.current={name:customerName.trim(),id:crypto.randomUUID()}
      const chosenCustomerId=customerId || customerRetry.current.id
      const signature = JSON.stringify({ chosenCustomerId, description, cost, tax, dueDate })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const invoice = await createInvoice(business.id, { request_id: retryRef.current.requestId,
        customer_id: chosenCustomerId,
        ...(!customerId?{new_customer:{first_name:null,last_name:null,company:customerName.trim(),email:null,phone:null}}:{}),
        payment_links:defaults.payment_links,payment_instructions:defaults.payment_instructions,
        due_date: dueDate || undefined,
        items: [{ description: description.trim(), quantity: 1, unit_price: cost, tax_rate: tax }],
      })
      onSaved(invoice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the invoice. Please try again.')
    } finally {
      saving.current=false;setBusy(false)
    }
  }

  return <section className="quick-invoice-review" aria-label="Review invoice draft">
    <p className="eyebrow">Quick invoice · Owner review required</p>
    <h3>Review the invoice before saving</h3>
    <p className="quick-invoice-original">You said: “{command}”</p>
    {seed.multipleAmounts && <p role="alert" className="form-message error-text">Your request contains multiple amounts. This quick form supports one line item; open the full invoice form to list each charge separately. Nothing has been saved.</p>}
    {seed.multipleAmounts&&<button type="button" className="secondary-button" onClick={()=>{sessionStorage.setItem(`finviant:invoice-handoff:${business.id}`,JSON.stringify({command,description,customerName}));onCancel();window.history.pushState({finviantIndex:(Number(history.state?.finviantIndex)||0)+1},'', '/?view=invoices&new=1&handoff=1');window.dispatchEvent(new PopStateEvent('popstate'))}}>Open full invoice form</button>}
    <form onSubmit={saveDraft} className="quick-invoice-fields">
      <label>Customer
        <select value={customerId} disabled={loading || busy} onChange={event => { setCustomerId(event.target.value); setError('') }}>
          <option value="">Create a new customer</option>
          {customers.map(customer => <option value={customer.id} key={customer.id}>{customerLabel(customer)}</option>)}
        </select>
      </label>
      {!customerId && <label>New customer name or company
        <input value={customerName} disabled={busy} onChange={event => setCustomerName(event.target.value)} placeholder="Customer or business name" required />
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
      <p role="status">Preview total: ${previewDocumentTotal([{quantity:1,unit_price:Number(amount),tax_rate:Number(taxRate)}])?.toFixed(2) ?? 'Check amounts'}</p>
      <p className="quick-invoice-note">Saves a draft only. No invoice is sent or payment requested. Review customer, work, amount, and tax before saving.</p>
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      <div className="preview-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Back</button>
        <button type="submit" className="primary-button" disabled={busy || loading || !defaults || !canManageFinances(business.role) || seed.multipleAmounts}>{busy ? 'Saving draft…' : 'Save draft invoice'}</button>
      </div>
    </form>
  </section>
}
