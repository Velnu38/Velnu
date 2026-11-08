import UpgradeLink from '../components/UpgradeLink'
import EstimateBilling from '../components/EstimateBilling'
import {useTierUsage} from '../lib/useTierUsage'
import CreationPreview from '../components/CreationPreview'
import {documentEndDate,previewAmounts} from '../lib/documentPreview'
import {sendReviewedDocument} from '../services/reviewDelivery'
import {validateDocumentInput} from '../lib/financialValidation'
import { customerRecordsHref } from '../lib/customerRecords'
import CustomerRecordScope from '../components/CustomerRecordScope'
import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import DocumentLineEditor from '../components/DocumentLineEditor'
import DraftDocumentEditor from '../components/DraftDocumentEditor'
import CustomerEditDialog from '../components/CustomerEditDialog'
import {RecordDetailHeader,RecordTabs,RecordActionBar} from '../components/RecordDetail'
import DocumentRecord, {CreatedStamp,type DocumentDates} from '../components/DocumentRecord'
import FormDialog from '../components/FormDialog'
import DocumentChangeOrders from '../components/DocumentChangeOrders'
import WorkspaceBack from '../components/WorkspaceBack'
import { DateTime } from 'luxon'
import RecordListControls, { RecordListPagination, useRecordList } from '../components/RecordListControls'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { getDocumentSettings } from '../services/settings'
import RecordResources from '../components/RecordResources'
import { previewDocumentTotal } from '../lib/financialValidation'
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { canManageFinances, type CurrentBusiness, type BusinessProfile } from '../lib/business'
import { listCustomers } from '../services/customers'
import { convertEstimateToInvoice, createEstimate, createRevisedEstimate, getEstimateWorkflowContexts, listEstimates, listEstimateItems, prepareEstimateCopy, updateEstimateStatus, type EstimateWorkflowContext } from '../services/estimates'
import DocumentPdfPreview from '../components/DocumentPdfPreview'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { createApprovalLink } from '../services/approvals'
import DocumentDeliveryDialog,{DocumentDeliveryRecovery} from '../components/DocumentDeliveryDialog'
import { customerDocumentActionsEnabled } from '../lib/releaseFlags'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'
import { offersDocumentChangeOrders } from '../lib/documentChangeOrders'
import ScheduleEstimateDialog from '../components/scheduling/ScheduleEstimateDialog'
import DispatchJobDialog from '../components/scheduling/DispatchJobDialog'
import {getJob} from '../services/jobs'
import {hasActiveJobAppointment} from '../lib/jobActions'
import {readPendingPersonalSend} from '../services/personalDelivery'
import {createShareToken} from '../lib/personalDelivery'
import {estimateActionState} from '../lib/estimateActions'
import {confirmNavigation} from '../lib/unsavedChanges'
import { canAccess } from '../lib/workspaceAccess'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import CustomerEntry, { emptyCustomerDraft, newCustomerFields } from '../components/CustomerEntry'
import { type DocumentPayments } from '../components/PaymentOptionsFields'
import { validPaymentLink } from '../lib/paymentLinks'

