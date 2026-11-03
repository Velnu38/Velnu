import FormDialog from '../components/FormDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { DateTime } from 'luxon'
import RecordListControls, { useRecordList } from '../components/RecordListControls'
import { adjustedPrice } from '../lib/paymentLinks'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { getDocumentSettings } from '../services/settings'
import { previewDocumentTotal } from '../lib/financialValidation'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createInvoice, listInvoices } from '../services/invoices'
import InvoiceDetail from '../components/InvoiceDetail'
import CustomerEntry, { emptyCustomerDraft, newCustomerFields } from '../components/CustomerEntry'
import PaymentOptionsFields, { type DocumentPayments } from '../components/PaymentOptionsFields'
import { validPaymentLink } from '../lib/paymentLinks'
import '../components/scheduling/scheduling.css'
import { getJob } from '../services/jobs'
import { createJobInvoice } from '../services/schedulingWorkflow'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Invoice = { id: string; invoice_number: string | null; status: string; issue_date: string; due_date: string | null; subtotal: number; tax_amount: number; total: number; amount_paid: number; balance_due: number; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

export default function InvoicesPage({ business }: { business: CurrentBusiness }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('document'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerDraft,setCustomerDraft]=useState(emptyCustomerDraft)
  const customerRequest=useRef<{signature:string;id:string}|null>(null)
  const saving=useRef(false)
  const [defaultPayments,setDefaultPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [documentPayments,setDocumentPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [dueDate, setDueDate] = useState('')
  const [issueDate, setIssueDate] = useState(() => DateTime.now().setZone(business.timezone || 'UTC').toISODate()!)
  const [notes, setNotes] = useState('')
  const [defaultTax, setDefaultTax] = useState(0)
  const [pricingAdjustment,setPricingAdjustment] = useState(0)
  const [adjustPrices,setAdjustPrices] = useState(false)
  const [defaultsReady,setDefaultsReady] = useState(false)
  useEffect(() => { let active=true; void getDocumentSettings(business.id).then(d=>{if(active){setDefaultTax(Number(d.default_tax_rate));setDefaultPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDocumentPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setPricingAdjustment(Number(d.pricing_adjustment_percent));setDefaultsReady(true)}}).catch(()=>{if(active)setError('Unable to load document defaults. Reload before creating a document.')}); return()=>{active=false} },[business.id])
  const quickCreate=useRef(new URLSearchParams(window.location.search).get('new')==='1')
  useEffect(()=>{if(defaultsReady&&quickCreate.current&&canManageFinances(business.role)){quickCreate.current=false;resetForm();setShowForm(true);const url=new URL(location.href);url.searchParams.delete('new');history.replaceState(history.state,'',url.pathname+url.search)}},[defaultsReady,business.role])
  const newLine = (): Line => ({...blankLine(),tax_rate:String(defaultTax)})
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)
  const [sourceJob,setSourceJob]=useState<{id:string;title:string}|null>(null)
  const openingJob=useRef(false)
  useEffect(()=>{
    const jobId=new URLSearchParams(window.location.search).get('job')
    if(!jobId||openingJob.current||!defaultsReady||!canManageFinances(business.role))return
    let active=true
    void getJob(business.id,jobId).then(job=>{if(!active)return;openingJob.current=true;setSourceJob({id:job.id,title:job.title});setCustomerId(job.customer_id);setLines([{description:job.description || job.title,quantity:'1',unit_price:'',tax_rate:String(defaultTax)}]);setShowForm(true)})
      .catch(e=>{if(active)setError(e.message)})
    return()=>{active=false}
  },[business.id,business.role,defaultsReady,defaultTax])

  async function refresh() {
    const [invoiceRows, customerRows] = await Promise.all([listInvoices(business.id), listCustomers(business.id)])
    setInvoices(invoiceRows as Invoice[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load invoices')) }, [business.id])

  const pricedLines = useMemo(() => adjustPrices && isPrimaryOwner(business) ? lines.map(line => { try { return {...line,unit_price:line.unit_price ? adjustedPrice(line.unit_price,pricingAdjustment) : ''} } catch { return {...line,unit_price:'invalid'} } }) : lines,[lines,adjustPrices,pricingAdjustment,business.primary_owner])
  const previewTotal = useMemo(() => previewDocumentTotal(pricedLines), [pricedLines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }

  function resetForm() {
    setIssueDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!); setCustomerId('');setCustomerDraft(emptyCustomerDraft());customerRequest.current=null;setDocumentPayments(defaultPayments); setDueDate(''); setNotes(''); setLines([newLine()]); setAdjustPrices(false); setError(''); setSourceJob(null); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if(saving.current)return;saving.current=true;setBusy(true); setError('')
    try {
      if(previewTotal === null)throw new Error('Check the description, quantity, price and tax on each line.')
      if(documentPayments.payment_links.some(link=>!validPaymentLink(link)))throw new Error('Enter a valid HTTPS link for each selected payment method.')
      let customer={customer_id:customerId,new_customer:undefined as ReturnType<typeof newCustomerFields>|undefined}
      if(!customerId){
        const fields=newCustomerFields(customerDraft),signature=JSON.stringify(fields)
        if(customerRequest.current?.signature!==signature)customerRequest.current={signature,id:crypto.randomUUID()}
        customer={customer_id:customerRequest.current.id,new_customer:fields}
      }
      const payments=isPrimaryOwner(business)?documentPayments:{}
      const signature = JSON.stringify({ issueDate, customer, payments, dueDate, notes, lines: pricedLines })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const input = { request_id: retryRef.current.requestId,
        ...customer,...payments,
        issue_date: issueDate,
        due_date: dueDate || undefined,
        notes,
        items: pricedLines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      }
      const created = sourceJob ? await createJobInvoice(sourceJob.id,retryRef.current.requestId,input.items,dueDate || undefined,{issue_date:issueDate,notes,...payments}) : await createInvoice(business.id,input)
      resetForm(); setShowForm(false); await refresh(); history.replaceState(history.state,'','/?view=invoices&document='+encodeURIComponent(created.id));setSelectedInvoiceId(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice')
    } finally { saving.current=false;setBusy(false) }
  }


  const recordList = useRecordList(invoices, row => [row.invoice_number, customerName(row.customers?.[0]), row.issue_date, row.status].join(' '))

  if (selectedInvoiceId) return <InvoiceDetail business={business} invoiceId={selectedInvoiceId} onBack={() => { setSelectedInvoiceId(null);history.replaceState(history.state,'','/?view=invoices');void refresh().catch(e=>setError(e.message)) }} />

  return <div className="page-stack"><WorkspaceBack />
    <div className="page-heading split-heading"><div><p className="eyebrow">Invoices</p><h1>Know what’s owed and get paid faster.</h1></div>{canManageFinances(business.role) && <button className="primary-button compact" disabled={!defaultsReady} onClick={() => { resetForm(); setShowForm(true) }}>+ New invoice</button>}</div>
    <RecordListControls label="invoices" list={recordList} />
    {error && !showForm && <p role="alert" className="form-message error-text">{error}</p>}
    <section className="list-card">
      {invoices.length === 0 ? <div className="empty-state"><div className="empty-icon">I</div><h2>No invoices yet</h2><p>Create your first invoice here or tell Finviant Office what to bill.</p></div> : recordList.visible.map((invoice) => {
        const customer = invoice.customers?.[0]
        return <article className="document-row invoice-list-row" key={invoice.id}>
          <button className="invoice-open" onClick={() => setSelectedInvoiceId(invoice.id)}><div className="row-main"><strong>{invoice.invoice_number || 'Draft invoice'}</strong><span>{customerName(customer)} · {new Date(invoice.issue_date + 'T00:00:00').toLocaleDateString()}{invoice.due_date ? ` · Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : ''}</span></div></button>
          <div className="invoice-money"><strong className="money">${Number(invoice.balance_due).toFixed(2)}</strong><span>of ${Number(invoice.total).toFixed(2)} due</span></div>
          <span className={`status-chip ${invoice.status === 'paid' ? 'paid' : ''}`}>{invoice.status.replaceAll('_', ' ')}</span>
        </article>
      })}
    </section>
    {showForm && <FormDialog label="Invoices form" busy={busy} onClose={() => { setShowForm(false); resetForm() }} wide>
      <div className="modal-head"><div><p className="eyebrow">New invoice</p><h2>{sourceJob ? `Invoice for ${sourceJob.title}` : 'Create an invoice'}</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }} aria-label="Close" type="button">×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><CustomerEntry customers={customers} value={customerId} draft={customerDraft} onChange={setCustomerId} onDraft={setCustomerDraft} disabled={busy||!!sourceJob}/><label>Issue date<input type="date" required max={DateTime.now().setZone(business.timezone || 'UTC').toISODate()!} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></label><label>Due date<input type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><label>Internal notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        {sourceJob&&<p className="quiet">Customer and scope carried over from the job. Review the work, price and tax before saving the invoice draft.</p>}
        <div className="line-items"><div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" onClick={() => setLines([...lines, newLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" step="0.01" max="100" aria-label="Tax rate (%)" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [newLine()] : lines.filter((_, i) => i !== index))} aria-label="Remove line item">×</button></div>)}</div>
        {isPrimaryOwner(business) && pricingAdjustment>0 && <label className="settings-checkbox"><input type="checkbox" checked={adjustPrices} onChange={e=>setAdjustPrices(e.target.checked)}/>Include payment costs in line prices (+{pricingAdjustment}%) for all payment methods</label>}
        <PaymentOptionsFields value={documentPayments} onChange={setDocumentPayments} editable={isPrimaryOwner(business)}/><div className="estimate-total"><span>Preview total</span><strong>{previewTotal === null ? 'Check line amounts' : '$' + previewTotal.toFixed(2)}</strong><small>Final totals are calculated by Finviant Office when saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create invoice'}</button></div>
      </form>
    </FormDialog>}
  </div>
}
