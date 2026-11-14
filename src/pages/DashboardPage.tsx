import HomeAttention from '../components/HomeAttention'
import {DateTime} from 'luxon'
import SendBusinessCard, {BusinessCardQuickLink} from '../components/SendBusinessCard'
import { useBusinessRefresh } from '../lib/useBusinessRefresh'
import { canAccess, canOpenView, workspaceModules } from '../lib/workspaceAccess'
import DailyCalendar from '../components/calendar/DailyCalendar'
import { useEffect, useRef, useState } from 'react'
import { businessLogoUrl, type CurrentBusiness } from '../lib/business'
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'
import FinancialPerformance from '../components/FinancialPerformance'
import '../components/dashboard-interactive.css'
import { readableError } from '../lib/errors'
import '../components/dashboard-tiles.css'
import AttentionReminders from '../components/AttentionReminders'
import FormDialog from '../components/FormDialog'
import WorkspaceIcon from '../components/WorkspaceIcon'
import RefreshButton from '../components/RefreshButton'
import { canOpenSettingsSection, settingsHref } from '../lib/settingsNavigation'
import '../home-consistency.css'
import '../components/home-revised.css'

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
  const [receivables,setReceivables]=useState<{key:string;overdue:number}|null>(null)
  const [showCardSend,setShowCardSend] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
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
    return () => {
      mounted.current = false; currentRequest.current++
    }
  }, [business.id, business.timezone, business.access_modules?.join(','), business.role])

  useBusinessRefresh(business.id, () => refresh(true, true))

  const logo = businessLogoUrl(business)
  const canCreateBilling = canAccess(business, 'billing') && ['owner', 'admin', 'office'].includes(business.role)
  const canCreateJob = canAccess(business, 'jobs') && business.role !== 'viewer'
  const canCreateEntry = canAccess(business, 'calendar') && business.role !== 'viewer'
  const canManageTeam = canOpenSettingsSection(business, 'team')

  return <div className="page-stack dashboard-page home-revised">
    <header className="page-heading split-heading dashboard-business-header">
      <div className="dashboard-business-identity">{logo && <img className="dashboard-business-logo" src={logo} alt={business.name + ' logo'} />}<div><h1>{business.name}</h1><p className="home-date">{DateTime.now().setZone(business.timezone||'America/New_York').toFormat('cccc, MMMM d')}</p></div></div>
      <div className="home-header-actions">{(canCreateBilling || canCreateJob || canCreateEntry || canManageTeam) && <button type="button" className="primary-button compact home-create-button" aria-label="Quick Links" aria-busy={loading} aria-haspopup="dialog" aria-expanded={showCreate} onClick={() => setShowCreate(true)}>Quick Links</button>}{!(canCreateBilling || canCreateJob || canCreateEntry || canManageTeam)&&<RefreshButton label="Refresh Home" busy={loading} onClick={()=>{setRefreshVersion(value=>value+1);void refresh(true)}}/>}</div>
    </header>
    <div className="home-overview">
      {canAccess(business,'calendar') && <DailyCalendar key={workspaceKey+':calendar'} business={business} refreshVersion={refreshVersion} compact summary />}
      <HomeAttention key={workspaceKey+':attention'} business={business} refreshVersion={refreshVersion} overdueAmount={receivables?.key===workspaceKey?receivables.overdue:undefined} approvalBreakdown={{estimates:snapshot.pendingEstimateCount,changeOrders:snapshot.pendingChangeOrderCount}}/>
      {canAccess(business,'finances') && <FinancialPerformance key={workspaceKey+':financial'} business={business} refreshVersion={refreshVersion} compact summary onReceivables={value=>setReceivables(value?.currency_supported?{key:workspaceKey,overdue:value.receivables.overdue}:null)} onOpenWorkbook={onNavigate ? () => onNavigate('bookkeeping') : undefined} />}
    </div>

    {showCreate && <FormDialog label="Quick Links" onClose={() => setShowCreate(false)}>
      <div className="modal-head"><div><p className="eyebrow">{business.name}</p><h2>Quick Links</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowCreate(false)}>×</button></div>
      <nav className="home-create-options" aria-label="Create work and quick links">
<h3 className="quick-links-heading">Create</h3>
        {canCreateBilling && <><a href="/?view=invoices&new=1" aria-label="+ New invoice"><WorkspaceIcon kind="invoices"/><span><strong>Invoice</strong><small>Bill a customer for your work</small></span><span aria-hidden="true">›</span></a><a href="/?view=estimates&new=1" aria-label="+ New estimate"><WorkspaceIcon kind="estimates"/><span><strong>Estimate</strong><small>Prepare a quote for a customer</small></span><span aria-hidden="true">›</span></a></>}
        {canCreateJob && <a href="/?view=work&new=1" aria-label="+ New job"><WorkspaceIcon kind="work"/><span><strong>Job</strong><small>Plan and manage customer work</small></span><span aria-hidden="true">›</span></a>}
        {canCreateEntry && <a href="/?view=reminders&new=1" aria-label="+ New reminder"><WorkspaceIcon kind="reminders"/><span><strong>Reminder</strong><small>Keep track of a follow-up</small></span><span aria-hidden="true">›</span></a>}
        <h3 className="quick-links-heading">Go to / Share</h3>
        {canCreateBilling&&<BusinessCardQuickLink business={business} onOpen={()=>{setShowCreate(false);setShowCardSend(true)}}/>}
        {canOpenView(business, 'customers') && <a href="/?view=customers" aria-label="Customers"><WorkspaceIcon kind="customers"/><span><strong>Customers</strong><small>Find customer details, locations, and history</small></span><span aria-hidden="true">›</span></a>}
        {canManageTeam && <a href={settingsHref('team')} aria-label="Team Management"><WorkspaceIcon kind="customers"/><span><strong>Team Management</strong><small>Workers, availability, and account access</small></span><span aria-hidden="true">›</span></a>}
      </nav>
      <div className="modal-actions"><RefreshButton label="Refresh Home" busy={loading} onClick={()=>{setRefreshVersion(value=>value+1);void refresh(true);setShowCreate(false)}}/></div>
    </FormDialog>}

    {showCardSend&&<SendBusinessCard key={business.id} business={business} onClose={()=>setShowCardSend(false)}/>}
    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    {!canAccess(business,'billing')&&!canAccess(business,'jobs')&&canAccess(business,'calendar')&&<section className="dashboard-tile home-attention-tile" aria-label="Needs Attention"><div className="work-card-heading"><div><p className="eyebrow">Your next steps</p><h2 className="dashboard-tile-title">Needs Attention</h2></div></div><AttentionReminders business={business} reminders={snapshot.dueReminders}/></section>}
    {error && <p role="alert" className="form-message error-text">{error}</p>}



  </div>
}
