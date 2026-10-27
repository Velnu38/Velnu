import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createInvoice, listInvoices } from '../services/invoices'
import InvoiceDetail from '../components/InvoiceDetail'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Invoice = { id: string; invoice_number: string | null; status: string; issue_date: string; due_date: string | null; subtotal: number; tax_amount: number; total: number; amount_paid: number; balance_due: number; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

export default function InvoicesPage({ business }: { business: CurrentBusiness }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const [invoiceRows, customerRows] = await Promise.all([listInvoices(business.id), listCustomers(business.id)])
    setInvoices(invoiceRows as Invoice[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load invoices')) }, [business.id])

  const previewTotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0)
    const price = Number(line.unit_price || 0)
    const tax = Number(line.tax_rate || 0)
    const base = Number.isFinite(quantity * price) ? quantity * price : 0
    return sum + base + (base * tax / 100)
  }, 0), [lines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }

  function resetForm() {
    setCustomerId(''); setDueDate(''); setNotes(''); setLines([blankLine()]); setError(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const signature = JSON.stringify({ customerId, dueDate, notes, lines })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const created = await createInvoice(business.id, { request_id: retryRef.current.requestId,
        customer_id: customerId,
        due_date: dueDate || undefined,
        notes,
        items: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      })
      resetForm(); setShowForm(false); await refresh(); setSelectedInvoiceId(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice')
    } finally { setBusy(false) }
  }


  if (selectedInvoiceId) return <InvoiceDetail business={business} invoiceId={selectedInvoiceId} onBack={() => { setSelectedInvoiceId(null); refresh() }} />

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Invoices</p><h1>Know what’s owed and get paid faster.</h1></div>{canManageFinances(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New invoice</button>}</div>
    <section className="list-card">
      {invoices.length === 0 ? <div className="empty-state"><div className="empty-icon">I</div><h2>No invoices yet</h2><p>Create your first invoice here or tell Velnu what to bill.</p></div> : invoices.map((invoice) => {
        const customer = invoice.customers?.[0]
        return <article className="document-row invoice-list-row" key={invoice.id}>
          <button className="invoice-open" onClick={() => setSelectedInvoiceId(invoice.id)}><div className="row-main"><strong>{invoice.invoice_number || 'Draft invoice'}</strong><span>{customerName(customer)} · {new Date(invoice.issue_date + 'T00:00:00').toLocaleDateString()}{invoice.due_date ? ` · Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : ''}</span></div></button>
          <div className="invoice-money"><strong className="money">${Number(invoice.balance_due).toFixed(2)}</strong><span>of ${Number(invoice.total).toFixed(2)} due</span></div>
          <span className={`status-chip ${invoice.status === 'paid' ? 'paid' : ''}`}>{invoice.status.replaceAll('_', ' ')}</span>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">New invoice</p><h2>Create an invoice</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><label className="full">Customer<select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customerName(customer)}</option>)}</select></label><label>Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><label>Internal notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        <div className="line-items"><div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="estimate-total"><span>Preview total</span><strong>${previewTotal.toFixed(2)}</strong><small>Final totals are calculated by Velnu when saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create invoice'}</button></div>
      </form>
    </section></div>}
  </div>
}
