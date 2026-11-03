import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import type { DashboardSnapshot } from '../services/dashboard'
import './dashboard-work.css'
import { getAttentionPage, type AttentionPage } from '../services/dashboardAttention'
import WorkflowNextSteps from './scheduling/WorkflowNextSteps'
import AttentionReminders from './AttentionReminders'

type Destination = 'estimates' | 'invoices' | 'work'
type Filter = 'attention' | 'approvals' | 'recent'
type Row = { key: string; kind: string; number: string; customer: string; detail: string; amount: number; amountLabel: string; status: string; tone: string; href: string }
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const names: Record<string,string> = { draft:'Draft', sent:'Sent', viewed:'Viewed', accepted:'Approved', converted:'Invoiced', declined:'Declined', expired:'Expired', partial:'Partly paid', paid:'Paid', overdue:'Overdue', void:'Void', lead:'Not started', scheduled:'Scheduled', in_progress:'In progress' }
function customerName(customer?: { first_name: string | null; last_name: string | null; company: string | null }) {
  return customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer' : 'Customer'
}
const documentHref = (view: string, id: string) => `/?view=${view}&document=${encodeURIComponent(id)}`
const dateLabel = (value: string | null) => value && DateTime.fromISO(value).isValid ? DateTime.fromISO(value).toFormat('MMM d, yyyy') : ''

