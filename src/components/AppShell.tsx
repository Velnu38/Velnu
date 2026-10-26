import { useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { supabase } from '../lib/supabase'
import DashboardPage from '../pages/DashboardPage'
import CustomersPage from '../pages/CustomersPage'
import JobsPage from '../pages/JobsPage'
import ChangeOrdersPage from '../pages/ChangeOrdersPage'
import EstimatesPage from '../pages/EstimatesPage'
import InvoicesPage from '../pages/InvoicesPage'
import SchedulePage from '../pages/SchedulePage'
import PaymentsPage from '../pages/PaymentsPage'
import VoiceAssistant from './VoiceAssistant'
import SettingsPage from '../pages/SettingsPage'

type View = 'dashboard' | 'customers' | 'jobs' | 'change_orders' | 'estimates' | 'invoices' | 'schedule' | 'payments' | 'settings'

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'customers', label: 'Customers', icon: 'C' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'change_orders', label: 'Change Orders', icon: 'CO' },
  { id: 'estimates', label: 'Estimates', icon: 'E' },
  { id: 'invoices', label: 'Invoices', icon: 'I' },
  { id: 'schedule', label: 'Schedule', icon: 'S' },
  { id: 'payments', label: 'Payments', icon: '
]

const mobilePrimary: View[] = ['dashboard', 'customers', 'jobs', 'schedule']
const mobileMore: View[] = ['change_orders', 'estimates', 'invoices', 'payments', 'settings']

export default function AppShell({ business }: { business: CurrentBusiness }) {
  const [company, setCompany] = useState(business)
  const [view, setView] = useState<View>('dashboard')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)

  function navigate(next: View) {
    setView(next)
    setShowMobileMore(false)
  }

  function page() {
    if (view === 'settings') return <SettingsPage business={company} onSaved={(next) => { setCompany(next); setRefreshVersion(v => v + 1) }} />
    if (view === 'dashboard') return <DashboardPage business={company} onSetup={() => navigate('settings')} />
    if (view === 'customers') return <CustomersPage business={company} />
    if (view === 'jobs') return <JobsPage business={company} />
    if (view === 'change_orders') return <ChangeOrdersPage business={company} />
    if (view === 'estimates') return <EstimatesPage business={company} />
    if (view === 'invoices') return <InvoicesPage business={company} />
    if (view === 'schedule') return <SchedulePage business={company} />
    return <PaymentsPage business={company} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="logo-mark small">V</div><span>Velnu</span></div>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="business-chip"><strong>{company.name}</strong><span>{company.role}</span></div><button className="text-button left" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div className="mobile-brand"><div className="logo-mark small">V</div><strong>Velnu</strong></div><div className="topbar-business"><span>{company.name}</span><span className="role-pill">{company.role}</span></div></header>
        <div className="workspace-inner" key={`${view}-${refreshVersion}`}>{page()}</div>
      </main>
      <nav className="mobile-nav">
        {mobilePrimary.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>
        })}
        <button className={mobileMore.includes(view) || showMobileMore ? 'active' : ''} onClick={() => setShowMobileMore(true)}><span>•••</span><small>More</small></button>
      </nav>
      {showMobileMore && <div className="mobile-more-backdrop" onMouseDown={() => setShowMobileMore(false)}><section className="mobile-more-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mobile-more-handle" />
        <div className="mobile-more-head"><div><p className="eyebrow">Velnu</p><h2>More</h2></div><button className="icon-button" onClick={() => setShowMobileMore(false)}>×</button></div>
        <div className="mobile-more-grid">{mobileMore.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><span className="more-icon">{item.icon}</span><strong>{item.label}</strong></button>
        })}</div>
        <div className="mobile-more-account"><div><strong>{company.name}</strong><span>{company.role}</span></div><button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </section></div>}
      <VoiceAssistant business={company} onChanged={() => setRefreshVersion((v) => v + 1)} />
    </div>
  )
}
 },
  { id: 'settings', label: 'Company settings', icon: '⚙' },
]

const mobilePrimary: View[] = ['dashboard', 'customers', 'jobs', 'schedule']
const mobileMore: View[] = ['change_orders', 'estimates', 'invoices', 'payments']

export default function AppShell({ business }: { business: CurrentBusiness }) {
  const [view, setView] = useState<View>('dashboard')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)

  function navigate(next: View) {
    setView(next)
    setShowMobileMore(false)
  }

  function page() {
    if (view === 'dashboard') return <DashboardPage business={company} />
    if (view === 'customers') return <CustomersPage business={company} />
    if (view === 'jobs') return <JobsPage business={company} />
    if (view === 'change_orders') return <ChangeOrdersPage business={company} />
    if (view === 'estimates') return <EstimatesPage business={company} />
    if (view === 'invoices') return <InvoicesPage business={company} />
    if (view === 'schedule') return <SchedulePage business={company} />
    return <PaymentsPage business={company} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="logo-mark small">V</div><span>Velnu</span></div>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="business-chip"><strong>{company.name}</strong><span>{company.role}</span></div><button className="text-button left" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div className="mobile-brand"><div className="logo-mark small">V</div><strong>Velnu</strong></div><div className="topbar-business"><span>{company.name}</span><span className="role-pill">{company.role}</span></div></header>
        <div className="workspace-inner" key={`${view}-${refreshVersion}`}>{page()}</div>
      </main>
      <nav className="mobile-nav">
        {mobilePrimary.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>
        })}
        <button className={mobileMore.includes(view) || showMobileMore ? 'active' : ''} onClick={() => setShowMobileMore(true)}><span>•••</span><small>More</small></button>
      </nav>
      {showMobileMore && <div className="mobile-more-backdrop" onMouseDown={() => setShowMobileMore(false)}><section className="mobile-more-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mobile-more-handle" />
        <div className="mobile-more-head"><div><p className="eyebrow">Velnu</p><h2>More</h2></div><button className="icon-button" onClick={() => setShowMobileMore(false)}>×</button></div>
        <div className="mobile-more-grid">{mobileMore.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><span className="more-icon">{item.icon}</span><strong>{item.label}</strong></button>
        })}</div>
        <div className="mobile-more-account"><div><strong>{company.name}</strong><span>{company.role}</span></div><button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </section></div>}
      <VoiceAssistant business={company} onChanged={() => setRefreshVersion((v) => v + 1)} />
    </div>
  )
}
