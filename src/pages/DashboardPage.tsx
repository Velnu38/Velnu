import { useEffect, useMemo, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { completeReminder, getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'
import { listVelnuWorkbook, type WorkbookLine } from '../services/bookkeeping'
import { readableError } from '../lib/errors'

type DashboardDestination = 'estimates' | 'invoices' | 'schedule' | 'jobs' | 'bookkeeping'
const financeRoles = ['owner', 'admin', 'office']
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function recentMonths() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1)
    return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('en-US', { month: 'short' }), year: date.getFullYear() }
  })
}

function FinancialPerformance({ business, onOpenWorkbook }: { business: CurrentBusiness; onOpenWorkbook?: () => void }) {
  const canSee = financeRoles.includes(business.role)
  const [rows, setRows] = useState<WorkbookLine[]>([])
  const [loading, setLoading] = useState(canSee)
  const [error, setError] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const months = useMemo(recentMonths, [])

  useEffect(() => {
    if (!canSee) return
    let active = true
    setLoading(true)
    setError('')
    void listVelnuWorkbook(business.id).then((data) => {
      if (active) setRows(data)
    }).catch((err) => {
      if (active) setError(readableError(err, 'Unable to load financial postings'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [business.id, business.role, canSee])

  const monthly = useMemo(() => {
    const totals = new Map<string, { income: number; expenses: number; rows: WorkbookLine[] }>()
    for (const month of months) totals.set(month.key, { income: 0, expenses: 0, rows: [] })
    for (const row of rows) {
      if (row.currency !== 'USD') continue
      const key = row.entry_date.slice(0, 7)
      const month = totals.get(key)
      if (!month) continue
      month.rows.push(row)
      if (row.direction === 'income') month.income += row.amount
      else month.expenses += row.amount
    }
    return totals
  }, [months, rows])
  const maxAmount = Math.max(1, ...Array.from(monthly.values(), (month) => Math.max(month.income, month.expenses)))
  const selected = monthly.get(selectedMonth) ?? { income: 0, expenses: 0, rows: [] }
  const selectedLabel = months.find((month) => month.key === selectedMonth)
  const monthName = selectedLabel ? new Date(Number(selectedLabel.key.slice(0, 4)), Number(selectedLabel.key.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : selectedMonth

  return <section className="financial-performance" aria-labelledby="financial-performance-title">
    <div className="financial-head">
      <div><p className="eyebrow">Financial overview</p><h2 id="financial-performance-title">Financial performance</h2><p>Compare income received with expenses recorded. Select a month to review each posting.</p></div>
      <div className="financial-actions"><span className="financial-period">Last 12 months</span>{canSee && onOpenWorkbook && <button type="button" className="secondary-button compact" onClick={onOpenWorkbook}>Open financial workbook</button>}</div>
    </div>
    {!canSee ? <p className="quiet financial-message">Financial performance is available to owners, administrators, and office staff. Ask your business owner to update your access role.</p> : <>
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      <div className="financial-chart" role="group" aria-label="Monthly income and recorded expenses. Select a month for posting details.">
        <div className="financial-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span></div>
        <div className="financial-months">
          {months.map((month) => {
            const totals = monthly.get(month.key) ?? { income: 0, expenses: 0, rows: [] }
            const isSelected = selectedMonth === month.key
            return <button type="button" key={month.key} className={`financial-month${isSelected ? ' selected' : ''}`} aria-pressed={isSelected} aria-label={`${month.label} ${month.year}: income ${usd.format(totals.income)}, expenses ${usd.format(totals.expenses)}`} onClick={() => setSelectedMonth(month.key)}>
              <span className="financial-bars"><i className="income-bar" style={{ height: `${Math.max(4, totals.income / maxAmount * 100)}%` }} /><i className="expense-bar" style={{ height: `${Math.max(4, totals.expenses / maxAmount * 100)}%` }} /></span>
              <span className="financial-month-label">{month.label}<small>{String(month.year).slice(2)}</small></span>
            </button>
          })}
        </div>
        {loading && <p className="financial-status" role="status">Loading financial postings…</p>}
        {!loading && rows.length === 0 && !error && <p className="financial-status">No financial postings yet. Payments and recorded expenses will appear here.</p>}
      </div>
      <div className="financial-detail">
        <div className="financial-summary">
          <div><span>{monthName} · Income</span><strong>{loading ? '—' : usd.format(selected.income)}</strong></div>
          <div><span>{monthName} · Expenses</span><strong>{loading ? '—' : usd.format(selected.expenses)}</strong></div>
          <div><span>Net recorded</span><strong>{loading ? '—' : usd.format(selected.income - selected.expenses)}</strong></div>
        </div>
        <div className="financial-postings">
          <div className="financial-postings-head"><h3>{monthName} postings</h3><span>{loading ? 'Loading' : `${selected.rows.length} ${selected.rows.length === 1 ? 'posting' : 'postings'}`}</span></div>
          {!loading && selected.rows.length === 0 ? <p className="quiet">No postings recorded for this month.</p> : <div className="financial-posting-list">{selected.rows.map((row) => <article className="financial-posting" key={`${row.source}-${row.id}`}>
            <span className={`posting-kind ${row.direction}`}>{row.direction === 'income' ? 'Income' : 'Expense'}</span>
            <div className="posting-description"><strong>{row.description || row.category}</strong><span>{new Date(`${row.entry_date}T00:00:00`).toLocaleDateString()} · {row.category} · {row.source_label}</span></div>
            <strong className={`posting-amount ${row.direction}`}>{row.direction === 'expense' ? '−' : '+'}{usd.format(row.amount)}</strong>
          </article>)}</div>}
        </div>
        <p className="financial-footnote">Invoice income appears when payment is recorded. QuickBooks records remain separate from Finviant Office totals.</p>
      </div>
    </>}
  </section>
}

const empty: DashboardSnapshot = {
  openInvoices: 0,
  outstandingBalance: 0,
  jobsThisWeek: 0,
  overdueInvoiceCount: 0,
  pendingApprovalCount: 0,
  overdueInvoices: [],
  dueReminders: [],
  todayAppointments: [],
  pendingApprovals: [],
}

function personName(customer?: { first_name: string | null; last_name: string | null; company: string | null }) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function DashboardPage({ business, onSetup, onNavigate }: { business: CurrentBusiness; onSetup?: () => void; onNavigate?: (view: DashboardDestination) => void }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // A route change or newer refresh invalidates an older response. This also
  // avoids setState on an unmounted workspace after a slow network request.
  const currentRequest = useRef(0)
  const mounted = useRef(false)
  // Share concurrent first loads (including React Strict Mode's effect replay)
  // without caching financial data across users, sessions, or businesses.
  const pendingLoad = useRef<{ businessId: string; promise: Promise<DashboardSnapshot> } | null>(null)

  async function refresh(force = false) {
    if (!mounted.current) return
    const request = ++currentRequest.current
    setLoading(true)
    setError('')

    let load = !force && pendingLoad.current?.businessId === business.id
      ? pendingLoad.current.promise
      : null
    if (!load) {
      load = getDashboardSnapshot(business.id)
      pendingLoad.current = { businessId: business.id, promise: load }
      const currentLoad = load
      const clearPending = () => {
        if (pendingLoad.current?.promise === currentLoad) pendingLoad.current = null
      }
      // Both resolve and reject paths clear the slot without leaking an
      // unhandled rejection from a detached finally() promise.
      void currentLoad.then(clearPending, clearPending)
    }
    try {
      const next = await load
      if (mounted.current && request === currentRequest.current) setSnapshot(next)
    } catch (err) {
      if (mounted.current && request === currentRequest.current) setError(readableError(err, 'Unable to load dashboard'))
    } finally {
      if (mounted.current && request === currentRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    setSnapshot(empty)
    void refresh()
    return () => { mounted.current = false; currentRequest.current++ }
  }, [business.id])

  async function finishReminder(reminderId: string) {
    try {
      await completeReminder(reminderId)
      if (mounted.current) await refresh(true)
    } catch (err) {
      if (mounted.current) setError(readableError(err, 'Unable to complete reminder'))
    }
  }

  const attentionCount = snapshot.overdueInvoiceCount + snapshot.dueReminders.length + snapshot.pendingApprovalCount

  return <div className="page-stack">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Finviant Office · Today</p><h1>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need your attention.` : 'Your office is caught up.'}</h1></div>
      <button className="secondary-button compact" onClick={() => void refresh(true)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    <section className="dashboard-shortcuts" aria-label="Work areas">
      <article className="dashboard-shortcut estimate-shortcut" aria-label="Estimates overview">
        <button type="button" className="estimate-shortcut-link" aria-label="Estimates" onClick={() => onNavigate?.('estimates')}>
          <span className="shortcut-icon">E</span>
          <span className="estimate-shortcut-copy"><span className="estimate-shortcut-title"><strong>Estimates</strong>{!loading && !error && snapshot.pendingApprovalCount > 0 && <span className="estimate-approval-badge">{snapshot.pendingApprovalCount} awaiting approval</span>}</span><small>Prepare quotes and track customer approvals</small></span>
          <span className="shortcut-arrow" aria-hidden="true">↗</span>
        </button>
        {loading ? <p className="estimate-tile-status" role="status">Checking customer approvals…</p> : error ? <p className="estimate-tile-status">Customer approvals unavailable. Select Refresh to try again.</p> : snapshot.pendingApprovalCount === 0 ? <p className="estimate-tile-status">No sent estimates or change orders are waiting for a decision.</p> : <div className="estimate-tile-approvals" role="region" aria-label="Customer approvals">
          <ul className="estimate-approval-list">{snapshot.pendingApprovals.map((item) => <li className="estimate-approval-row" key={`${item.document_type}-${item.id}`}>
            <div className="row-main"><strong>{item.number || item.title} · {personName(item.customers?.[0])}</strong><span>{item.document_type === 'estimate' ? 'Estimate' : `Change order · ${item.title}`} · sent {new Date(item.issue_date + 'T00:00:00').toLocaleDateString()}</span></div>
            <strong className="approval-money">{usd.format(Number(item.total))}</strong>
          </li>)}</ul>
          {snapshot.pendingApprovalCount > snapshot.pendingApprovals.length && <p className="estimate-tile-limit">Showing {snapshot.pendingApprovals.length} pending approvals. Open Estimates to review requests, or open a sent document for its change orders.</p>}
        </div>}
      </article>
      <article className="dashboard-shortcut invoice-shortcut" aria-label="Invoices overview">
        <button type="button" className="invoice-shortcut-link" aria-label="Invoices" onClick={() => onNavigate?.('invoices')}>
          <span className="shortcut-icon">I</span>
          <span className="invoice-shortcut-copy"><span className="invoice-shortcut-title"><strong>Invoices</strong>{!loading && !error && snapshot.overdueInvoiceCount > 0 && <span className="invoice-overdue-badge">{snapshot.overdueInvoiceCount} overdue</span>}</span><small>Bill customers and track payments</small></span>
          <span className="shortcut-arrow" aria-hidden="true">↗</span>
        </button>
        {loading ? <p className="invoice-tile-status" role="status">Checking overdue invoices…</p> : error ? <p className="invoice-tile-status">Overdue invoices unavailable. Select Refresh to try again.</p> : snapshot.overdueInvoiceCount === 0 ? <p className="invoice-tile-status">No overdue balances need attention.</p> : <div className="invoice-tile-overdue" role="region" aria-label="Overdue invoices">
          <ul className="invoice-overdue-list">{snapshot.overdueInvoices.map((invoice) => <li className="invoice-overdue-row" key={invoice.id}>
            <div className="row-main"><strong>{invoice.invoice_number || 'Invoice'} · {personName(invoice.customers?.[0])}</strong><span>{invoice.due_date ? `Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : 'Past due'}</span></div>
            <strong className="overdue-money">{usd.format(Number(invoice.balance_due))}</strong>
          </li>)}</ul>
          {snapshot.overdueInvoiceCount > snapshot.overdueInvoices.length && <p className="invoice-tile-limit">Showing the {snapshot.overdueInvoices.length} oldest. Open Invoices to see all.</p>}
        </div>}
      </article>
      <button type="button" className="dashboard-shortcut" aria-label="Jobs" onClick={() => onNavigate?.('jobs')}><span className="shortcut-icon">J</span><span><strong>Jobs</strong><small>{loading ? 'Loading jobs…' : error ? 'Manage your jobs' : `${snapshot.jobsThisWeek} in the next 7 days`}</small></span><span className="shortcut-arrow" aria-hidden="true">↗</span></button>
      <button type="button" className="dashboard-shortcut" aria-label="Schedule" onClick={() => onNavigate?.('schedule')}><span className="shortcut-icon">S</span><span><strong>Schedule</strong><small>{loading ? 'Loading schedule…' : error ? 'Open your calendar' : `${snapshot.todayAppointments.length} scheduled today`}</small></span><span className="shortcut-arrow" aria-hidden="true">↗</span></button>
    </section>

    {error && <p role="alert" className="form-message error-text">{error}</p>}

    <FinancialPerformance key={`${business.id}:${business.role}`} business={business} onOpenWorkbook={onNavigate ? () => onNavigate('bookkeeping') : undefined} />

    <section>
      <article className="office-panel">
        <div className="office-panel-head"><div><p className="eyebrow">Follow-up</p><h2>Reminders due</h2></div><span className="count-badge">{snapshot.dueReminders.length}</span></div>
        {snapshot.dueReminders.length === 0 ? <p className="quiet">You’re caught up on reminders.</p> : <div className="office-list">{snapshot.dueReminders.map((reminder) => <div className="office-list-row" key={reminder.id}><div className="reminder-check">!</div><div className="row-main"><strong>{reminder.note || reminder.kind.replaceAll('_', ' ')}</strong><span>Due {new Date(reminder.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>{canWrite(business.role) && <button className="secondary-button small-button" onClick={() => finishReminder(reminder.id)}>Done</button>}</div>)}</div>}
      </article>
    </section>

    <section className="attention-card">
      <div><p className="eyebrow">AI-assisted office manager</p><h2>Tell Finviant Office what needs to get done.</h2><p>Create customers, jobs, estimates, change orders, invoices, payments and schedule changes by voice. Anything involving money, scope or schedule is shown for confirmation first.</p></div>
      <div className="command-examples"><span>“Who hasn’t paid me?”</span><span>“Schedule Williams Tuesday at 10.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>
    </section>
  </div>
}
