import { useState } from 'react'
import { DateTime } from 'luxon'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import type { DashboardSnapshot } from '../services/dashboard'
import './dashboard-work.css'

type Destination = 'estimates' | 'invoices' | 'work'
type Filter = 'attention' | 'overdue' | 'approvals' | 'recent'
type Row = { key: string; kind: string; number: string; customer: string; detail: string; amount: number; amountLabel: string; status: string; tone: string; href: string }
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const names: Record<string,string> = { draft:'Draft', sent:'Sent', viewed:'Viewed', accepted:'Approved', converted:'Invoiced', declined:'Declined', expired:'Expired', partial:'Partly paid', paid:'Paid', overdue:'Overdue', void:'Void', lead:'Not started', scheduled:'Scheduled', in_progress:'In progress' }
function customerName(customer?: { first_name: string | null; last_name: string | null; company: string | null }) {
  return customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer' : 'Customer'
}
const documentHref = (view: string, id: string) => `/?view=${view}&document=${encodeURIComponent(id)}`
const dateLabel = (value: string | null) => value && DateTime.fromISO(value).isValid ? DateTime.fromISO(value).toFormat('MMM d, yyyy') : ''

export default function BillingHub({ business, snapshot, loading, error, onNavigate }: {
  business: CurrentBusiness; snapshot: DashboardSnapshot; loading: boolean; error: string; onNavigate?: (view: Destination) => void
}) {
  const [filter, setFilter] = useState<Filter>('recent')
  const canSee = canManageFinances(business.role)
  const overdue: Row[] = snapshot.overdueInvoices.map(row => ({ key:`invoice:${row.id}`, kind:'Invoice', number:row.invoice_number || 'Invoice',
    customer:customerName(row.customers?.[0]), detail:row.due_date ? `Due ${dateLabel(row.due_date)}` : 'Payment past due',
    amount:Number(row.balance_due), amountLabel:'Balance due', status:'Overdue', tone:'overdue', href:documentHref('invoices',row.id) }))
  const approvals: Row[] = snapshot.pendingApprovals.map(row => ({ key:`${row.document_type}:${row.id}`, kind:row.document_type === 'estimate' ? 'Estimate' : 'Change order', number:row.number || 'Awaiting approval',
    customer:customerName(row.customers?.[0]), detail:row.document_type === 'change_order' ? row.title : `Sent ${dateLabel(row.issue_date)}`,
    amount:Number(row.total), amountLabel:'Quoted total', status:'Awaiting approval', tone:'approval', href:row.document_type === 'estimate' ? documentHref('estimates',row.id)
      : row.estimate_id ? documentHref('estimates',row.estimate_id) : '/?view=change_orders' }))
  const recent: Row[] = snapshot.recentDocuments.map(row => ({ key:`${row.kind}:${row.id}`, kind:row.kind === 'invoice' ? 'Invoice' : 'Estimate', number:row.number || 'Draft',
    customer:customerName(row.customers?.[0]), detail:row.title || `Created ${dateLabel(row.created_at)}`,
    amount:row.total, amountLabel:'Document total', status:names[row.status] || 'Review', tone:row.status === 'paid' || row.status === 'accepted' ? 'positive' : 'neutral',
    href:documentHref(row.kind === 'invoice' ? 'invoices' : 'estimates',row.id) }))
  // The default preview includes both categories when present. Counters always
  // represent the full dataset; the preview never implies that five is the total.
  const attention = overdue.length && approvals.length
    ? [...overdue.slice(0,3), ...approvals.slice(0,2), ...overdue.slice(3), ...approvals.slice(2)]
    : [...overdue,...approvals]
  const rows = (filter === 'recent' ? recent : filter === 'overdue' ? overdue : filter === 'approvals' ? approvals : attention).slice(0,5)
  const total = filter === 'overdue' ? snapshot.overdueInvoiceCount : filter === 'approvals' ? snapshot.pendingApprovalCount : snapshot.overdueInvoiceCount + snapshot.pendingApprovalCount
  const heading = filter === 'recent' ? 'Recent documents' : filter === 'overdue' ? 'Overdue invoices' : filter === 'approvals' ? 'Customer approvals' : 'Needs attention'
  const empty = filter === 'recent' ? 'No estimates or invoices yet. Open either list to create your first document.' : filter === 'overdue' ? 'No overdue balances need attention.' : filter === 'approvals' ? 'No estimates or change orders are waiting for approval.' : 'No overdue invoices or pending approvals. Your billing is up to date.'
  return <article className="billing-hub" aria-label="Estimates and invoices overview">
    <div className="work-card-heading"><div><p className="eyebrow">Customer billing</p><h2>Estimates &amp; invoices</h2></div><div className="billing-navigation"><button type="button" className="secondary-button compact" onClick={() => onNavigate?.('estimates')}>Estimates <span aria-hidden="true">↗</span></button><button type="button" className="secondary-button compact" onClick={() => onNavigate?.('invoices')}>Invoices <span aria-hidden="true">↗</span></button></div></div>
    {!canSee ? <p className="work-card-empty">Billing details are available to owners, administrators, and office staff.</p> : <>
      <div className="billing-summary">
        <div className="billing-outstanding"><span>Outstanding</span><strong>{loading || error ? '—' : usd.format(snapshot.outstandingBalance)}</strong><small>{loading ? 'Loading balance…' : error ? 'Balance unavailable' : `${snapshot.openInvoices} open ${snapshot.openInvoices === 1 ? 'invoice' : 'invoices'}`}</small></div>
        <button type="button" className="billing-metric overdue" disabled={loading || !!error} aria-pressed={filter === 'overdue'} onClick={() => setFilter('overdue')}><span>Overdue</span><strong>{loading || error ? '—' : snapshot.overdueInvoiceCount}</strong><small>Review invoices <span aria-hidden="true">→</span></small></button>
        <button type="button" className="billing-metric approval" disabled={loading || !!error} aria-pressed={filter === 'approvals'} onClick={() => setFilter('approvals')}><span>Awaiting approval</span><strong>{loading || error ? '—' : snapshot.pendingApprovalCount}</strong><small>Estimates &amp; changes <span aria-hidden="true">→</span></small></button>
      </div>
      <div className="billing-filter-bar"><div className="billing-filters" role="group" aria-label="Billing view"><button type="button" aria-pressed={filter !== 'recent'} onClick={() => setFilter('attention')}>Needs attention</button><button type="button" aria-pressed={filter === 'recent'} onClick={() => setFilter('recent')}>Recent</button></div>{filter === 'overdue' || filter === 'approvals' ? <span className="billing-filter-label">{heading}</span> : null}</div>
      {loading ? <p role="status" className="work-card-empty">Loading estimates and invoices…</p> : error ? <p className="work-card-empty">Billing information is unavailable. Select Refresh above to try again.</p> : <div role="region" aria-label={heading}>
        {rows.length === 0 ? <div className="billing-empty"><span className="billing-empty-icon" aria-hidden="true">{filter === 'recent' ? '↗' : '✓'}</span><p>{empty}</p>{filter === 'attention' && recent.length > 0 && <button type="button" className="text-button" onClick={() => setFilter('recent')}>View recent documents</button>}</div> : <ul className="billing-rows">{rows.map(row => <li key={row.key}><a className="billing-row" href={row.href} aria-label={`Open ${row.kind.toLowerCase()} ${row.number} for ${row.customer}`}>
          <span className={`billing-document-icon ${row.kind === 'Invoice' ? 'invoice' : 'estimate'}`} aria-hidden="true">{row.kind === 'Invoice' ? 'I' : row.kind === 'Estimate' ? 'E' : 'C'}</span>
          <span className="billing-row-copy"><strong>{row.customer}</strong><span>{row.kind} · {row.number}</span><small>{row.detail}</small></span>
          <span className={`billing-status ${row.tone}`}>{row.status}</span>
          <span className="billing-row-amount"><strong>{usd.format(row.amount)}</strong><small>{row.amountLabel}</small></span><span className="billing-row-arrow" aria-hidden="true">↗</span>
        </a></li>)}</ul>}
        {rows.length > 0 && <p className="billing-list-note">{filter === 'recent' ? `Latest ${rows.length} ${rows.length === 1 ? 'document' : 'documents'}.` : `Showing ${rows.length} of ${total} ${filter === 'overdue' ? 'overdue invoices' : filter === 'approvals' ? 'pending approvals' : 'items needing attention'}.`} Open Estimates or Invoices to see all.</p>}
      </div>}
    </>}
  </article>
}

