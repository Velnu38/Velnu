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

function FinancialPerformance({ business }: { business: CurrentBusiness }) {
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
      <span className="financial-period">Last 12 months</span>
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

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const attentionCount = snapshot.overdueInvoices.length + snapshot.dueReminders.length + snapshot.pendingApprovals.length

  return <div className="page-stack">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Finviant Office · Today</p><h1>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need your attention.` : 'Your office is caught up.'}</h1></div>
      <button className="secondary-button compact" onClick={() => void refresh(true)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    <section className="dashboard-shortcuts" aria-label="Work areas">
      <button className="dashboard-shortcut" onClick={() => onNavigate?.('estimates')}><span className="shortcut-icon">E</span><span><strong>Estimates</strong><small>Prepare and track quotes</small></span><span className="shortcut-arrow">↗</span></button>
      <button className="dashboard-shortcut" onClick={() => onNavigate?.('invoices')}><span className="shortcut-icon">I</span><span><strong>Invoices</strong><small>Bill customers and track payments</small></span><span className="shortcut-arrow">↗</span></button>
      <div className="dashboard-shortcut combined-shortcut"><span className="shortcut-icon">S</span><span><strong>Schedule & jobs</strong><small>Plan work and keep jobs moving</small></span><span className="shortcut-actions"><button onClick={() => onNavigate?.('schedule')}>Schedule</button><button onClick={() => onNavigate?.('jobs')}>Jobs</button></span></div>
    </section>

    {error && <p role="alert" className="form-message error-text">{error}</p>}

    <FinancialPerformance key={`${business.id}:${business.role}`} business={business} />

    <section className="office-day-grid">
      <article className="office-panel">
        <div className="office-panel-head"><div><p className="eyebrow">Today’s work</p><h2>Schedule</h2></div><span className="count-badge">{snapshot.todayAppointments.length}</span></div>
        {snapshot.todayAppointments.length === 0 ? <p className="quiet">Nothing is scheduled for today.</p> : <div className="office-list">{snapshot.todayAppointments.map((appointment) => <div className="office-list-row" key={appointment.id}><div className="time-box"><strong>{new Date(appointment.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>{appointment.ends_at && <span>{new Date(appointment.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div><div className="row-main"><strong>{appointment.title}</strong><span>{personName(appointment.customers?.[0])} · {appointment.status.replaceAll('_', ' ')}</span></div></div>)}</div>}
      </article>

      <article className="office-panel overdue-panel">
        <div className="office-panel-head"><div><p className="eyebrow">Get paid</p><h2>Overdue invoices</h2></div><span className="count-badge">{snapshot.overdueInvoices.length}</span></div>
        {snapshot.overdueInvoices.length === 0 ? <p className="quiet">No overdue balances need attention.</p> : <div className="office-list">{snapshot.overdueInvoices.map((invoice) => <div className="office-list-row" key={invoice.id}><div className="row-main"><strong>{invoice.invoice_number || 'Invoice'} · {personName(invoice.customers?.[0])}</strong><span>{invoice.due_date ? `Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : 'Past due'}</span></div><strong className="overdue-money">${Number(invoice.balance_due).toFixed(2)}</strong></div>)}</div>}
      </article>
    </section>

    <section className="office-day-grid">
      <article className="office-panel">
        <div className="office-panel-head"><div><p className="eyebrow">Waiting on customer</p><h2>Approvals</h2></div><span className="count-badge">{snapshot.pendingApprovals.length}</span></div>
        {snapshot.pendingApprovals.length === 0 ? <p className="quiet">No sent estimates or change orders are waiting for a decision.</p> : <div className="office-list">{snapshot.pendingApprovals.map((item) => <div className="office-list-row" key={`${item.document_type}-${item.id}`}><div className="approval-type-mini">{item.document_type === 'estimate' ? 'E' : 'CO'}</div><div className="row-main"><strong>{item.number || item.title} · {personName(item.customers?.[0])}</strong><span>{item.document_type === 'estimate' ? 'Estimate' : item.title} · sent {new Date(item.issue_date + 'T00:00:00').toLocaleDateString()}</span></div><strong className="money">${Number(item.total).toFixed(2)}</strong></div>)}</div>}
      </article>

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