const ChangeOrdersPage = lazy(() => import('./ChangeOrdersPage'))

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Estimate = DocumentDates & { properties?:ServiceAddress|ServiceAddress[]|null; issuer_snapshot?: Partial<BusinessProfile> | null; id: string; customer_id: string; job_id?: string | null; estimate_number: string | null; status: string; issue_date: string; expires_on: string | null; subtotal: number; tax_amount: number; total: number; customer_message?: string | null; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type PreviewItem = { id: string; description: string; quantity: number; unit_price: number; tax_rate: number; line_total: number }
type ApprovalLinkState = { url: string; title: string; expiresAt: string | null; documentId: string }
type EstimateFilter = 'all' | 'pipeline' | 'draft' | 'sent' | 'approved' | 'declined'

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })
const estimateMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function EstimatesPage({ business }: { business: CurrentBusiness }) {
  const [activeTab,setActiveTab]=useState('details')
  const [resourcesOpened,setResourcesOpened]=useState(false)
  const [deliveryMode,setDeliveryMode]=useState<'send'|'copy'|null>(null)
  const [pendingPersonal,setPendingPersonal]=useState(false)
  const [deliveryNeedsReview,setDeliveryNeedsReview]=useState(false)
  const [workflows,setWorkflows]=useState<Record<string,EstimateWorkflowContext>>({})
  const [workflowError,setWorkflowError]=useState('')
  const [dispatchJob,setDispatchJob]=useState<Awaited<ReturnType<typeof getJob>>|null>(null)
  const revisionRequests=useRef(new Map<string,string>()),copyTokens=useRef(new Map<string,string>())
  const readRequest=useRef(0),previewRequest=useRef(0)
  const customerScope = new URLSearchParams(window.location.search).get('customer') || ''
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [statusFilter, setStatusFilter] = useState<EstimateFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null)
  const [scheduleTarget,setScheduleTarget]=useState<Estimate|null>(null)
  const plan=useTierUsage(business.id)?.plan
  const [previewTarget, setPreviewTarget] = useState<Estimate | null>(null)
  const [showEdit,setShowEdit]=useState(false),[editCustomer,setEditCustomer]=useState(false)
  const [showChangeOrders, setShowChangeOrders] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [convertDueDate, setConvertDueDate] = useState('')
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerDraft,setCustomerDraft]=useState(emptyCustomerDraft)
  const customerRequest=useRef<{signature:string;id:string}|null>(null)
  const saving=useRef(false)
  const [creationPreview,setCreationPreview]=useState(false)
  const savedCreation=useRef<string|null>(null)
  const [savedCustomerId,setSavedCustomerId]=useState('')
  const [editCreationCustomer,setEditCreationCustomer]=useState<'email'|'phone'|'all'|null>(null)
  const dateEdited=useRef(false)
  const [defaultPayments,setDefaultPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [documentPayments,setDocumentPayments]=useState<DocumentPayments>({payment_links:[],payment_instructions:''})
  const [propertyId,setPropertyId]=useState('')
  const [serviceAddress,setServiceAddress]=useState('')
  const [expiresOn, setExpiresOn] = useState(() => documentEndDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!, 'estimate'))
  const [issueDate, setIssueDate] = useState(() => DateTime.now().setZone(business.timezone || 'UTC').toISODate()!)
  const [notes, setNotes] = useState('')
  const [customerTerms, setCustomerTerms] = useState('')
  const [defaultTax, setDefaultTax] = useState(0)
  const [documentTax, setDocumentTax] = useState('0')
  const [defaultsReady,setDefaultsReady] = useState(false)
  useEffect(() => { let active=true; void getDocumentSettings(business.id).then(d=>{if(active){setDefaultTax(Number(d.default_tax_rate));setDocumentTax(String(d.default_tax_rate));setDefaultPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDocumentPayments({payment_links:d.payment_links,payment_instructions:d.payment_instructions});setDefaultsReady(true)}}).catch(()=>{if(active)setError('Unable to load document defaults. Reload before creating a document.')}); return()=>{active=false} },[business.id])
  const quickCreate=useRef(new URLSearchParams(window.location.search).get('new')==='1')
  useEffect(()=>{if(defaultsReady&&quickCreate.current&&canManageFinances(business.role)){quickCreate.current=false;resetForm();setCustomerId(customerScope);setShowForm(true);const url=new URL(location.href);url.searchParams.delete('new');history.replaceState(history.state,'',url.pathname+url.search)}},[defaultsReady,business.role])
  const newLine = (): Line => ({...blankLine(),tax_rate:String(defaultTax)})
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    const current=++readRequest.current
    const loaded = await Promise.all([listEstimates(business.id, customerScope), listCustomers(business.id)]).catch(err=>{if(current!==readRequest.current)return null;throw err})
    if(!loaded)return [] as Estimate[]
    const [estimateRows, customerRows] = loaded
    if(current!==readRequest.current)return estimateRows as Estimate[]
    setEstimates(estimateRows as Estimate[])
    setPreviewTarget(previous=>previous?(estimateRows as Estimate[]).find(row=>row.id===previous.id)||previous:null)
    setCustomers(customerRows as Customer[])
    try{const context=await getEstimateWorkflowContexts(business.id,estimateRows.map(row=>row.id));if(current===readRequest.current){setWorkflows(Object.fromEntries(context.map(row=>[row.estimate_id,row])));setWorkflowError('')}}catch(err){if(current===readRequest.current)setWorkflowError(readableError(err,'Work details could not refresh. Check the existing job before scheduling.'))}
    return estimateRows as Estimate[]
  }

  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useBusinessRefresh(business.id,()=>refresh().then(()=>{}))
  useEffect(() => {setEstimates([]);setPreviewTarget(null);setWorkflows({});void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load estimates'));return()=>{readRequest.current++;previewRequest.current++} }, [business.id,customerScope])
  useEffect(()=>{let active=true;setPendingPersonal(false);const check=()=>{if(previewTarget&&['draft','sent'].includes(previewTarget.status))void readPendingPersonalSend(business.id,'estimate',previewTarget.id).then(value=>{if(active)setPendingPersonal(!!value)})};check();window.addEventListener('focus',check);window.addEventListener('finviant:delivery-state',check);return()=>{active=false;window.removeEventListener('focus',check);window.removeEventListener('finviant:delivery-state',check)}},[business.id,previewTarget?.id,previewTarget?.status,deliveryMode])

  const linkedDocumentOpened = useRef(false)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('document')
    const target = estimates.find(row => row.id === id)
    if (target && !showForm && !linkedDocumentOpened.current) {
      linkedDocumentOpened.current = true
      const createInvoice = new URLSearchParams(location.search).get('action') === 'invoice'
      void openPreview(target).then(opened => {
        if (opened && createInvoice && canManageFinances(business.role)) {
          if (target.status === 'accepted') setConvertTarget(target)
          else setNotice('Review this estimate’s approval status before creating the final invoice.')
        }
      })
    }
  }, [estimates])

  const previewTotal = useMemo(() => previewDocumentTotal(lines), [lines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }


  const previewAddress = Array.isArray(previewTarget?.properties)?previewTarget.properties[0]:previewTarget?.properties
  const creationContactId=customerId||savedCustomerId
  const creationCustomer=customers.find(c=>c.id===creationContactId)||{first_name:customerDraft.name,last_name:null,company:customerDraft.company,email:customerDraft.email,phone:customerDraft.phone}
  async function finishCreation(id:string,edit=false){const rows=await refresh();const saved=rows.find(row=>row.id===id);if(!saved)throw new Error('The estimate was saved. Reload the list to open it; do not create it again.');if(!await openPreview(saved))throw new Error('The estimate is saved, but its preview could not load. Retry opening this same record.');setShowEdit(edit);resetForm();setShowForm(false)}
  function reviewCreation(event:React.FormEvent){
    event.preventDefault();setError('')
    try{
      if(!customerId)newCustomerFields(customerDraft)
      validateDocumentInput({customer_id:customerId||'new',issue_date:issueDate,expires_on:expiresOn,items:lines.map(l=>({description:l.description,quantity:Number(l.quantity),unit_price:Number(l.unit_price),tax_rate:Number(l.tax_rate)}))})
      if(documentPayments.payment_links.some(link=>!validPaymentLink(link)))throw new Error('Enter a valid HTTPS payment link.')
      if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft') {
        void submit()
      } else setCreationPreview(true)
    }catch(e){setError(e instanceof Error?e.message:'Check the document details.')}
  }

  function resetForm() {
    setCreationPreview(false); savedCreation.current=null;setSavedCustomerId(''); dateEdited.current=false; setDocumentTax(String(defaultTax))
    setIssueDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!); setCustomerId('');setCustomerDraft(emptyCustomerDraft());customerRequest.current=null;setDocumentPayments(defaultPayments); setPropertyId('');setServiceAddress(''); setExpiresOn(documentEndDate(DateTime.now().setZone(business.timezone || 'UTC').toISODate()!, 'estimate')); setNotes(''); setCustomerTerms(''); setLines([newLine()]); setError(''); setNotice(''); retryRef.current = null
  }

  async function submit(sendEmail=false, stayOnPreview=false, expectedRevisionId?:string) {
     if(saving.current)return;saving.current=true;setBusy(true); setError(''); setNotice('')
    try {
      if(savedCreation.current){
        if(stayOnPreview)return savedCreation.current
        if(sendEmail)await sendReviewedDocument(business.id, 'estimate',savedCreation.current,creationCustomer?.email||'',undefined,expectedRevisionId);
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
      const signature = JSON.stringify({ issueDate, customer, payments, propertyId, expiresOn, notes, customerTerms, lines })
      if (retryRef.current?.signature !== signature) retryRef.current = { signature, requestId: crypto.randomUUID() }
      const created = await createEstimate(business.id, { request_id: retryRef.current.requestId,
        ...customer,...payments,
        property_id: propertyId || undefined,
        issue_date: issueDate,
        expires_on: expiresOn || undefined,
        notes,
        customer_message: customerTerms,
        items: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      })
      savedCreation.current=created.id
      if(stayOnPreview){
        setSavedCustomerId(customer.customer_id)
        history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope,created.id))
        return created.id
      }
      if(sendEmail)await sendReviewedDocument(business.id, 'estimate',created.id,creationCustomer?.email||'',undefined,expectedRevisionId)
      await finishCreation(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create estimate')
    } finally { saving.current=false;setBusy(false) }
  }

  async function changeStatus(id: string, status: 'sent' | 'accepted' | 'declined' | 'expired') {
    const confirmations: Record<typeof status, string> = {
      sent: 'Mark this estimate as delivered outside Finviant Office? This does not email the customer.',
      accepted: 'Record that the customer accepted this estimate outside Finviant Office? Confirm you have their actual approval.',
      declined: 'Record that the customer declined this estimate outside Finviant Office?',
      expired: 'Mark this estimate as expired?',
    }
    if (!window.confirm(confirmations[status])) return
    setBusy(true); setError(''); setNotice('')
    try {
      await updateEstimateStatus(id, status)
      await refresh()
      setNotice(status === 'accepted' ? 'Customer acceptance recorded. Choose the crew and appointment times next.' : 'Estimate marked ' + status + '.')
      if(status==='accepted'&&canAccess(business,'calendar')&&canAccess(business,'jobs'))setScheduleTarget(estimates.find(row=>row.id===id) || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update estimate')
    } finally { setBusy(false) }
  }

  async function shareForApproval(estimate: Estimate) {
    if (!customerDocumentActionsEnabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const link = await createApprovalLink(business.id, 'estimate', estimate.id)
      setApprovalLink({ url: link.url, title: `${estimate.estimate_number || 'Estimate'} approval link`, expiresAt: link.expires_at, documentId: estimate.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create approval link')
    } finally { setBusy(false) }
  }

  async function convert(event: FormEvent) {
    event.preventDefault()
    if (!convertTarget || saving.current) return
    saving.current=true
    setBusy(true); setError(''); setNotice('')
    try {
      const invoiceId = await convertEstimateToInvoice(convertTarget.id, convertDueDate || undefined)
      setConvertTarget(null); setConvertDueDate('')
      window.history.pushState({finviantIndex:(Number(history.state?.finviantIndex)||0)+1},'', '/?view=invoices&document='+encodeURIComponent(invoiceId));window.dispatchEvent(new PopStateEvent('popstate',{state:{finviantConfirmedSave:true}}))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert estimate')
    } finally { saving.current=false;setBusy(false) }
  }


  async function openPreview(target: Estimate) {
    const current=++previewRequest.current
    setPreviewBusy(true); setError('')
    try {
      const items = await listEstimateItems(business.id, target.id)
      if(current!==previewRequest.current)return false
      setPreviewItems(items as PreviewItem[])
      if(previewTarget?.id!==target.id){setActiveTab('details');setResourcesOpened(false);setDeliveryMode(null);setDeliveryNeedsReview(false)}
      setPreviewTarget(target)
      history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope,target.id));return true
    } catch (err) {
      if(current===previewRequest.current)setError(err instanceof Error ? err.message : 'Unable to load the estimate preview.');return false
    } finally { if(current===previewRequest.current)setPreviewBusy(false) }
  }

  const canManage=canManageFinances(business.role)&&canAccess(business,'billing')
  const canSchedule=canManage&&canAccess(business,'calendar')&&canAccess(business,'jobs')
  const permissions={canManage,canSchedule,canOpenJob:canAccess(business,'jobs'),canOpenInvoice:canAccess(business,'billing')}
  const actionState=(estimate:Estimate)=>estimateActionState(estimate,{...workflows[estimate.id],timezone:business.timezone},permissions)
  const previewState=previewTarget?actionState(previewTarget):null
  const previewWorkflow=previewTarget?workflows[previewTarget.id]:undefined
  async function revise(estimate:Estimate){
    if(saving.current||!actionState(estimate).canRevise)return
    if(!confirmNavigation())return
    if(!window.confirm('Create a new draft from this estimate? Its issued PDF, customer decision and history will stay unchanged.'))return
    saving.current=true;setBusy(true);setError('')
    try{let request=revisionRequests.current.get(estimate.id);if(!request){request=crypto.randomUUID();revisionRequests.current.set(estimate.id,request)}const result=await createRevisedEstimate(estimate.id,request);const rows=await refresh();const draft=rows.find(row=>row.id===result.estimate_id);if(!draft)throw new Error('The revised draft is saved. Retry this same action to reopen it; do not create another estimate.');if(await openPreview(draft)){setShowEdit(draft.status==='draft');setNotice(draft.status==='draft'?'Revised draft created. Review the dates, scope and customer terms before sending.':'The revised estimate already exists. Its current status and history are shown here.')}}catch(err){setError(readableError(err,'Unable to confirm the revised draft. Retry this same action.'))}finally{saving.current=false;setBusy(false)}
  }
  async function schedule(estimate:Estimate){
    const state=actionState(estimate)
    if(!canSchedule||!workflows[estimate.id])return
    if(state.work.jobId){const current=++previewRequest.current;setPreviewBusy(true);setError('');try{const job=await getJob(business.id,state.work.jobId);if(current===previewRequest.current)setDispatchJob(job)}catch(err){if(current===previewRequest.current)setError(readableError(err,'Unable to load the existing job.'))}finally{if(current===previewRequest.current)setPreviewBusy(false)}}else setScheduleTarget(estimate)
  }
  async function runPrimary(estimate:Estimate){
    const primary=actionState(estimate).primary
    if(!primary)return
    if(primary.key==='send'||primary.key==='follow_up'){if(await openPreview(estimate))setDeliveryMode(estimate.status==='sent'&&actionState(estimate).deadlineExpired&&!pendingPersonal&&!deliveryNeedsReview?'copy':'send')}
    else if(primary.key==='revise')await revise(estimate)
    else if(primary.key==='schedule_job')await schedule(estimate)
  }
  function primaryControl(estimate:Estimate,compact=false){
    const primary=actionState(estimate).primary
    if(!primary)return null
    const className='primary-button'+(compact?' compact':'')
    if(primary.key==='open_job')return <a className={className} href={'/?view=work&document='+encodeURIComponent(primary.jobId!)}>{primary.label}</a>
    if(primary.key==='open_invoice')return <a className={className} href={'/?view=invoices&document='+encodeURIComponent(primary.invoiceId!)}>{primary.label}</a>
    if(primary.key==='open_schedule')return <a className={className} href="/?view=dashboard">View schedule</a>
    const waitingWork=primary.key==='schedule_job'&&!workflows[estimate.id]
    return <button type="button" className={className} disabled={busy||previewBusy||waitingWork} onClick={()=>void runPrimary(estimate)}>{previewTarget?.id===estimate.id&&['send','follow_up'].includes(primary.key)?pendingPersonal?'Confirm sent':deliveryNeedsReview?'Review delivery':primary.label:primary.label}</button>
  }
  async function prepareCopy(revisionId?:string){
    if(!previewTarget)throw new Error('Open this estimate before preparing its copy.')
    const key=previewTarget.id+':'+(revisionId||previewTarget.updated_at||'')
    let token=copyTokens.current.get(key);if(!token){token=createShareToken();copyTokens.current.set(key,token)}
    return prepareEstimateCopy(business.id,previewTarget.id,token)
  }
  function closePreview(){previewRequest.current++;setPreviewTarget(null);setDeliveryMode(null);history.replaceState(history.state,'',customerRecordsHref('estimates',customerScope))}
  function selectTab(tab:string){setActiveTab(tab);if(tab==='resources')setResourcesOpened(true)}
  function openChangeOrder(id:string){if(confirmNavigation())setShowChangeOrders(id)}
  function estimateStatus(estimate: Estimate) {
    return actionState(estimate).displayStatus
  }
  const filteredEstimates = useMemo(() => estimates.filter(estimate => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'pipeline') return ['draft', 'sent'].includes(estimate.status)
    if (statusFilter === 'draft') return estimate.status === 'draft'
    if (statusFilter === 'sent') return estimate.status==='sent'
    if (statusFilter === 'approved') return ['accepted', 'converted'].includes(estimate.status)
    return ['declined', 'expired'].includes(estimate.status)
  }), [estimates, statusFilter])
  const recordList = useRecordList(filteredEstimates, row => [row.estimate_number, customerName(row.customers?.[0]), row.issue_date, row.expires_on, estimateStatus(row)].join(' '))
  const awaitingApproval = estimates.filter(estimate => estimate.status==='sent')
  const approvedEstimates = estimates.filter(estimate => ['accepted', 'converted'].includes(estimate.status))
  const pipelineEstimates = estimates.filter(estimate => ['draft', 'sent'].includes(estimate.status))
  function chooseFilter(filter: EstimateFilter) { setStatusFilter(filter); recordList.setPage(0) }
  const emptyFilterMessage = {
    all: 'No estimates in this view.',
    pipeline: 'No draft or sent estimates in this view.',
    draft: 'No draft estimates in this view.',
    sent: 'No estimates are awaiting customer approval.',
    approved: 'No approved estimates in this view.',
    declined: 'No declined or expired estimates in this view.',
  }[statusFilter]

  const changeContext = previewTarget && { documentId: previewTarget.id, documentNumber: previewTarget.estimate_number || 'Estimate', customerId: previewTarget.customer_id, jobId: previewTarget.job_id, estimateId: previewTarget.id, documentType: 'estimate' as const }
  if (showChangeOrders && previewTarget && changeContext) return <Suspense fallback={<p role="status">Loading change orders…</p>}><ChangeOrdersPage business={business} context={changeContext} initialOrder={showChangeOrders} onBack={()=>{setShowChangeOrders(null);void refresh().catch(err=>setError(readableError(err,'Unable to refresh the estimate.')))}} /></Suspense>

  return <div className="page-stack workspace-module estimates-module"><WorkspaceBack />
    <div className="page-heading split-heading module-page-heading"><div><p className="eyebrow">Estimates</p><h1>Quote the work without the paperwork.</h1><p className="module-page-intro">Track approvals, send a quote, or turn approved work into a job.</p></div>{canManageFinances(business.role) && <button type="button" className="primary-button" disabled={!defaultsReady} onClick={() => { resetForm(); if(customers.some(c=>c.id===customerScope))setCustomerId(customerScope); setShowForm(true) }}><span aria-hidden="true">＋</span> Create estimate</button>}</div>
    {notice && !previewTarget && <p className="form-message success-text">{notice}</p>}
    {error && !previewTarget && !showForm && !convertTarget && <p className="form-message error-text">{error}</p>}
    <CustomerRecordScope customerId={customerScope} customers={customers} view="estimates"/>
    <section className="module-summary-grid" aria-label="Estimate summary">
      <button type="button" className="module-summary-card module-summary-card-approval" aria-pressed={statusFilter === 'sent'} onClick={() => chooseFilter('sent')}><span>Awaiting Customer Approval</span><strong>{awaitingApproval.length}</strong><small>{awaitingApproval.length === 1 ? 'estimate' : 'estimates'} sent to customers</small></button>
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'approved'} onClick={() => chooseFilter('approved')}><span>Approved</span><strong>{approvedEstimates.length}</strong><small>{approvedEstimates.length === 1 ? 'estimate' : 'estimates'} accepted or invoiced</small></button>
      <button type="button" className="module-summary-card" aria-pressed={statusFilter === 'pipeline'} onClick={() => chooseFilter('pipeline')}><span>Pending Estimate Value</span><strong>{estimateMoney.format(pipelineEstimates.reduce((sum, estimate) => sum + Number(estimate.total || 0), 0))}</strong><small>{pipelineEstimates.length} draft and sent {pipelineEstimates.length === 1 ? 'estimate' : 'estimates'}</small></button>
    </section>
    <nav className="module-status-filters" aria-label="Filter estimates">
      {([['all','All',estimates.length],['draft','Draft',estimates.filter(row=>row.status==='draft').length],['declined','Declined / Expired',estimates.filter(row=>['declined','expired'].includes(row.status)).length]] as const).map(([value,label,count])=><button key={value} type="button" aria-pressed={statusFilter===value} onClick={()=>chooseFilter(value)}>{label}<span>{count}</span></button>)}
    </nav>
    <RecordListControls label="estimates" list={recordList} showPagination={false} />
    <section className="module-record-list" aria-label="Estimates" hidden={!!previewTarget}>
      {estimates.length === 0 ? <div className="empty-state"><div className="empty-icon">E</div><h2>No estimates yet</h2><p>Select Create estimate to prepare your first estimate.</p></div> : recordList.visible.map((estimate) => {
        const customer = estimate.customers?.[0]
        const currentStatus = estimateStatus(estimate)
        return <article className="document-row module-record-card estimate-module-record" key={estimate.id}>
          <div className="module-record-main"><button type="button" className="module-record-open" disabled={previewBusy} onClick={() => openPreview(estimate)} aria-label={`Open estimate ${estimate.estimate_number || ''} for ${customerName(customer)}`}><strong>{estimate.estimate_number || 'Draft estimate'}</strong></button><span>{customerName(customer)} · Issued {new Date(estimate.issue_date + 'T00:00:00').toLocaleDateString()}{estimate.expires_on ? ` · Expires ${new Date(estimate.expires_on + 'T00:00:00').toLocaleDateString()}` : ''}</span><CreatedStamp value={estimate.created_at} timezone={business.timezone}/></div>
          <div className="module-record-total"><span>Estimate total</span><strong>{estimateMoney.format(Number(estimate.total))}</strong><small>{estimate.status === 'converted' ? 'Invoice created' : 'Customer quote'}</small></div>
          <div className="module-record-actions"><span className={`module-record-status ${['accepted','converted'].includes(estimate.status) ? 'is-positive' : estimate.status==='sent' ? 'is-pending' : ''}`}>{currentStatus}</span>{primaryControl(estimate,true)}</div>
        </article>
      })}
      {estimates.length > 0 && recordList.total === 0 && !recordList.search && <div className="module-empty-filter"><strong>{emptyFilterMessage}</strong><span>Choose another status or view all estimates.</span></div>}
    </section>
    {!previewTarget && <RecordListPagination label="estimates" list={recordList} className="estimate-bottom-pagination" />}
    {scheduleTarget&&<ScheduleEstimateDialog business={business} estimateId={scheduleTarget.id} onClose={()=>setScheduleTarget(null)} onSaved={()=>void refresh()}/>}
    {dispatchJob&&<DispatchJobDialog business={business} job={dispatchJob} needsAppointmentRepair={!hasActiveJobAppointment(dispatchJob)} onClose={()=>setDispatchJob(null)} onSaved={()=>void refresh()}/>}
    {showForm && <FormDialog label="Create an estimate" autoFocusFields={false} busy={busy} cleanVersion={savedCreation.current} onClose={() => { if(savedCreation.current)void finishCreation(savedCreation.current);else {setShowForm(false);resetForm()} }} wide>
      <div className="modal-head" hidden={creationPreview}><div><p className="eyebrow">New estimate</p><h2>Create an estimate</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }} aria-label="Close" type="button">×</button></div>
      <form onInvalidCapture={e=>{let el:HTMLElement|null=e.target as HTMLElement;while(el){if(el instanceof HTMLDetailsElement)el.open=true;el=el.parentElement}}} onSubmit={reviewCreation} className="estimate-form" hidden={creationPreview}>
        <div className="form-grid"><CustomerEntry customers={customers} value={customerId} draft={customerDraft} onChange={id=>{setCustomerId(id);setPropertyId('')}} onDraft={setCustomerDraft} disabled={busy}/>{customerId&&<button type="button" className="text-button" onClick={()=>setEditCreationCustomer('all')}>Edit customer contact</button>}</div><div className="form-grid"><label>Issue date<input type="date" required max={DateTime.now().setZone(business.timezone || 'UTC').toISODate()!} value={issueDate} onChange={e => {setIssueDate(e.target.value);if(!dateEdited.current)setExpiresOn(documentEndDate(e.target.value,'estimate'))}} /></label><label>Valid until<input type="date" required min={issueDate} value={expiresOn} onChange={(e) => {dateEdited.current=true;setExpiresOn(e.target.value)}} /></label><label>Internal notes (not shown to customer)<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="full"><CustomerPropertySelect selectSingle businessId={business.id} customerId={customerId} value={propertyId} onChange={(id,address)=>{setPropertyId(id);setServiceAddress(address)}} disabled={busy}/></div>
        <label className="full">Customer-facing estimate terms (optional)<textarea rows={3} maxLength={4000} value={customerTerms} onChange={e => setCustomerTerms(e.target.value)} placeholder="For example: Estimate valid for 30 days. A deposit is due before work begins." /></label></div>
        <DocumentLineEditor businessId={business.id} lines={lines} onChange={setLines} newLine={newLine} taxOptions taxDefault={{ rate: documentTax, onChange: setDocumentTax }}/>
        <div className="estimate-total"><span>Preview total</span><strong>{previewTotal === null ? 'Check line amounts' : '$' + previewTotal.toFixed(2)}</strong><small>Final totals are calculated when the estimate is saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>Preview</button><button type="submit" value="draft" className="secondary-button" disabled={busy}>Save Draft</button></div>
      </form>

      {editCreationCustomer&&creationContactId&&<CustomerEditDialog businessId={business.id} customerId={creationContactId} contactField={editCreationCustomer==='all'?undefined:editCreationCustomer} onClose={()=>setEditCreationCustomer(null)} onSaved={()=>{void refresh().catch(e=>setError(e.message))}}/>}
      {creationPreview&&<CreationPreview onEditContact={creationContactId?setEditCreationCustomer:undefined} onDraftContact={(field,value)=>setCustomerDraft(current=>({...current,[field]:value}))} canUpgrade={isPrimaryOwner(business)} busy={busy} error={error} saved={!!savedCreation.current} paper={{business,kind:'estimate',customer:creationCustomer,serviceAddress,issued:issueDate,ending:expiresOn,items:lines,...previewAmounts(lines),message:customerTerms,paymentLinks:documentPayments.payment_links,paymentInstructions:documentPayments.payment_instructions}} onBack={()=>{if(savedCreation.current)void finishCreation(savedCreation.current,true).catch(e=>setError(e.message));else setCreationPreview(false)}} onSave={()=>void submit(false)} saveForDelivery={()=>submit(false,true)} onEmail={revisionId=>void submit(true,false,revisionId)}/>}
    </FormDialog>}
    {convertTarget && <FormDialog label="Create the invoice" busy={busy} onClose={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>
      <div className="modal-head"><div><p className="eyebrow">Accepted estimate</p><h2>Create the invoice</h2></div><button className="icon-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }} aria-label="Close" type="button">×</button></div>
      <div className="conversion-summary"><span>{convertTarget.estimate_number || 'Estimate'}</span><strong>${Number(convertTarget.total).toFixed(2)}</strong><p>{customerName(convertTarget.customers?.[0])}</p></div>
      <form onSubmit={convert} className="conversion-form"><label>Invoice due date<input type="date" value={convertDueDate} onChange={(e) => setConvertDueDate(e.target.value)} /></label><p className="quiet">The final draft includes the approved estimate, approved change orders, and credit for the paid deposit. Settle or void any outstanding deposit invoice first. Review the draft before sending it.</p>{error && <p className="form-message error-text">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Save draft invoice'}</button></div></form>
    </FormDialog>}


    {previewTarget && <FormDialog label="Estimate preview" wide busy={busy} onClose={closePreview}><section className="estimate-preview-modal">
        <RecordDetailHeader eyebrow="Estimate" title={previewTarget.estimate_number||'Saved estimate'} status={<span className="status-chip">{previewState?.displayStatus}</span>} subtitle={<>{customerName(previewTarget.customers?.[0])} · {estimateMoney.format(Number(previewTarget.total))}</>}><button className="icon-button" onClick={closePreview} disabled={busy} aria-label="Close preview" type="button">×</button></RecordDetailHeader>
        {showEdit&&<DraftDocumentEditor businessId={business.id} kind="estimate" id={previewTarget.id} onClose={()=>setShowEdit(false)} onSaved={()=>{void refresh().then(rows=>{const next=rows.find(r=>r.id===previewTarget.id);if(next)void openPreview(next)})}}/>}
        {editCustomer&&<CustomerEditDialog businessId={business.id} customerId={previewTarget.customer_id} onClose={()=>setEditCustomer(false)} onSaved={()=>{void refresh().then(rows=>{const next=rows.find(r=>r.id===previewTarget.id);if(next)setPreviewTarget(next)})}}/>}
        <RecordActionBar primary={primaryControl(previewTarget)} secondary={canManage&&previewTarget.status==='draft'?<button type="button" className="secondary-button" disabled={busy} onClick={()=>setShowEdit(true)}>Edit draft</button>:undefined} disabled={busy} more={<>
          {canManage&&<button type="button" disabled={busy} onClick={()=>setEditCustomer(true)}>Edit customer contact</button>}
          {canManage&&<button type="button" disabled={busy} onClick={()=>setDeliveryMode(['draft','sent'].includes(previewTarget.status)?'send':'copy')}>{['draft','sent'].includes(previewTarget.status)?'Sending options':'Share estimate copy'}</button>}
          {canManage&&previewTarget.status==='sent'&&<button type="button" disabled={busy||pendingPersonal||deliveryNeedsReview} onClick={()=>void changeStatus(previewTarget.id,'accepted')}>Record acceptance</button>}
          {canManage&&previewTarget.status==='sent'&&plan==='pro'&&customerDocumentActionsEnabled&&!previewState?.deadlineExpired&&<button type="button" disabled={busy} onClick={()=>void shareForApproval(previewTarget)}>Customer approval link</button>}
          {canManage&&previewTarget.status==='draft'&&!pendingPersonal&&!deliveryNeedsReview&&<button type="button" disabled={busy} onClick={()=>void changeStatus(previewTarget.id,'sent')}>Mark sent manually</button>}
          {canManage&&previewTarget.status==='sent'&&<><button type="button" disabled={busy||pendingPersonal||deliveryNeedsReview} onClick={()=>void changeStatus(previewTarget.id,'declined')}>Record decline</button><button type="button" disabled={busy||pendingPersonal||deliveryNeedsReview} onClick={()=>void changeStatus(previewTarget.id,'expired')}>Expire estimate</button></>}
          {canManage&&previewState?.canRevise&&previewTarget.status!=='expired'&&<button type="button" disabled={busy||pendingPersonal||deliveryNeedsReview} onClick={()=>void revise(previewTarget)}>Create revised draft</button>}
          {canManage&&previewTarget.status==='accepted'&&!previewWorkflow?.final_invoice_id&&<button type="button" disabled={busy||!previewWorkflow} onClick={()=>{if(!confirmNavigation())return;setError('');setNotice('');setConvertTarget(previewTarget)}}>Create final invoice now</button>}
          {canManage&&previewWorkflow&&offersDocumentChangeOrders('estimate',previewTarget.status,previewWorkflow.job?.status)&&<button type="button" disabled={busy} onClick={()=>openChangeOrder('new')}>Create change order</button>}
          {previewTarget.job_id&&canAccess(business,'jobs')&&<a href={'/?view=work&document='+encodeURIComponent(previewTarget.job_id)}>Open linked job</a>}
          {previewWorkflow?.final_invoice_id&&canAccess(business,'billing')&&previewTarget.status!=='converted'&&<a href={'/?view=invoices&document='+encodeURIComponent(previewWorkflow.final_invoice_id)}>Open final invoice</a>}
          <button type="button" onClick={()=>selectTab('resources')}>Photos &amp; expenses</button>
          <button type="button" onClick={()=>selectTab('activity')}>View activity</button>
        </>}/>
        {notice&&<p role="status" className="form-message success-text">{notice}</p>}
        {error&&<p role="alert" className="form-message error-text">{error}</p>}
        {canManage&&['draft','sent'].includes(previewTarget.status)&&<DocumentDeliveryRecovery businessId={business.id} kind="estimate" documentId={previewTarget.id} refreshKey={previewTarget.updated_at||''} onRecoveryChange={setDeliveryNeedsReview} onOpen={()=>setDeliveryMode('send')}/>}
        <RecordTabs label="Estimate sections" tabs={[{id:previewTarget.id+'-details',label:'Details'},{id:previewTarget.id+'-resources',label:'Photos & expenses'},{id:previewTarget.id+'-activity',label:'Activity'}]} active={previewTarget.id+'-'+activeTab} onChange={id=>selectTab(id.slice(previewTarget.id.length+1))}/>
        <div role="tabpanel" id={previewTarget.id+'-details-panel'} aria-labelledby={previewTarget.id+'-details-tab'} hidden={activeTab!=='details'}>
          <DocumentPdfPreview compact source={{businessId:business.id,kind:'estimate',documentId:previewTarget.id}} refreshKey={previewTarget.updated_at||''} title="Estimate PDF"/>
          {previewState?.deadlineExpired&&previewTarget.status==='sent'&&<p role="status" className="quiet">The response deadline has passed. This issued copy remains available; create a revised draft for a new customer approval.</p>}
          {previewTarget.status==='declined'&&<p className="quiet">The customer declined this estimate. Its issued PDF and history are retained.</p>}
          <section className="detail-card" aria-label="Estimate work"><h3>Work &amp; appointment</h3>{!previewWorkflow?<p role="status">{workflowError||'Checking existing work and appointments…'} {workflowError&&<button type="button" className="text-button" onClick={()=>void refresh()}>Retry work details</button>}</p>:<><p><strong>{previewState?.work.label}</strong>{previewState?.work.startsAt&&<> · {DateTime.fromISO(previewState.work.startsAt).setZone(business.timezone||'UTC').toFormat('MMM d, yyyy · h:mm a ZZZZ')}</>}</p>{previewWorkflow.invitation?.status==='approved'&&<p className="quiet">Customer booking invitation: {Date.parse(previewWorkflow.invitation.expires_at)>Date.now()?'waiting for a choice':'expired'} · until {DateTime.fromISO(previewWorkflow.invitation.expires_at).setZone(business.timezone||'UTC').toFormat('MMM d, yyyy · h:mm a ZZZZ')}.</p>}{previewWorkflow.schedule&&!previewTarget.job_id&&<p className="quiet">Existing {previewWorkflow.schedule.status} document schedule. <a href="/?view=dashboard">View work calendar</a></p>}{previewState?.work.jobId&&canAccess(business,'jobs')&&<p><a href={'/?view=work&document='+encodeURIComponent(previewState.work.jobId)}>Manage linked job</a></p>}</>}</section>
          {['accepted','converted'].includes(previewTarget.status)&&<EstimateBilling businessId={business.id} estimateId={previewTarget.id} total={Number(previewTarget.total)} approved={previewTarget.status==='accepted'} canManage={canManage} timezone={business.timezone||'America/New_York'} refreshKey={previewTarget.updated_at||''}/>}
          {canManage&&changeContext&&<DocumentChangeOrders key={'changes:'+changeContext.documentId} business={business} context={changeContext} allowNew={false} onOpen={openChangeOrder}/>}
          {plan==='free'&&<p className="quiet"><UpgradeLink plan="free" required="basic" canUpgrade={isPrimaryOwner(business)}>View Individual upgrade to remove Finviant branding</UpgradeLink></p>}
        </div>
        <div role="tabpanel" id={previewTarget.id+'-resources-panel'} aria-labelledby={previewTarget.id+'-resources-tab'} hidden={activeTab!=='resources'}>{resourcesOpened&&<><p className="quiet">Private business photos and expenses for this estimate.</p>{previewTarget.job_id&&canAccess(business,'jobs')&&<p><a href={'/?view=work&document='+encodeURIComponent(previewTarget.job_id)+'&tab=photos-expenses'}>View linked job photos &amp; expenses</a></p>}<RecordResources key={business.id+':'+previewTarget.id} business={business} target={{kind:'estimate',id:previewTarget.id}} active={activeTab==='resources'}/></>}</div>
        <div role="tabpanel" id={previewTarget.id+'-activity-panel'} aria-labelledby={previewTarget.id+'-activity-tab'} hidden={activeTab!=='activity'}><DocumentRecord dates={previewTarget} timezone={business.timezone} customerId={previewTarget.customer_id} customerName={customerName(previewTarget.customers?.[0])}/><p className="quiet">Customer decisions and issued copies retain their original document revision.</p></div>
        {canManage&&deliveryMode&&<DocumentDeliveryDialog open onClose={()=>setDeliveryMode(null)} readOnly={deliveryMode==='copy'} prepareCopy={prepareCopy} title={deliveryMode==='copy'?'Share estimate copy':previewTarget.status==='sent'?'Follow up on estimate':'Send estimate'} initialIntent={deliveryMode==='copy'?'share':'send'} onBusyChange={setBusy} businessId={business.id} kind="estimate" documentId={previewTarget.id} refreshKey={previewTarget.updated_at||''} email={previewTarget.customers?.[0]?.email} phone={previewTarget.customers?.[0]?.phone} disabled={busy} onEditContact={()=>setEditCustomer(true)} onSent={refresh}/>}
      </section>
    </FormDialog>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onReplace={async()=>{const link=await createApprovalLink(business.id,'estimate',approvalLink.documentId,{rotate:true});setApprovalLink({...approvalLink,url:link.url,expiresAt:link.expires_at})}} onClose={() => setApprovalLink(null)} />}
  </div>
}
