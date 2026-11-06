import PlanRestriction from '../components/PlanRestriction'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import RecordListControls,{useRecordList} from '../components/RecordListControls'
import FormDialog from '../components/FormDialog'
import { useTierUsage } from '../lib/useTierUsage'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import WorkspaceBack from '../components/WorkspaceBack'
import { FormEvent, lazy,Suspense,useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import ServiceAddressFields, { emptyServiceAddress } from '../components/ServiceAddressFields'
import { createCustomerWithAddress, listCustomers } from '../services/customers'
import CustomerDetail from '../components/CustomerDetail'
import {customerDirectoryName,customerDisplayName} from '../lib/customerRecords'

const ContactImportDialog=lazy(()=>import('../components/ContactImportDialog'))
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
  const usage = useTierUsage(business.id)
  const customerLimit=usage?.plan==='free'&&usage.customers_limit!==null&&usage.customers_used>=usage.customers_limit
  const [showForm, setShowForm] = useState(false)
  const [showImport,setShowImport]=useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(()=>new URLSearchParams(location.search).get('document'))
  const [address, setAddress] = useState(emptyServiceAddress)
  const saving=useRef(false),customerRetry=useRef<{signature:string;id:string}|null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ first_name: '', last_name: '', company: '', phone: '', email: '' })

  function openCustomer(id:string){setSelectedCustomerId(id);history.replaceState(history.state,'','/?view=customers&document='+encodeURIComponent(id))}

  async function refresh() {
    setCustomers((await listCustomers(business.id)) as Customer[])
  }

  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(() => { void refresh().catch(err => setError(readableError(err, 'Unable to load customers'))) }, [business.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if(saving.current)return
    saving.current=true
    setBusy(true)
    setError('')
    try {
      const signature=JSON.stringify({form,address});if(customerRetry.current?.signature!==signature)customerRetry.current={signature,id:crypto.randomUUID()};const created = await createCustomerWithAddress(business.id, form,address,customerRetry.current.id);customerRetry.current=null
      setForm({ first_name: '', last_name: '', company: '', phone: '', email: '' })
      setAddress(emptyServiceAddress())
      setShowForm(false)
      openCustomer(created.id)
    } catch (err) {
      setError(readableError(err, 'Unable to create customer. Your details are still here; try saving again.'))
    } finally {
      saving.current=false
      setBusy(false)
    }
  }

  const records=useRecordList(customers,row=>[row.first_name,row.last_name,row.email,row.phone,row.company].join(' '))
  if (selectedCustomerId) {
    return <CustomerDetail business={business} customerId={selectedCustomerId} onBack={() => { setSelectedCustomerId(null);history.replaceState(history.state,'','/?view=customers');void refresh().catch(e=>setError(e.message)) }} />
  }

  return (
    <div className="page-stack"><WorkspaceBack />
      <div className="page-heading split-heading">
        <div><p className="eyebrow">Customers</p><h1>Everyone you work for, in one place.</h1></div>
        {isPrimaryOwner(business)&&<button type="button" className="secondary-button compact" disabled={customerLimit} onClick={()=>setShowImport(true)}>Import contacts</button>}
        {canWrite(business.role) && <button className="primary-button compact" disabled={customerLimit} onClick={() => setShowForm(true)}>+ New customer</button>}
      </div>
      <p className="quiet">Last name A–Z. Contacts without a last name follow by name or company. Numbered records appear last.</p>
      {customerLimit&&<PlanRestriction plan="free" required="basic" feature="active customers" limit canUpgrade={isPrimaryOwner(business)}/>}
      {error && !showForm && <p role="alert" className="error-text">{error}</p>}
      <RecordListControls label="customers" list={records}/>
      <section className="list-card customer-directory" aria-label="Customer directory">
        {records.total === 0 ? (
          <div className="empty-state"><div className="empty-icon">C</div><h2>{customers.length ? 'No matches' : 'No customers yet'}</h2><p>{customers.length ? 'Try a different search.' : 'Add your first customer or tell Finviant Office to create one.'}</p></div>
        ) : records.visible.map((customer) => {
          const name = customerDirectoryName(customer)
          return <button type="button" className="customer-row customer-row-button" aria-label={`Open contact for ${customerDisplayName(customer)}`} key={customer.id} onClick={() => openCustomer(customer.id)}>
            <div className="avatar">{name.charAt(0).toUpperCase()}</div>
            <div className="row-main"><strong>{name}</strong><span>{customer.company && name !== customer.company ? customer.company : customer.phone || customer.email || 'No contact information'}</span></div>
            {!customer.last_name?.trim()&&<span className="customer-name-note">{customer.first_name?.trim()?'No last name':'Company contact'}</span>}
            <div className="row-meta"><span>{customer.phone || ''}</span><span>{customer.email || ''}</span></div>
            <span className="row-chevron">›</span>
          </button>
        })}
      </section>
      {showImport&&<Suspense fallback={<p role="status">Opening contact import…</p>}><ContactImportDialog businessId={business.id} onClose={()=>setShowImport(false)} onImported={()=>void refresh()}/></Suspense>}
      {showForm && <FormDialog label="Add a customer" busy={busy} onClose={() => setShowForm(false)}>
        <div className="modal-head"><div><p className="eyebrow">New customer</p><h2>Add a customer</h2></div><button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close" type="button">×</button></div>
        <form onSubmit={submit} className="form-grid">
          <label>First name<input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
          <label>Last name<input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
          <label className="full">Company (if applicable)<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <div className="full"><h3>Address</h3><p className="quiet">Saved for service locations, maps and directions. Manage additional service locations in this contact’s Address section.</p></div>
          <ServiceAddressFields value={address} onChange={setAddress}/>
          {error && <p className="form-message error-text full">{error}</p>}
          <div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></div>
        </form>
      </FormDialog>}
    </div>
  )
}
