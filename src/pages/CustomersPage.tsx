import { FormEvent, useEffect, useMemo, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { createCustomer, listCustomers } from '../services/customers'
import CustomerDetail from '../components/CustomerDetail'

type Customer = {
  id: string
  first_name: string | null
  last_name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

export default function CustomersPage({ business }: { business: CurrentBusiness }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ first_name: '', last_name: '', company: '', phone: '', email: '' })

  async function refresh() {
    setCustomers((await listCustomers(business.id)) as Customer[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load customers')) }, [business.id])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) => [customer.first_name, customer.last_name, customer.company, customer.phone, customer.email]
      .filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [customers, query])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await createCustomer(business.id, form)
      setForm({ first_name: '', last_name: '', company: '', phone: '', email: '' })
      setShowForm(false)
      await refresh()
      setSelectedCustomerId(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create customer')
    } finally {
      setBusy(false)
    }
  }

  if (selectedCustomerId) {
    return <CustomerDetail business={business} customerId={selectedCustomerId} onBack={() => { setSelectedCustomerId(null); refresh() }} />
  }

  return (
    <div className="page-stack">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">Customers</p><h1>Everyone you work for, in one place.</h1></div>
        {canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New customer</button>}
      </div>
      <div className="toolbar"><input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers…" /></div>
      <section className="list-card">
        {visible.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">C</div><h2>{customers.length ? 'No matches' : 'No customers yet'}</h2><p>{customers.length ? 'Try a different search.' : 'Add your first customer or tell Finviant Office to create one.'}</p></div>
        ) : visible.map((customer) => {
          const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Unnamed customer'
          return <button className="customer-row customer-row-button" key={customer.id} onClick={() => setSelectedCustomerId(customer.id)}>
            <div className="avatar">{name.charAt(0).toUpperCase()}</div>
            <div className="row-main"><strong>{name}</strong><span>{customer.company && name !== customer.company ? customer.company : customer.phone || customer.email || 'No contact information'}</span></div>
            <div className="row-meta"><span>{customer.phone || ''}</span><span>{customer.email || ''}</span></div>
            <span className="row-chevron">›</span>
          </button>
        })}
      </section>
      {showForm && <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">New customer</p><h2>Add a customer</h2></div><button className="icon-button" onClick={() => setShowForm(false)}>×</button></div>
        <form onSubmit={submit} className="form-grid">
          <label>First name<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
          <label>Last name<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
          <label className="full">Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          {error && <p className="form-message error-text full">{error}</p>}
          <div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></div>
        </form>
      </section></div>}
    </div>
  )
}
