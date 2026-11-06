import InvoiceReminderDialog from './InvoiceReminderDialog'
import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import type { DashboardSnapshot } from '../services/dashboard'
import './dashboard-work.css'
import { getAttentionPage, type AttentionFilter, type AttentionPage } from '../services/dashboardAttention'
import WorkflowNextSteps from './scheduling/WorkflowNextSteps'
import AttentionReminders from './AttentionReminders'

const categoryLabels = {
  schedule: 'Schedule work',
  invoice: 'Finish invoices',
  overdue: 'Overdue payments',
  follow_up: 'Follow-ups due',
} as const
const categories = Object.keys(categoryLabels) as (keyof typeof categoryLabels)[]
const emptyByFilter: Record<AttentionFilter, string> = {
  attention: 'No items need attention.',
  approvals: 'No estimates or change orders are waiting for approval.',
  schedule: 'No work needs scheduling.',
  invoice: 'No invoices need finishing.',
  overdue: 'No payments are overdue.',
  follow_up: 'No follow-ups are due.',
}
type Row = { key: string; kind: string; number: string; customer: string; detail: string; amount: number; amountLabel: string; status: string; tone: string; href: string }
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const names: Record<string,string> = { draft:'Draft', sent:'Sent', viewed:'Viewed', accepted:'Approved', converted:'Invoiced', declined:'Declined', expired:'Expired', partial:'Partly paid', paid:'Paid', overdue:'Overdue', void:'Void', lead:'Not started', scheduled:'Scheduled', in_progress:'In progress' }
function customerName(customer?: { first_name: string | null; last_name: string | null; company: string | null }) {
  return customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer' : 'Customer'
}
const documentHref = (view: string, id: string) => `/?view=${view}&document=${encodeURIComponent(id)}`
const dateLabel = (value: string | null) => value && DateTime.fromISO(value).isValid ? DateTime.fromISO(value).toFormat('MMM d, yyyy') : ''

