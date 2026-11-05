import CustomerEditDialog from '../components/CustomerEditDialog'
import CreationPreview from '../components/CreationPreview'
import {documentEndDate,previewAmounts} from '../lib/documentPreview'
import {sendReviewedDocument} from '../services/reviewDelivery'
import {validateDocumentInput} from '../lib/financialValidation'
import CustomerRecordScope from '../components/CustomerRecordScope'
import { customerRecordsHref } from '../lib/customerRecords'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import DocumentLineEditor from '../components/DocumentLineEditor'
import {CreatedStamp,type DocumentDates} from '../components/DocumentRecord'
import FormDialog from '../components/FormDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { DateTime } from 'luxon'
import RecordListControls, { RecordListPagination, useRecordList } from '../components/RecordListControls'
import { adjustedPrice } from '../lib/paymentLinks'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { getDocumentSettings } from '../services/settings'
import { previewDocumentTotal } from '../lib/financialValidation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createInvoice, listInvoices } from '../services/invoices'
import InvoiceDetail from '../components/InvoiceDetail'
import CustomerEntry, { emptyCustomerDraft, newCustomerFields } from '../components/CustomerEntry'
import { type DocumentPayments } from '../components/PaymentOptionsFields'
import { validPaymentLink } from '../lib/paymentLinks'
import '../components/scheduling/scheduling.css'
import { getJob } from '../services/jobs'
import { createJobInvoice } from '../services/schedulingWorkflow'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?:string|null; phone?:string|null }
type Invoice = DocumentDates & { customer_id: string; id: string; invoice_number: string | null; status: string; issue_date: string; due_date: string | null; subtotal: number; tax_amount: number; total: number; amount_paid: number; balance_due: number; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type InvoiceFilter = 'all' | 'open' | 'draft' | 'sent' | 'paid' | 'overdue'

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })
const invoiceMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function InvoicesPage({ business }: { business: CurrentBusiness }) {
  const customerScope = new URLSearchParams(window.location.search).get('customer') || ''
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [statusFilter, setStatusFilter] = useState<InvoiceFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [editCreatedInvoice,setEditCreatedInvoice]=useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('document'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerDraft,setCustomerDraft]=useState(emptyCustomerDraft)
  const customerRequest=useRef<{signature:string;id:string}|null>(null)
  const saving=useRef(false)
  const [creationPreview,setCreationPreview]=useState(false)
  const savedCreation=useRef<string|null>(null)
  const [editCreationCustomer,setEditCreationCustomer]=useState(false)
  const dateEdited=useRef(false)
  const [defaultPayments,setDefaultPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [documentPayments,setDocumentPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [dueDate, setDueDate] = useState(() => documentEndDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!, 'invoice'))
  const [issueDate, setIssueDate] = useState(() => DateTime.now().setZone(business.timezone || 'UTC').toISODate()!)
  const [notes, setNotes] = useState('')
  const [defaultTax, setDefaultTax] = useState(0)
  const [pricingAdjustment,setPricingAdjustment] = useState(0)
  const [adjustPrices,setAdjustPrices] = useState(false)
  const [defaultsReady,setDefaultsReady] = useState(false)
  useEffect(() => { let active=true; void getDocumentSettings(business.id).then(d=>{if(active){setDefaultTax(Number(d.default_tax_rate));setDefaultPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDocumentPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setPricingAdjustment(Number(d.pricing_adjustment_percent));setDefaultsReady(true)}}).catch(()=>{if(active)setError('Unable to load document defaults. Reload before creating a document.')}); return()=>{active=false} },[business.id])
  const quickCreate=useRef(new URLSearchParams(window.location.search).get('new')==='1')
  useEffect(()=>{if(defaultsReady&&quickCreate.current&&canManageFinances(business.role)){quickCreate.current=false;resetForm();setShowForm(true);const url=new URL(location.href);url.searchParams.delete('new');history.replaceState(history.state,'',url.pathname+url.search)}},[defaultsReady,business.role])
  const [handoff,setHandoff]=useState('')
  useEffect(()=>{if(!showForm||!new URLSearchParams(location.search).has('handoff'))return;try{const raw=sessionStorage.getItem(`finviant:invoice-handoff:${business.id}`);if(raw){const data=JSON.parse(raw);setHandoff(data.command);setNotes('Dictated request: '+data.command);setCustomerDraft({...emptyCustomerDraft(),name:data.customerName||''});setLines([{...blankLine(),description:data.description||'',tax_rate:String(defaultTax)}]);sessionStorage.removeItem(`finviant:invoice-handoff:${business.id}`)}}catch{setError('Unable to restore the dictated request. Paste it into the notes before continuing.')}const u=new URL(location.href);u.searchParams.delete('handoff');history.replaceState(history.state,'',u.pathname+u.search)},[showForm,business.id,defaultTax])
  const newLine = (): Line => ({...blankLine(),tax_rate:String(defaultTax)})
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)
  const [sourceJob,setSourceJob]=useState<{id:string;title:string}|null>(null)
  const openingJob=useRef(false)
  useEffect(()=>{
    const jobId=new URLSearchParams(window.location.search).get('job')
    if(!jobId||openingJob.current||!defaultsReady||!canManageFinances(business.role))return
    let active=true
    void getJob(business.id,jobId).then(job=>{if(!active)return;openingJob.current=true;setSourceJob({id:job.id,title:job.title});setCustomerId(job.customer_id);setLines([{description:job.title,quantity:'1',unit_price:'',tax_rate:String(defaultTax)}]);setShowForm(true)})
      .catch(e=>{if(active)setError(e.message)})
    return()=>{active=false}
  },[business.id,business.role,defaultsReady,defaultTax])

  async function refresh() {
    const [invoiceRows, customerRows] = await Promise.all([listInvoices(business.id, customerScope), listCustomers(business.id)])
    setInvoices(invoiceRows as Invoice[])
    setCustomers(customerRows as Customer[])
  }

  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load invoices')) }, [business.id])

  const pricedLines = useMemo(() => adjustPrices && isPrimaryOwner(business) ? lines.map(line => { try { return {...line,unit_price:line.unit_price ? adjustedPrice(line.unit_price,pricingAdjustment) : ''} } catch { return {...line,unit_price:'invalid'} } }) : lines,[lines,adjustPrices,pricingAdjustment,business.primary_owner])
  const previewTotal = useMemo(() => previewDocumentTotal(pricedLines), [pricedLines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }


  const creationCustomer=customerId?customers.find(c=>c.id===customerId):{first_name:customerDraft.name,last_name:null,company:customerDraft.company,email:customerDraft.email,phone:customerDraft.phone}
  async function finishCreation(id:string,edit=false){setEditCreatedInvoice(edit);resetForm();setShowForm(false);history.replaceState(history.state,'',customerRecordsHref('invoices',customerScope,id));setSelectedInvoiceId(id);void refresh().catch(()=>{})}
  function reviewCreation(event:React.FormEvent){
    event.preventDefault();setError('')
    try{
      if(!customerId)newCustomerFields(customerDraft)
      validateDocumentInput({customer_id:customerId||'new',issue_date:issueDate,due_date:dueDate,items:pricedLines.map(l=>({description:l.description,quantity:Number(l.quantity),unit_price:Number(l.unit_price),tax_rate:Number(l.tax_rate)}))})
      if(documentPayments.payment_links.some(link=>!validPaymentLink(link)))throw new Error('Enter a valid HTTPS payment link.')
      setCreationPreview(true)
    }catch(e){setError(e instanceof Error?e.message:'Check the document details.')}
  }

  function resetForm() {
    setCreationPreview(false); savedCreation.current=null; dateEdited.current=false
    setIssueDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!); setCustomerId('');setCustomerDraft(emptyCustomerDraft());customerRequest.current=null;setDocumentPayments(defaultPayments); setDueDate(documentEndDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!, 'invoice')); setNotes(''); setLines([newLine()]); setAdjustPrices(false); setError(''); setSourceJob(null); retryRef.current = null
  }

  async function submit(sendEmail=false) {
     if(saving.current)return;saving.current=true;setBusy(true); setError('')
    try {
      if(savedCreation.current){
        if(sendEmail)await sendReviewedDocument(business.id, 'invoice',savedCreation.current,creationCustomer?.email||'');
        await finishCreation(savedCreation.current); return
      }
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
      savedCreation.current=created.id
      if(sendEmail)await sendReviewedDocument(business.id, 'invoice',created.id,creationCustomer?.email||'')
      await finishCreation(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice')
    } finally { saving.current=false;setBusy(false) }
  }


  const today = DateTime.now().setZone(business.timezone || 'UTC').toISODate()!
  function invoiceIsOverdue(invoice: Invoice) {
    return Number(invoice.balance_due) > 0 && invoice.status !== 'draft' && invoice.status !== 'void'
      && (invoice.status === 'overdue' || !!invoice.due_date && invoice.due_date < today)
  }
  function invoiceStatus(invoice: Invoice) {
    if (invoice.status === 'void') return 'Void'
    if (Number(invoice.balance_due) <= 0 || invoice.status === 'paid') return 'Paid'
    if (invoiceIsOverdue(invoice)) return 'Overdue'
    if (invoice.status === 'partial') return 'Partly paid'
    return invoice.status.replaceAll('_', ' ')
  }
  const filteredInvoices = useMemo(() => invoices.filter(invoice => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'open') return Number(invoice.balance_due) > 0 && !['draft', 'void'].includes(invoice.status)
    if (statusFilter === 'draft') return invoice.status === 'draft'
    if (statusFilter === 'sent') return ['sent', 'viewed', 'partial'].includes(invoice.status) && !invoiceIsOverdue(invoice)
    if (statusFilter === 'paid') return invoice.status === 'paid' || Number(invoice.balance_due) <= 0 && invoice.status !== 'void'
    return invoiceIsOverdue(invoice)
  }), [invoices, statusFilter, today])
  const recordList = useRecordList(filteredInvoices, row => [row.invoice_number, customerName(row.customers?.[0]), row.issue_date, row.due_date, invoiceStatus(row)].join(' '))
  const openInvoices = invoices.filter(invoice => Number(invoice.balance_due) > 0 && !['draft', 'void'].includes(invoice.status))
  const overdueInvoices = invoices.filter(invoiceIsOverdue)
  const paidInvoices = invoices.filter(invoice => invoice.status === 'paid' || Number(invoice.balance_due) <= 0 && invoice.status !== 'void')
  function chooseFilter(filter: InvoiceFilter) { setStatusFilter(filter); recordList.setPage(0) }

  if (selectedInvoiceId) return <InvoiceDetail initialEdit={editCreatedInvoice} business={business} invoiceId={selectedInvoiceId} onBack={() => { setSelectedInvoiceId(null);setEditCreatedInvoice(false);history.replaceState(history.state,'',customerRecordsHref('invoices', customerScope));void refresh().catch(e=>setError(e.message)) }} />

  return <div className="page-stack workspace-module invoice-module"><WorkspaceBack />
    <div className="page-heading split-heading module-page-heading"><div><p className="eyebrow">Invoices</p><h1>Know what’s owed and get paid faster.</h1><p className="module-page-intro">Find a customer invoice, review its status, or start a new draft.</p></div><div className="related-page-actions"><a className="secondary-button" href="/?view=payments">Payment History</a>{canManageFinances(business.role) && <button type="button" className="primary-button" disabled={!defaultsReady} onClick={() => { resetForm(); if(customers.some(c=>c.id===customerScope))setCustomerId(customerScope); setShowForm(true) }}><span aria-hidden="true">＋</span> Create invoice</button>}</div></div>
    <CustomerRecordScope customerId={customerScope} customers={customers} view="invoices"/>
    <section className="module-summary-grid" aria-label="Invoice summary">
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'open'} onClick={() => chooseFilter('open')}><span>Total Outstanding</span><strong>{invoiceMoney.format(openInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0))}</strong><small>{openInvoices.length} unpaid {openInvoices.length === 1 ? 'invoice' : 'invoices'} · includes overdue</small></button>
      <button type="button" className="module-summary-card module-summary-card-overdue" aria-pressed={statusFilter === 'overdue'} onClick={() => chooseFilter('overdue')}><span>Overdue</span><strong>{invoiceMoney.format(overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0))}</strong><small>{overdueInvoices.length} past-due {overdueInvoices.length === 1 ? 'invoice' : 'invoices'}</small></button>
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'paid'} onClick={() => chooseFilter('paid')}><span>Paid invoices</span><strong>{invoiceMoney.format(paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid || invoice.total || 0), 0))}</strong><small>{paidInvoices.length} {paidInvoices.length === 1 ? 'invoice' : 'invoices'} collected</small></button>
    </section>
    <nav className="module-status-filters" aria-label="Filter invoices">
      {([['all','All',invoices.length],['draft','Draft',invoices.filter(row=>row.status==='draft').length],['sent','Sent',invoices.filter(row=>['sent','viewed','partial'].includes(row.status)&&!invoiceIsOverdue(row)).length]] as const).map(([value,label,count])=><button key={value} type="button" aria-pressed={statusFilter===value} onClick={()=>chooseFilter(value)}>{label}<span>{count}</span></button>)}
    </nav>
    <RecordListControls label="invoices" list={recordList} showPagination={false} />
    {error && !showForm && <p role="alert" className="form-message error-text">{error}</p>}
    <section className="module-record-list" aria-label="Invoices">
      {invoices.length === 0 ? <div className="empty-state"><div className="empty-icon">I</div><h2>No invoices yet</h2><p>Select Create invoice to prepare your first invoice.</p></div> : recordList.visible.map((invoice) => {
        const customer = invoice.customers?.[0]
        const currentStatus = invoiceStatus(invoice)
        return <article className="document-row invoice-list-row module-record-card" key={invoice.id}>
          <div className="module-record-main"><button type="button" className="module-record-open" aria-label={`Open invoice ${invoice.invoice_number || ''} for ${customerName(customer)}`} onClick={() => {history.replaceState(history.state,'',customerRecordsHref('invoices', customerScope, invoice.id));setSelectedInvoiceId(invoice.id)}}><strong>{invoice.invoice_number || 'Draft invoice'}</strong></button><span>{customerName(customer)} · Issued {new Date(invoice.issue_date + 'T00:00:00').toLocaleDateString()}{invoice.due_date ? ` · Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : ''}</span><CreatedStamp value={invoice.created_at} timezone={business.timezone}/></div>
          <div className="module-record-total"><span>Balance due</span><strong>{invoiceMoney.format(Number(invoice.balance_due))}</strong><small>of {invoiceMoney.format(Number(invoice.total))}</small></div>
          <div className="module-record-actions"><span className={`module-record-status ${invoiceIsOverdue(invoice) ? 'is-overdue' : currentStatus.toLowerCase().includes('paid') ? 'is-positive' : ''}`}>{currentStatus}</span><button type="button" className="primary-button compact" onClick={() => {history.replaceState(history.state,'',customerRecordsHref('invoices', customerScope, invoice.id));setSelectedInvoiceId(invoice.id)}}>Open invoice</button></div>
        </article>
      })}
      {invoices.length > 0 && recordList.total === 0 && !recordList.search && <div className="module-empty-filter"><strong>No {statusFilter === 'all' ? '' : `${statusFilter} `}invoices in this view.</strong><span>Choose another status or view all invoices.</span></div>}
    </section>
    <RecordListPagination label="invoices" list={recordList} className="invoice-bottom-pagination" />
    {showForm && <FormDialog label="Create an invoice" autoFocusFields={false} busy={busy} onClose={() => { setShowForm(false); resetForm() }} wide>
      <div className="modal-head" hidden={creationPreview}><div><p className="eyebrow">New invoice</p><h2>{sourceJob ? `Invoice for ${sourceJob.title}` : 'Create an invoice'}</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }} aria-label="Close" type="button">×</button></div>
      {handoff&&<p className="form-message">Dictated request: {handoff}. Review each charge as a separate line.</p>}
      <form onInvalidCapture={e=>{let el:HTMLElement|null=e.target as HTMLElement;while(el){if(el instanceof HTMLDetailsElement)el.open=true;el=el.parentElement}}} onSubmit={reviewCreation} className="estimate-form" hidden={creationPreview}>
        <details className="composer-section"><summary>{customerId || customerDraft.name || customerDraft.company ? 'Customer · '+(creationCustomer?.first_name || creationCustomer?.company || 'Selected') : '＋ Add Customer'}</summary><div className="form-grid"><CustomerEntry customers={customers} value={customerId} draft={customerDraft} onChange={setCustomerId} onDraft={setCustomerDraft} disabled={busy||!!sourceJob}/>{customerId&&<button type="button" className="text-button" onClick={()=>setEditCreationCustomer(true)}>Edit customer contact</button>}</div></details><div className="form-grid"><label>Issue date<input type="date" required max={DateTime.now().setZone(business.timezone || 'UTC').toISODate()!} value={issueDate} onChange={e => {setIssueDate(e.target.value);if(!dateEdited.current)setDueDate(documentEndDate(e.target.value,'invoice'))}} /></label><label>Due date<input type="date" required min={issueDate} value={dueDate} onChange={(e) => {dateEdited.current=true;setDueDate(e.target.value)}} /></label><label>Internal notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        {sourceJob&&<p className="quiet">Customer and scope carried over from the job. Review the work, price and tax before saving the invoice draft.</p>}
        <details className="composer-section"><summary>＋ Add Work Details</summary><DocumentLineEditor lines={lines} onChange={setLines} newLine={newLine}/></details>
        {isPrimaryOwner(business) && pricingAdjustment>0 && <label className="settings-checkbox"><input type="checkbox" checked={adjustPrices} onChange={e=>setAdjustPrices(e.target.checked)}/>Include payment costs in line prices (+{pricingAdjustment}%) for all payment methods</label>}
        <div className="estimate-total"><span>Preview total</span><strong>{previewTotal === null ? 'Check line amounts' : '$' + previewTotal.toFixed(2)}</strong><small>Final totals are calculated by Finviant Office when saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>Preview</button></div>
      </form>

      {editCreationCustomer&&customerId&&<CustomerEditDialog businessId={business.id} customerId={customerId} onClose={()=>setEditCreationCustomer(false)} onSaved={()=>{void refresh().catch(e=>setError(e.message))}}/>}
      {creationPreview&&<CreationPreview busy={busy} error={error} saved={!!savedCreation.current} paper={{business,kind:'invoice',customer:creationCustomer,issued:issueDate,ending:dueDate,items:pricedLines,...previewAmounts(pricedLines),message:'',paymentLinks:documentPayments.payment_links,paymentInstructions:documentPayments.payment_instructions}} onBack={()=>{if(savedCreation.current)void finishCreation(savedCreation.current,true).catch(e=>setError(e.message));else setCreationPreview(false)}} onSave={()=>void submit(false)} onEmail={()=>void submit(true)}/>}
    </FormDialog>}
  </div>
}