export function DashboardJobs({ snapshot, loading, error, onOpen }: { snapshot: DashboardSnapshot; loading: boolean; error: string; onOpen?: () => void }) {
  return <article className="dashboard-jobs" aria-label="Jobs overview">
    <div className="work-card-heading"><div><p className="eyebrow">Work in progress</p><h2>Jobs</h2></div><span className="jobs-active-count">{loading || error ? '—' : snapshot.activeJobCount}<small>active</small></span></div>
    <p className="jobs-card-description">Manage the work, photos, and expenses in one place.</p>
    {loading ? <p role="status" className="work-card-empty">Loading jobs…</p> : error ? <p className="work-card-empty">Job details are unavailable. Select Refresh to try again.</p> : snapshot.activeJobs.length ? <><p className="jobs-list-label">Recently updated</p><ul className="jobs-preview-list">{snapshot.activeJobs.map(job => <li key={job.id}><strong>{job.title}</strong><span>{customerName(job.customers?.[0])}</span><small className="billing-status neutral">{names[job.status] || 'Active'}</small></li>)}</ul>{snapshot.activeJobCount > snapshot.activeJobs.length && <p className="billing-list-note">Showing {snapshot.activeJobs.length} of {snapshot.activeJobCount} active jobs.</p>}</> : <div className="jobs-empty"><span aria-hidden="true">J</span><strong>No active jobs</strong><p>Open Jobs to create work or review completed jobs.</p></div>}
    <button type="button" className="primary-button jobs-open" onClick={onOpen}>Open jobs <span aria-hidden="true">↗</span></button>
  </article>
}