export default function BillingHub({ business, snapshot, loading, error, onNavigate, refreshVersion = 0 }: {
  business: CurrentBusiness; snapshot: DashboardSnapshot; loading: boolean; error: string; refreshVersion?: number; onNavigate?: (view: Destination) => void
}) {
  const [filter, setFilter] = useState<Filter>('attention')
  const canSee = canManageFinances(business.role)
  const [pageNumber,setPageNumber]=useState(1)
  const [attentionPage,setAttentionPage]=useState<AttentionPage|null>(null)
  const [pageLoading,setPageLoading]=useState(true)
  const [pageError,setPageError]=useState('')
  const [retry,setRetry]=useState(0)
  const pageFilter=filter==='approvals'?'approvals':'attention'
  useEffect(()=>{
    if(!canSee)return
    let active=true,request=0
    const refresh=(background=false)=>{
      if(document.hidden)return
      const current=++request
      if(!background)setPageLoading(true)
      void getAttentionPage(business.id,pageNumber,pageFilter).then(value=>{
        if(active&&request===current){setAttentionPage(value);setPageError('');setPageLoading(false);if(value.page!==pageNumber)setPageNumber(value.page)}
      }).catch(()=>{if(active&&request===current){setPageError('Needs Attention is unavailable. Try again.');setPageLoading(false)}})
    }
    refresh()
    const update=()=>refresh(true)
    const timer=window.setInterval(update,30000)
    window.addEventListener('finviant-work-changed',update);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update)
    return()=>{active=false;request++;clearInterval(timer);window.removeEventListener('finviant-work-changed',update);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)}
  },[business.id,canSee,pageNumber,pageFilter,refreshVersion,retry])
  function changeFilter(value:Filter){if((value==='approvals')!==(filter==='approvals')){setAttentionPage(null);setPageError('')}setPageNumber(1);setFilter(value)}
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
  const approvals: Row[] = pendingApprovals.map(row => ({ key:`${row.document_type}:${row.id}`, kind:row.document_type === 'estimate' ? 'Estimate' : 'Change order', number:row.number || 'Awaiting approval',
    customer:customerName(row.customers?.[0]), detail:row.document_type === 'change_order' ? row.title : `Sent ${dateLabel(row.issue_date)}`,
    amount:Number(row.total), amountLabel:'Quoted total', status:'Awaiting approval', tone:'approval', href:row.document_type === 'estimate' ? documentHref('estimates',row.id)
      : row.estimate_id ? documentHref('estimates',row.estimate_id) : '/?view=change_orders' }))
  const recent: Row[] = snapshot.recentDocuments.map(row => ({ key:`${row.kind}:${row.id}`, kind:row.kind === 'invoice' ? 'Invoice' : 'Estimate', number:row.number || 'Draft',
    customer:customerName(row.customers?.[0]), detail:row.title || `Created ${dateLabel(row.created_at)}`,
    amount:row.total, amountLabel:'Document total', status:names[row.status] || 'Review', tone:row.status === 'paid' || row.status === 'accepted' ? 'positive' : 'neutral',
    href:documentHref(row.kind === 'invoice' ? 'invoices' : 'estimates',row.id) }))
  const rows=filter==='recent'?recent:[...overdue,...approvals]
  const heading=filter==='recent'?'Recent documents':filter==='approvals'?'Customer approvals':'Needs Attention'
  const empty=filter==='recent'?'No estimates or invoices yet. Open either list to create your first document.':filter==='approvals'?'No estimates or change orders are waiting for approval.':'No items need attention.'
  const total=attentionPage?.total??0
  const currentPage=attentionPage?.page??1
  const pageCount=Math.max(1,Math.ceil(total/5))
  return <article className="billing-hub dashboard-tile" aria-label="Estimates and invoices overview">
    <div className="work-card-heading"><div><p className="eyebrow">Customer billing</p><h2 className="dashboard-tile-title">Estimates &amp; invoices</h2></div><div className="billing-navigation"><button type="button" className="secondary-button compact" onClick={() => onNavigate?.('estimates')}>Estimates <span aria-hidden="true">↗</span></button><button type="button" className="secondary-button compact" onClick={() => onNavigate?.('invoices')}>Invoices <span aria-hidden="true">↗</span></button></div></div>
    {!canSee ? <p className="work-card-empty">Billing details are available to owners, administrators, and office staff.</p> : <>
      <div className="billing-summary">
        <div className="billing-outstanding"><span>Outstanding</span><strong>{loading || error ? '—' : usd.format(snapshot.outstandingBalance)}</strong><small>{loading ? 'Loading balance…' : error ? 'Balance unavailable' : `${snapshot.openInvoices} open ${snapshot.openInvoices === 1 ? 'invoice' : 'invoices'}`}</small></div>
        <button type="button" className={`billing-metric overdue${!loading && !error && !countsUnavailable && attentionCount>0?' has-attention':''}`} disabled={loading || !!error} aria-pressed={filter === 'attention'} onClick={() => changeFilter('attention')}><span>Needs Attention</span><strong>{loading || error || countsUnavailable ? '—' : attentionCount}</strong><small>Review next steps <span aria-hidden="true">→</span></small></button>

        <button type="button" className={`billing-metric approval${!loading && !error && !countsUnavailable && approvalCount>0?' has-attention':''}`} disabled={loading || !!error} aria-pressed={filter === 'approvals'} onClick={() => changeFilter('approvals')}><span>Awaiting approval</span><strong>{loading || error || countsUnavailable ? '—' : approvalCount}</strong><small>Estimates &amp; changes <span aria-hidden="true">→</span></small></button>
      </div>
      <div className="billing-filter-bar"><div className="billing-filters" role="group" aria-label="Billing view"><button type="button" aria-pressed={filter !== 'recent'} onClick={() => changeFilter('attention')}>Needs Attention</button><button type="button" aria-pressed={filter === 'recent'} onClick={() => changeFilter('recent')}>Recent</button></div>{filter === 'approvals' ? <span className="billing-filter-label">{heading}</span> : null}</div>
      {loading ? <p role="status" className="work-card-empty">Loading estimates and invoices…</p> : error ? <p className="work-card-empty">Billing information is unavailable. Select Refresh above to try again.</p> : <div role="region" aria-label={heading} aria-busy={filter!=='recent'&&pageLoading}>
        {filter!=='recent' && pageError ? <p role="alert">{pageError} <button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>Retry attention</button></p> : null}
        {filter!=='recent' && pageLoading ? <p role="status" className="work-card-empty">Loading attention items…</p> : <>
        {filter==='attention'&&<><WorkflowNextSteps business={business} data={workflow} embedded/><AttentionReminders business={business} reminders={reminders}/></>}
        {rows.length === 0 && filter === 'attention' && items.length > 0 ? null : rows.length === 0 && !pageError ? <div className="billing-empty"><span className="billing-empty-icon" aria-hidden="true">{filter === 'recent' ? '↗' : '✓'}</span><p>{empty}</p>{filter === 'attention' && recent.length > 0 && <button type="button" className="text-button" onClick={() => changeFilter('recent')}>View recent documents</button>}</div> : <ul className="billing-rows">{rows.map(row => <li key={row.key}><a className="billing-row" href={row.href} aria-label={`Open ${row.kind.toLowerCase()} ${row.number} for ${row.customer}`}>
          <span className={`billing-document-icon ${row.kind === 'Invoice' ? 'invoice' : 'estimate'}`} aria-hidden="true">{row.kind === 'Invoice' ? 'I' : row.kind === 'Estimate' ? 'E' : 'C'}</span>
          <span className="billing-row-copy"><strong>{row.customer}</strong><span>{row.kind} · {row.number}</span><small>{row.detail}</small></span>
          <span className={`billing-status ${row.tone}`}>{row.status}</span>
          <span className="billing-row-amount"><strong>{usd.format(row.amount)}</strong><small>{row.amountLabel}</small></span>{filter==='recent'?<span className="billing-row-arrow" aria-hidden="true">↗</span>:<span className="attention-action billing-attention-action">{row.kind==='Invoice'?'Review invoice':'Review approval'}</span>}
        </a></li>)}</ul>}
        {filter==='recent' && rows.length>0 && <p className="billing-list-note">Latest {rows.length} documents. Open Estimates or Invoices to see all records.</p>}
        </>}
        {filter!=='recent'&&attentionPage&&<nav className="attention-pagination" aria-label="Attention pages">
          <p aria-live="polite">{total?`Showing ${(currentPage-1)*5+1}–${Math.min(currentPage*5,total)} of ${total}`:'0 items'}<small>Page {currentPage} of {pageCount}</small></p>
          <div><button type="button" className="secondary-button compact" disabled={pageLoading||!!pageError||currentPage<=1} onClick={()=>setPageNumber(currentPage-1)}>Previous</button><button type="button" className="secondary-button compact" disabled={pageLoading||!!pageError||currentPage>=pageCount} onClick={()=>setPageNumber(currentPage+1)}>Next</button></div>
        </nav>}

      </div>}
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