export default function BillingHub({ business, refreshVersion = 0 }: { business: CurrentBusiness; refreshVersion?: number }) {
  const [reminderInvoice,setReminderInvoice]=useState<string|null>(null)
  const [filter, setFilter] = useState<AttentionFilter>('attention')
  const [expanded, setExpanded] = useState(false)
  const canSee = canManageFinances(business.role)
  const [pageNumber,setPageNumber]=useState(1)
  const [attentionPage,setAttentionPage]=useState<AttentionPage|null>(null)
  const [pageLoading,setPageLoading]=useState(true)
  const [pageError,setPageError]=useState('')
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    if(!canSee)return
    let active=true,request=0
    const refresh=(background=false)=>{
      if(document.hidden)return
      const current=++request
      if(!background)setPageLoading(true)
      void getAttentionPage(business.id,pageNumber,filter).then(value=>{
        if(active&&request===current){setAttentionPage(value);setPageError('');setPageLoading(false);if(value.page!==pageNumber)setPageNumber(value.page)}
      }).catch(()=>{if(active&&request===current){setPageError('Needs Attention is unavailable. Try again.');setPageLoading(false)}})
    }
    refresh()
    const update=()=>refresh(true)
    const timer=window.setInterval(update,30000)
    window.addEventListener('finviant-work-changed',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update)
    return()=>{active=false;request++;clearInterval(timer);window.removeEventListener('finviant-work-changed',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)}
  },[business.id,canSee,pageNumber,filter,refreshVersion,retry])
  function changeFilter(value: AttentionFilter) {
    if (value !== filter) {
      setPageLoading(true)
      setAttentionPage(null)
      setPageError('')
      setFilter(value)
    }
    setPageNumber(1)
  }
  const items=attentionPage?.items || []
  const overdueInvoices=items.flatMap(item=>item.kind==='invoice'?[item.data]:[])
  const pendingApprovals=items.flatMap(item=>item.kind==='estimate'||item.kind==='change_order'?[item.data]:[])
  const workflow={approved:items.flatMap(item=>item.kind==='approved'?[item.data]:[]),completed:items.flatMap(item=>item.kind==='completed'?[item.data]:[])}
  const reminders=items.flatMap(item=>item.kind==='reminder'?[item.data]:[])
  const attentionCount=attentionPage?.attention_count??0
  const approvalCount=attentionPage?.approval_count??0
  const countsUnavailable=!attentionPage||!!pageError
  const overdue: Row[] = overdueInvoices.map(row => ({ key:`invoice:${row.id}`, kind:'Invoice', number:row.invoice_number || 'Invoice',
    customer:customerName(row.customers?.[0]), detail:row.due_date ? `Due ${dateLabel(row.due_date)}` : 'Payment past due',
    amount:Number(row.balance_due), amountLabel:'Balance due', status:'Overdue', tone:'overdue', href:documentHref('invoices',row.id) }))
  const approvals: Row[] = pendingApprovals.map(row => ({ key:`${row.document_type}:${row.id}`, kind:row.document_type === 'estimate' ? 'Estimate' : 'Change order', number:row.number || 'Awaiting customer approval',
    customer:customerName(row.customers?.[0]), detail:row.document_type === 'change_order' ? row.title : `Sent ${dateLabel(row.issue_date)}`,
    amount:Number(row.total), amountLabel:'Quoted total', status:'Awaiting customer approval', tone:'approval', href:row.document_type === 'estimate' ? documentHref('estimates',row.id)
      : row.estimate_id ? documentHref('estimates',row.estimate_id) : '/?view=change_orders' }))
  const rows=filter==='approvals'?approvals:overdue
  const heading = filter === 'attention' ? 'Needs Attention' : filter === 'approvals' ? 'Awaiting Customer Approval' : categoryLabels[filter]
  const total=attentionPage?.total??0
  const currentPage=attentionPage?.page??1
  const pageCount=Math.max(1,Math.ceil(total/5))
  return <article className="billing-hub dashboard-tile home-attention-tile" aria-label="Needs attention overview">
    {reminderInvoice&&<InvoiceReminderDialog business={business} invoiceId={reminderInvoice} onClose={()=>setReminderInvoice(null)} onSent={()=>{setRetry(v=>v+1);window.dispatchEvent(new Event('finviant-work-changed'))}}/>}
    <button type="button" className="attention-summary-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
      <span><span className="eyebrow">Your next steps</span><strong className="dashboard-tile-title">Needs Attention</strong><small>{countsUnavailable?'Loading action counts…':`${attentionCount} ${attentionCount===1?'action':'actions'} need your attention`}</small></span>
      <span className="attention-summary-chevron" aria-hidden="true">{expanded?'⌃':'⌄'}</span>
    </button>
    {!canSee ? <p className="work-card-empty">Billing details are available to owners, administrators, and office staff.</p> : <>
      <div className="attention-category-pills" role="group" aria-label="Needs Attention categories">
        {categories.map(category => <button key={category} type="button"
          className={`attention-category-pill ${category.replace('_', '-')}`}
          aria-pressed={expanded && filter === category}
          aria-controls={expanded ? 'dashboard-attention-results' : undefined}
          onClick={() => { if (!expanded || filter !== category) changeFilter(category); setExpanded(true) }}>
          <span>{categoryLabels[category]}</span><strong>{countsUnavailable ? '—' : attentionPage.category_counts[category]}</strong>
        </button>)}
      </div>
      {expanded && <>
      <div className="attention-view-switch" role="group" aria-label="Home work queue">
        <button type="button" aria-pressed={filter==='attention'} onClick={()=>changeFilter('attention')}>Needs attention <span>{countsUnavailable?'—':attentionCount}</span></button>
        <button type="button" aria-pressed={filter==='approvals'} onClick={()=>changeFilter('approvals')}>Awaiting Customer Approval <span>{countsUnavailable?'—':approvalCount}</span></button>
      </div>
      <div id="dashboard-attention-results" role="region" aria-label={heading} aria-busy={pageLoading}>
        {pageError ? <p role="alert" className="work-card-empty">{pageError} <button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p> : null}
        {pageLoading && !attentionPage ? <p role="status" className="work-card-empty">Loading attention items…</p> : <>
        {(filter === 'attention' || filter === 'schedule' || filter === 'invoice') && <WorkflowNextSteps business={business} data={workflow} embedded/>}
        {(filter === 'attention' || filter === 'follow_up') && <AttentionReminders business={business} reminders={reminders}/>}
        {rows.length === 0 && items.length > 0 ? null : rows.length === 0 && !pageError ? <div className="billing-empty"><span className="billing-empty-icon" aria-hidden="true">✓</span><p>{emptyByFilter[filter]}</p></div> : <ul className="billing-rows">{rows.map(row => <li key={row.key} className={row.kind==='Invoice'?'billing-reminder-row':undefined}><a className="billing-row" href={row.href} aria-label={`Open ${row.kind.toLowerCase()} ${row.number} for ${row.customer}`}>
          <span className={`billing-document-icon ${row.kind === 'Invoice' ? 'invoice' : 'estimate'}`} aria-hidden="true">{row.kind === 'Invoice' ? 'I' : row.kind === 'Estimate' ? 'E' : 'C'}</span>
          <span className="billing-row-copy"><strong>{row.customer}</strong><span>{row.kind} · {row.number}</span><small>{row.detail}</small></span>
          <span className={`billing-status ${row.tone}`}>{row.status}</span>
          <span className="billing-row-amount"><strong>{usd.format(row.amount)}</strong><small>{row.amountLabel}</small></span>{row.kind!=='Invoice'&&<span className="attention-action billing-attention-action">Review approval</span>}
        </a>{row.kind==='Invoice'&&<button type="button" className="primary-button compact" onClick={()=>setReminderInvoice(row.key.slice(8))}>Send Reminder</button>}</li>)}</ul>}
        </>}
        {attentionPage&&<nav className="attention-pagination" aria-label="Attention pages">
          <p aria-live="polite">{total?`Showing ${(currentPage-1)*5+1}–${Math.min(currentPage*5,total)} of ${total}`:'0 items'}<small>Page {currentPage} of {pageCount}</small></p>
          <div><button type="button" className="secondary-button compact" disabled={pageLoading||!!pageError||currentPage<=1} onClick={()=>setPageNumber(currentPage-1)}>Previous</button><button type="button" className="secondary-button compact" disabled={pageLoading||!!pageError||currentPage>=pageCount} onClick={()=>setPageNumber(currentPage+1)}>Next</button></div>
        </nav>}

      </div>
      </>}
    </>}
  </article>
}

