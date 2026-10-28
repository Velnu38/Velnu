import { lazy, Suspense, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { supabase } from '../lib/supabase'
import WorkspaceErrorBoundary from './WorkspaceErrorBoundary'









import AiAssistantAccess from './AiAssistantAccess'



import { hasPendingServiceInterests } from '../lib/serviceCatalog'

// Load each workspace module only when navigated to; preserve page state boundaries.
const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const CustomersPage = lazy(() => import('../pages/CustomersPage'))
const JobsPage = lazy(() => import('../pages/JobsPage'))
const ChangeOrdersPage = lazy(() => import('../pages/ChangeOrdersPage'))
const EstimatesPage = lazy(() => import('../pages/EstimatesPage'))
const InvoicesPage = lazy(() => import('../pages/InvoicesPage'))
const SchedulePage = lazy(() => import('../pages/SchedulePage'))
const PaymentsPage = lazy(() => import('../pages/PaymentsPage'))
const BookkeepingPage = lazy(() => import('../pages/BookkeepingPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const LocationsPage = lazy(() => import('../pages/LocationsPage'))
const WorkspaceServicesPage = lazy(() => import('../pages/WorkspaceServicesPage'))

type View = 'dashboard' | 'customers' | 'jobs' | 'locations' | 'change_orders' | 'estimates' | 'invoices' | 'schedule' | 'payments' | 'bookkeeping' | 'settings' | 'services'

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'customers', label: 'Customers', icon: 'C' },
  { id: 'locations', label: 'Locations', icon: '⌖' },
  { id: 'estimates', label: 'Estimates', icon: 'E' },
  { id: 'invoices', label: 'Invoices', icon: 'I' },
  { id: 'schedule', label: 'Schedule', icon: 'S' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'change_orders', label: 'Change Orders', icon: 'CO' },
  { id: 'payments', label: 'Payments', icon: '$' },
  { id: 'bookkeeping', label: 'Financial performance', icon: '↗' },
  { id: 'services', label: 'My services', icon: '◈' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const mobilePrimary: View[] = ['dashboard', 'customers', 'jobs', 'schedule']
const mobileMore: View[] = ['locations', 'change_orders', 'estimates', 'invoices', 'payments', 'bookkeeping', 'services', 'settings']
const sidebarNav = nav.filter(({ id }) => !['estimates', 'invoices', 'schedule', 'jobs'].includes(id))

export default function AppShell({ business }: { business: CurrentBusiness }) {
  const [company, setCompany] = useState(business)
  const [view, setView] = useState<View>(new URLSearchParams(window.location.search).has('quickbooks') ? 'bookkeeping' : hasPendingServiceInterests() ? 'services' : 'dashboard')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)

  function navigate(next: View) {
    setView(next)
    setShowMobileMore(false)
  }

  function page() {
    if (view === 'services') return <WorkspaceServicesPage business={company} />
    if (view === 'settings') return <SettingsPage business={company} onSaved={(next) => { setCompany(next); setRefreshVersion(v => v + 1) }} />
    if (view === 'dashboard') return <DashboardPage business={company} onSetup={() => navigate('settings')} onNavigate={navigate} />
    if (view === 'customers') return <CustomersPage business={company} />
    if (view === 'jobs') return <JobsPage business={company} />
    if (view === 'locations') return <LocationsPage business={company} onCustomers={() => navigate('customers')} />
    if (view === 'change_orders') return <ChangeOrdersPage business={company} />
    if (view === 'estimates') return <EstimatesPage business={company} />
    if (view === 'invoices') return <InvoicesPage business={company} />
    if (view === 'schedule') return <SchedulePage business={company} />
    if (view === 'bookkeeping') return <BookkeepingPage key={company.id + ':' + company.role} business={company} />
    return <PaymentsPage business={company} onOpenWorkbook={() => navigate('bookkeeping')} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="logo-mark small"><img src="/finviant-mark.svg" alt="" /></div><span>Finviant <span className="finviant-product">Office</span></span></div>
        <nav>{sidebarNav.map((item) => <button key={item.id} aria-label={item.label} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="sidebar-legal"><a href="/install" target="_blank" rel="noopener noreferrer">Get app icon</a><a href="/legal" target="_blank" rel="noopener noreferrer">User agreement, AI & privacy</a><a href="/plans">Service tier</a></div><div className="business-chip"><strong>{company.name}</strong><span>{company.role}</span></div><button className="text-button left" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div className="mobile-brand"><div className="logo-mark small"><img src="/finviant-mark.svg" alt="" /></div><strong>Finviant <span className="finviant-product">Office</span></strong></div><div className="topbar-business"><span>{company.name}</span><span className="role-pill">{company.role}</span></div></header>
        <div className="workspace-inner" key={`${view}-${refreshVersion}`}><WorkspaceErrorBoundary><Suspense fallback={<div className="loading-page" role="status">Loading workspace…</div>}>{page()}</Suspense></WorkspaceErrorBoundary></div>
      </main>
      <nav className="mobile-nav">
        {mobilePrimary.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={item.id} aria-label={item.label} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>
        })}
        <button aria-label="More" className={mobileMore.includes(view) || showMobileMore ? 'active' : ''} onClick={() => setShowMobileMore(true)}><span>•••</span><small>More</small></button>
      </nav>
      {showMobileMore && <div className="mobile-more-backdrop" onMouseDown={() => setShowMobileMore(false)}><section className="mobile-more-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mobile-more-handle" />
        <div className="mobile-more-head"><div><p className="eyebrow">Finviant Office</p><h2>More</h2></div><button className="icon-button" onClick={() => setShowMobileMore(false)}>×</button></div>
        <div className="mobile-more-grid">{mobileMore.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><span className="more-icon">{item.icon}</span><strong>{item.label}</strong></button>
        })}</div>
        <div className="mobile-more-account"><div><strong>{company.name}</strong><span>{company.role}</span></div><a href="/legal" target="_blank" rel="noopener noreferrer">Agreement & privacy</a><a href="/plans">Service tier</a><a href="/install" target="_blank" rel="noopener noreferrer">App icon</a><button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </section></div>}
      <AiAssistantAccess business={company} onChanged={() => setRefreshVersion((v) => v + 1)} />
    </div>
  )
}
