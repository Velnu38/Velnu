import { canAccess, canOpenView, workspaceModules } from '../lib/workspaceAccess'
import BillingHub from '../components/BillingHub'
import DailyCalendar from '../components/calendar/DailyCalendar'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { businessLogoUrl, type CurrentBusiness } from '../lib/business'
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'
import FinancialPerformance from '../components/FinancialPerformance'
import '../components/dashboard-interactive.css'
import { readableError } from '../lib/errors'
import '../components/dashboard-tiles.css'
import AttentionReminders from '../components/AttentionReminders'
import FormDialog from '../components/FormDialog'
import WorkspaceIcon from '../components/WorkspaceIcon'
import { DateTime } from 'luxon'

const CalendarEntryDialog = lazy(() => import('../components/calendar/CalendarEntryDialog'))

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

export default function DashboardPage({ business, onSetup, onNavigate }: { business: CurrentBusiness; onSetup?: () => void; onNavigate?: (view: DashboardDestination) => void }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [showCreate, setShowCreate] = useState(false)
  const [showEntry, setShowEntry] = useState(false)
  const [attentionCount, setAttentionCount] = useState(0)
  const [openAttention, setOpenAttention] = useState(0)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const workspaceKey = [business.id, business.role, business.access_modules?.join(',')].join(':')
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

  const logo = businessLogoUrl(business)
  const canCreateBilling = canAccess(business, 'billing') && ['owner', 'admin', 'office'].includes(business.role)
  const canCreateJob = canAccess(business, 'jobs') && business.role !== 'viewer'
  const canCreateEntry = canAccess(business, 'calendar') && business.role !== 'viewer'

  return <div className="page-stack dashboard-page">
    <header className="page-heading split-heading dashboard-business-header">
      <div className="dashboard-business-identity">{logo && <img className="dashboard-business-logo" src={logo} alt={business.name + ' logo'} />}<div><p className="home-eyebrow">Your workspace</p><h1>{business.name}</h1><p className="home-intro">Your business, at a glance.</p></div></div>
      <div className="home-header-actions">{(canCreateBilling || canCreateJob || canCreateEntry) && <button type="button" className="primary-button compact home-create-button" aria-label="Create new" aria-describedby="home-quick-links" aria-haspopup="dialog" aria-expanded={showCreate} onClick={() => setShowCreate(true)}>
        <span className="home-create-copy">
          <span className="home-create-label"><span aria-hidden="true">＋</span> New</span>
          <span className="home-create-subtitle" id="home-quick-links">Quick Links</span>
        </span>
      </button>}<button className="secondary-button compact" onClick={() => { setRefreshVersion(value => value + 1); void refresh(true) }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    </header>
    <div className="home-overview">
      {canAccess(business,'calendar') && <DailyCalendar key={workspaceKey+':calendar'} business={business} refreshVersion={refreshVersion} />}
      {attentionCount>0&&canAccess(business,'billing')&&<button type="button" className="text-button attention-jump" onClick={()=>setOpenAttention(value=>value+1)}>Jump to Needs Attention</button>}
      {canAccess(business,'finances') && <FinancialPerformance key={workspaceKey+':financial'} business={business} refreshVersion={refreshVersion} compact onOpenWorkbook={onNavigate ? () => onNavigate('bookkeeping') : undefined} />}
      {canAccess(business,'billing') && <BillingHub key={workspaceKey+':attention'} business={business} refreshVersion={refreshVersion} openRequest={openAttention} onPendingChange={setAttentionCount} />}
    </div>

    {showCreate && <FormDialog label="Create new" onClose={() => setShowCreate(false)}>
      <div className="modal-head"><div><p className="eyebrow">{business.name}</p><h2>Create new</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowCreate(false)}>×</button></div>
      <nav className="home-create-options" aria-label="Create work and quick links">
        {canCreateBilling && <><a href="/?view=invoices&new=1" aria-label="+ New invoice"><WorkspaceIcon kind="invoices"/><span><strong>Invoice</strong><small>Bill a customer for your work</small></span><span aria-hidden="true">›</span></a><a href="/?view=estimates&new=1" aria-label="+ New estimate"><WorkspaceIcon kind="estimates"/><span><strong>Estimate</strong><small>Prepare a quote for a customer</small></span><span aria-hidden="true">›</span></a></>}
        {canCreateJob && <a href="/?view=work&new=1" aria-label="+ New job"><WorkspaceIcon kind="work"/><span><strong>Job</strong><small>Plan and manage customer work</small></span><span aria-hidden="true">›</span></a>}
        {canCreateEntry && <><button type="button" aria-label="+ New calendar entry" onClick={() => { setShowCreate(false); setShowEntry(true) }}><WorkspaceIcon kind="schedule"/><span><strong>Calendar entry</strong><small>Add an appointment or event</small></span><span aria-hidden="true">›</span></button><a href="/?view=reminders&new=1" aria-label="+ New reminder"><WorkspaceIcon kind="reminders"/><span><strong>Reminder</strong><small>Keep track of a follow-up</small></span><span aria-hidden="true">›</span></a></>}
        {canOpenView(business, 'customers') && <a href="/?view=customers" aria-label="Customers"><WorkspaceIcon kind="customers"/><span><strong>Customers</strong><small>Find customer details, locations, and history</small></span><span aria-hidden="true">›</span></a>}
      </nav>
    </FormDialog>}

    {showEntry && <Suspense fallback={<p role="status">Opening calendar entry…</p>}><CalendarEntryDialog business={business} day={DateTime.now().setZone(business.timezone || 'America/New_York').toISODate()!} onClose={() => setShowEntry(false)} onSaved={() => setRefreshVersion(value => value + 1)}/></Suspense>}
    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    {!canAccess(business,'billing')&&canAccess(business,'calendar')&&<section className="dashboard-tile home-attention-tile" aria-label="Needs Attention"><div className="work-card-heading"><div><p className="eyebrow">Your next steps</p><h2 className="dashboard-tile-title">Needs Attention</h2></div></div><AttentionReminders business={business} reminders={snapshot.dueReminders}/></section>}
    {error && <p role="alert" className="form-message error-text">{error}</p>}



  </div>
}