export function DashboardJobs({ snapshot, loading, error, onOpen }: { snapshot: DashboardSnapshot; loading: boolean; error: string; onOpen?: () => void }) {
  return <article className="dashboard-jobs dashboard-tile" aria-label="Jobs overview">
    <div className="work-card-heading"><div><p className="eyebrow">Work in progress</p><h2 className="dashboard-tile-title">Jobs</h2></div></div>
    <div className="jobs-summary">
      <button type="button" className="billing-metric jobs-active-metric" onClick={onOpen}><span>Active jobs</span><strong className="jobs-active-count">{loading || error ? '—' : snapshot.activeJobCount}</strong><small>View all jobs <span aria-hidden="true">↗</span></small></button>
    </div>
    <p className="jobs-card-description">Manage the work, photos, and expenses in one place.</p>
    {loading ? <p role="status" className="work-card-empty">Loading jobs…</p> : error ? <p className="work-card-empty">Job details are unavailable. Select Refresh to try again.</p> : snapshot.activeJobs.length ? <><p className="jobs-list-label">Recently updated</p><ul className="jobs-preview-list">{snapshot.activeJobs.map(job => <li key={job.id}><strong>{job.title}</strong><span>{customerName(job.customers?.[0])}</span><small className="billing-status neutral">{names[job.status] || 'Active'}</small></li>)}</ul>{snapshot.activeJobCount > snapshot.activeJobs.length && <p className="billing-list-note">Showing {snapshot.activeJobs.length} of {snapshot.activeJobCount} active jobs.</p>}</> : <div className="jobs-empty"><span aria-hidden="true">J</span><strong>No active jobs</strong><p>Select Active jobs to review current, upcoming, and completed work.</p></div>}
  </article>
}
