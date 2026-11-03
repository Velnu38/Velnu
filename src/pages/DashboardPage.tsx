import { canAccess, workspaceModules } from '../lib/workspaceAccess'
import BillingHub, { DashboardJobs } from '../components/BillingHub'
import DailyCalendar from '../components/calendar/DailyCalendar'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'
import FinancialPerformance from '../components/FinancialPerformance'
import '../components/dashboard-interactive.css'
import { readableError } from '../lib/errors'
import WorkflowNextSteps from '../components/scheduling/WorkflowNextSteps'
import '../components/dashboard-tiles.css'
import AttentionReminders from '../components/AttentionReminders'

type DashboardDestination = 'estimates' | 'invoices' | 'work' | 'schedule' | 'bookkeeping'
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
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const workspaceKey = [business.id, business.role, business.access_modules?.join(',')].join(':')
  const [workflowAttention, setWorkflowAttention] = useState<{ key: string; count: number | null } | null>(null)
  const onWorkflowCount = useCallback((count: number | null) => setWorkflowAttention({ key: workspaceKey, count }), [workspaceKey])
  // A route change or newer refresh invalidates an older response. This also
  // avoids setState on an unmounted workspace after a slow network request.
  const currentRequest = useRef(0)
  const mounted = useRef(false)
  // Share concurrent first loads (including React Strict Mode's effect replay)
  // without caching financial data across users, sessions, or businesses.
  const pendingLoad = useRef<{ businessId: string; accessKey: string; promise: Promise<DashboardSnapshot> } | null>(null)

  async function refresh(force = false, background = false) {
    if (!mounted.current) return
    const request = ++currentRequest.current
    if (!background) setLoading(true)
    setError('')

    const accessKey = business.role + ':' + business.access_modules?.join(',')
    let load = !force && pendingLoad.current?.businessId === business.id && pendingLoad.current?.accessKey === accessKey
      ? pendingLoad.current.promise
      : null
    if (!load) {
      load = getDashboardSnapshot(business.id, business.timezone, Object.fromEntries(workspaceModules.map(m => [m.id,canAccess(business,m.id)])))
      pendingLoad.current = { businessId: business.id, accessKey, promise: load }
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
    const update = () => { if (!document.hidden) void refresh(true, true) }
    const timer = window.setInterval(update, 30000)
    window.addEventListener('finviant-work-changed', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      mounted.current = false; currentRequest.current++
      clearInterval(timer)
      window.removeEventListener('finviant-work-changed', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [business.id, business.timezone, business.access_modules?.join(','), business.role])

  const workflowAllowed = ['owner','admin','office'].includes(business.role) && ['jobs','calendar','billing'].every(m=>canAccess(business,m as 'jobs'|'calendar'|'billing'))
  const workflowCount = !workflowAllowed ? 0 : workflowAttention?.key === workspaceKey ? workflowAttention.count : null
  const attentionCount = snapshot.overdueInvoiceCount + snapshot.dueReminderCount + snapshot.pendingApprovalCount + (workflowCount ?? 0)

  return <div className="page-stack dashboard-page">
    <nav className="workspace-quick-actions" aria-label="Create work">{canAccess(business,'billing')&&<><a className="primary-button" href="/?view=invoices&new=1">+ New invoice</a><a className="secondary-button" href="/?view=estimates&new=1">+ New estimate</a></>}{canAccess(business,'jobs')&&business.role!=='viewer'&&<a className="secondary-button" href="/?view=work&new=1">+ New job</a>}</nav>
    <div className="page-heading split-heading">
      <div><p className="eyebrow">{business.name} · Today</p><h1 aria-live="polite">{loading || error || workflowCount === null ? 'Your day, organized.' : attentionCount ? `${attentionCount} item${attentionCount === 1 ? ' needs' : 's need'} your attention.` : 'Your office is caught up.'}</h1></div>
      <button className="secondary-button compact" onClick={() => { setRefreshVersion(value => value + 1); void refresh(true) }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {canAccess(business,'calendar') && <DailyCalendar key={business.id} business={business} refreshVersion={refreshVersion} onReminders={() => onReminders?.()} showReminders={false} />}

    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    <section className="dashboard-work-grid" aria-label="Work areas">
      {canAccess(business,'billing') && <BillingHub business={business} snapshot={snapshot} loading={loading} error={error} onNavigate={onNavigate} extraAttention={(workflowCount ?? 0) + snapshot.dueReminderCount}><WorkflowNextSteps key={workspaceKey} business={business} refreshVersion={refreshVersion} onCountChange={onWorkflowCount} embedded /><AttentionReminders business={business} reminders={snapshot.dueReminders} /></BillingHub>}
      {canAccess(business,'jobs') && <DashboardJobs snapshot={snapshot} loading={loading} error={error} onOpen={() => onNavigate?.('work')} />}
    </section>

    {!canAccess(business,'billing')&&canAccess(business,'calendar')&&<section className="dashboard-tile" aria-label="Needs Attention"><h2 className="dashboard-tile-title">Needs Attention</h2><AttentionReminders business={business} reminders={snapshot.dueReminders}/></section>}
    {error && <p role="alert" className="form-message error-text">{error}</p>}

    {canAccess(business,'finances') && <FinancialPerformance key={`${business.id}:${business.role}`} business={business} refreshVersion={refreshVersion} onOpenWorkbook={onNavigate ? () => onNavigate('bookkeeping') : undefined} />}


  </div>
}
