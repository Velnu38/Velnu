import FinBrand from './FinBrand'
import FormDialog from './FormDialog'
import {confirmNavigation} from '../lib/unsavedChanges'
import { canOpenView, canUseAssistant } from '../lib/workspaceAccess'
import { lazy, Suspense, useState, useEffect, useRef, type MouseEvent } from 'react'
import { getCurrentBusiness, type CurrentBusiness } from '../lib/business'
import { supabase } from '../lib/supabase'
import WorkspaceBack, { WorkspaceNavigation } from './WorkspaceBack'
import WorkspaceErrorBoundary from './WorkspaceErrorBoundary'










import AiAssistantAccess from './AiAssistantAccess'
import PrivateBetaNotice from './PrivateBetaNotice'
import './private-beta.css'




// Load each workspace module only when navigated to; preserve page state boundaries.
const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const CustomersPage = lazy(() => import('../pages/CustomersPage'))
const JobsPage = lazy(() => import('../pages/JobsPage'))
const SchedulePage = lazy(() => import('../pages/SchedulePage'))
const RemindersPage = lazy(() => import('../pages/RemindersPage'))
const ChangeOrdersPage = lazy(() => import('../pages/ChangeOrdersPage'))
const EstimatesPage = lazy(() => import('../pages/EstimatesPage'))
const InvoicesPage = lazy(() => import('../pages/InvoicesPage'))
const PaymentsPage = lazy(() => import('../pages/PaymentsPage'))
const BookkeepingPage = lazy(() => import('../pages/BookkeepingPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))

type View = 'schedule' | 'reminders' | 'dashboard' | 'customers' | 'work' | 'change_orders' | 'estimates' | 'invoices' | 'payments' | 'bookkeeping' | 'settings'

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'customers', label: 'Customers', icon: 'C' },
  { id: 'estimates', label: 'Estimates', icon: 'E' },
  { id: 'invoices', label: 'Invoices', icon: 'I' },
  { id: 'work', label: 'Jobs', icon: 'J' },
  { id: 'schedule', label: 'Schedule', icon: '▦' },
  { id: 'reminders', label: 'Reminders', icon: '✓' },
  { id: 'payments', label: 'Payments', icon: '$' },
  { id: 'bookkeeping', label: 'Financial performance', icon: '↗' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const mobilePrimary: View[] = ['dashboard', 'customers']
const mobileMore: View[] = ['estimates', 'invoices', 'payments', 'bookkeeping', 'settings']
const sidebarNav = nav.filter(({ id }) => !['estimates', 'invoices', 'work', 'bookkeeping', 'change_orders', 'schedule', 'reminders'].includes(id))

function DockIcon({ kind }: { kind: string }) {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{kind === 'dashboard'
    ? <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>
    : kind === 'customers' ? <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></>
    : <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>}</svg>
}

function initialView(): View {
  const query = new URLSearchParams(window.location.search)
  if (query.has('quickbooks')) return 'bookkeeping'
  const requested = query.get('view')
  if(requested==='locations'){query.set('view','customers');window.history.replaceState(window.history.state,'','/?'+query.toString());return 'customers'}
  if(requested==='change_orders')return 'change_orders'
  return nav.some(item => item.id === requested) ? requested as View : 'dashboard'
}

export default function AppShell({ business }: { business: CurrentBusiness }) {
  const [company, setCompany] = useState(business)
  const [view, setView] = useState<View>(initialView())
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [finAvailable, setFinAvailable] = useState(false)

  const [accessRemoved, setAccessRemoved] = useState(false)
  useEffect(() => {
    let active = true
    const check = () => { void getCurrentBusiness().then(next => { if (!active) return; if (!next || next.id !== business.id) setAccessRemoved(true); else { setCompany(next); setAccessRemoved(false) } }).catch(() => { if (active) setAccessRemoved(true) }) }
    const timer = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [business.id])

  const navigationIndex = useRef(0),lastLocation=useRef(location.href)
  useEffect(()=>{const remember=()=>queueMicrotask(()=>{lastLocation.current=location.href});document.addEventListener('click',remember);return()=>document.removeEventListener('click',remember)},[])
  useEffect(() => {
    window.history.replaceState({...window.history.state,finviantIndex:0},'',window.location.href)
    const pop=(event:PopStateEvent)=>{if(!event.state?.finviantConfirmedSave&&!confirmNavigation()){history.pushState({finviantIndex:navigationIndex.current},'',lastLocation.current);return}lastLocation.current=location.href;navigationIndex.current=Number(window.history.state?.finviantIndex)||0;setView(initialView());setRefreshVersion(v=>v+1);setShowMobileMore(false)}
    window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)
  },[])
  function back() {
    if(navigationIndex.current>0){window.history.back();return}
    if(!confirmNavigation())return
    window.history.replaceState({...window.history.state,finviantIndex:0},'','/?view=dashboard');setView('dashboard')
  }
  function navigate(next: View) {
    if(next===view){setShowMobileMore(false);return}
    if(!confirmNavigation())return
    navigationIndex.current++
    window.history.pushState({finviantIndex:navigationIndex.current},'','/?view='+next)
    setView(next)
    setShowMobileMore(false)
  }

  function openAppLink(event: MouseEvent) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return
    const link=(event.target as Element).closest('a[href]')
    if(!(link instanceof HTMLAnchorElement)||link.target||link.hasAttribute('download'))return
    const url=new URL(link.href)
    if(url.origin!==location.origin||url.pathname!=='/'||!nav.some(item=>item.id===url.searchParams.get('view')))return
    event.preventDefault();if(!confirmNavigation())return;navigationIndex.current++
    window.history.pushState({finviantIndex:navigationIndex.current},'',url.pathname+url.search)
    setView(initialView());setRefreshVersion(v=>v+1);setShowMobileMore(false)
  }

  function page() {
    if (accessRemoved) return <><WorkspaceBack/><p role="alert">Your business access could not be verified. Contact the primary owner or reload after reconnecting.</p></>
    if (!canOpenView(company, view)) return <><WorkspaceBack/><p role="alert">This area is not included in your access. Contact your primary business owner.</p></>
    if (view === 'settings') return <SettingsPage business={company} onSaved={setCompany} />
    if (view === 'dashboard') return <DashboardPage business={company} onSetup={() => navigate('settings')} onNavigate={navigate} />
    if (view === 'customers') return <CustomersPage business={company} />
    if (view === 'work') return <JobsPage business={company} />
    if (view === 'schedule') return <SchedulePage business={company} />
    if (view === 'reminders') return <RemindersPage business={company} />
    if (view === 'change_orders')return <ChangeOrdersPage business={company}/>
    if (view === 'estimates') return <EstimatesPage business={company} />
    if (view === 'invoices') return <InvoicesPage business={company} />
    if (view === 'bookkeeping') return <BookkeepingPage key={company.id + ':' + company.role} business={company} />
    return <PaymentsPage business={company} onOpenWorkbook={() => navigate('bookkeeping')} />
  }

  return (
    <WorkspaceNavigation.Provider value={back}><div className="app-shell" onClick={openAppLink}>
      <aside className="sidebar">
        <div className="sidebar-brand"><FinBrand wordmark/></div>
        <nav>{sidebarNav.filter(item => canOpenView(company,item.id)).map((item) => <button key={item.id} aria-label={item.label} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="sidebar-legal"><a href="/install" target="_blank" rel="noopener noreferrer">Get app icon</a><a href="/legal" target="_blank" rel="noopener noreferrer">User agreement, AI & privacy</a></div><div className="business-chip"><strong>{company.name}</strong><span>{company.role}</span></div><button className="text-button left" onClick={() => {if(confirmNavigation())void supabase.auth.signOut()}}>Sign out</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div className="mobile-brand"><FinBrand wordmark/></div><div className="topbar-business"><span>{company.name}</span><span className="role-pill">{company.role}</span></div></header>
        <div className="private-testing-app"><PrivateBetaNotice compact /></div>
        <div className="workspace-inner" key={`${view}-${refreshVersion}`}><WorkspaceErrorBoundary><Suspense fallback={<div className="loading-page" role="status">Loading workspace…</div>}>{page()}</Suspense></WorkspaceErrorBoundary></div>
      </main>
      <nav className="mobile-nav" aria-label="Workspace navigation">
        {mobilePrimary.filter(id => canOpenView(company,id)).map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={item.id} aria-label={item.label} aria-current={view === item.id ? 'page' : undefined} className={`mobile-destination ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><DockIcon kind={item.id}/><small>{item.label}</small></button>
        })}
        {!accessRemoved && canUseAssistant(company) && <AiAssistantAccess business={company} onAvailabilityChange={setFinAvailable} onChanged={() => {window.dispatchEvent(new Event('finviant-work-changed'));window.dispatchEvent(new Event('finviant-assistant-saved'))}} />}
        <button aria-label="More" aria-haspopup="dialog" aria-expanded={showMobileMore} aria-controls="mobile-more-options" className={`mobile-destination ${mobileMore.includes(view) || showMobileMore ? 'active' : ''}`} onClick={() => setShowMobileMore(true)}><DockIcon kind="more"/><small>More</small></button>
      </nav>
      {showMobileMore && <FormDialog label="More navigation" onClose={()=>setShowMobileMore(false)}><section className="mobile-more-sheet" id="mobile-more-options">
        <div className="mobile-more-handle" />
        <div className="mobile-more-head"><div><p className="eyebrow">Finviant Office</p><h2>More</h2></div><button className="icon-button" onClick={() => setShowMobileMore(false)} type="button" aria-label="Close">×</button></div>
        <div className="mobile-more-grid">{mobileMore.filter(id => canOpenView(company,id)).map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={id} aria-label={item.label} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><span className="more-icon" aria-hidden="true">{item.icon}</span><strong>{item.label}</strong></button>
        })}
        {!accessRemoved&&canUseAssistant(company)&&finAvailable&&<button type="button" onClick={()=>{setShowMobileMore(false);window.dispatchEvent(new Event('finviant-assistant-type'))}}><span className="more-icon" aria-hidden="true">⌨</span><strong>Type to Fin</strong></button>}</div>
        <div className="mobile-more-account"><div><strong>{company.name}</strong><span>{company.role}</span></div><a href="/legal" target="_blank" rel="noopener noreferrer">Agreement & privacy</a><a href="/install" target="_blank" rel="noopener noreferrer">App icon</a><button className="secondary-button" onClick={() => {if(confirmNavigation())void supabase.auth.signOut()}}>Sign out</button></div>
      </section></FormDialog>}
    </div></WorkspaceNavigation.Provider>
  )
}
