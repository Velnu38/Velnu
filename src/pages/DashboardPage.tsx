import BillingHub, { DashboardJobs } from '../components/BillingHub'
import DailyCalendar from '../components/calendar/DailyCalendar'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'
import { listVelnuWorkbook, type WorkbookLine } from '../services/bookkeeping'
import { readableError } from '../lib/errors'

type DashboardDestination = 'estimates' | 'invoices' | 'work' | 'schedule' | 'bookkeeping'
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
  const [showPostings, setShowPostings] = useState(false)
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
            return <button type="button" key={month.key} className={`financial-month${isSelected ? ' selected' : ''}`} aria-pressed={isSelected} aria-label={`${month.label} ${month.year}: income ${usd.format(totals.income)}, expenses ${usd.format(totals.expenses)}`} onClick={() => { setSelectedMonth(month.key); setShowPostings(true) }}>
              <span className="financial-bars"><i className="income-bar" style={{ height: `${(totals.income > 0 ? Math.max(4, totals.income / maxAmount * 100) : 0)}%`, minHeight: 0 }} /><i className="expense-bar" style={{ height: `${(totals.expenses > 0 ? Math.max(4, totals.expenses / maxAmount * 100) : 0)}%`, minHeight: 0 }} /></span>
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
        <details className="financial-postings-disclosure" open={showPostings} onToggle={event => setShowPostings(event.currentTarget.open)}><summary>{monthName} posting details{!loading ? ` (${selected.rows.length})` : ''}</summary><div className="financial-postings">
          <div className="financial-postings-head"><h3>{monthName} postings</h3><span>{loading ? 'Loading' : `${selected.rows.length} ${selected.rows.length === 1 ? 'posting' : 'postings'}`}</span></div>
          {!loading && selected.rows.length === 0 ? <p className="quiet">No postings recorded for this month.</p> : <div className="financial-posting-list">{selected.rows.map((row) => <article className="financial-posting" key={`${row.source}-${row.id}`}>
            <span className={`posting-kind ${row.direction}`}>{row.direction === 'income' ? 'Income' : 'Expense'}</span>
            <div className="posting-description"><strong>{row.description || row.category}</strong><span>{new Date(`${row.entry_date}T00:00:00`).toLocaleDateString()} · {row.category} · {row.source_label}</span></div>
            <strong className={`posting-amount ${row.direction}`}>{row.direction === 'expense' ? '−' : '+'}{usd.format(row.amount)}</strong>
          </article>)}</div>}
        </div>
        </details>
        <p className="financial-footnote">Invoice income appears when payment is recorded. QuickBooks records remain separate from Finviant Office totals.</p>
      </div>
    </>}
  </section>
}

const empty: DashboardSnapshot = {
  openInvoices: 0,
  outstandingBalance: 0,
  activeJobCount: 0,
  activeJobs: [],
  recentDocuments: [],
  overdueInvoiceCount: 0,
  pendingApprovalCount: 0,
  dueReminderCount: 0,
  overdueInvoices: [],
  dueReminders: [],
  todayAppointments: [],
  pendingApprovals: [],
}

export default function DashboardPage({ business, onSetup, onNavigate, onReminders }: { business: CurrentBusiness; onSetup?: () => void; onNavigate?: (view: DashboardDestination) => void; onReminders?: () => void }) {
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
      load = getDashboardSnapshot(business.id, business.timezone)
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
  }, [business.id, business.timezone])

  const attentionCount = snapshot.overdueInvoiceCount + snapshot.dueReminderCount + snapshot.pendingApprovalCount

  return <div className="page-stack dashboard-page">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">{business.name} · Today</p><h1>{loading || error ? 'Your day, organized.' : attentionCount ? `${attentionCount} item${attentionCount === 1 ? ' needs' : 's need'} your attention.` : 'Your office is caught up.'}</h1></div>
      <button className="secondary-button compact" onClick={() => void refresh(true)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    <DailyCalendar key={business.id} business={business} onWork={() => onNavigate?.('schedule')} onReminders={() => onReminders?.()} />

    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    <section className="dashboard-work-grid" aria-label="Work areas">
      <BillingHub business={business} snapshot={snapshot} loading={loading} error={error} onNavigate={onNavigate} />
      <DashboardJobs snapshot={snapshot} loading={loading} error={error} onOpen={() => onNavigate?.('work')} />
    </section>

    {error && <p role="alert" className="form-message error-text">{error}</p>}

    <FinancialPerformance key={`${business.id}:${business.role}`} business={business} onOpenWorkbook={onNavigate ? () => onNavigate('bookkeeping') : undefined} />


  </div>
}
