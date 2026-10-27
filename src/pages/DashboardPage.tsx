import { useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { completeReminder, getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'

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

export default function DashboardPage({ business, onSetup }: { business: CurrentBusiness; onSetup?: () => void }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // A route change or newer refresh invalidates an older response. This also
  // avoids setState on an unmounted workspace after a slow network request.
  const currentRequest = useRef(0)
  const mounted = useRef(false)

  async function refresh() {
    if (!mounted.current) return
    const request = ++currentRequest.current
    setLoading(true)
    setError('')
    try {
      const next = await getDashboardSnapshot(business.id)
      if (mounted.current && request === currentRequest.current) setSnapshot(next)
    } catch (err) {
      if (mounted.current && request === currentRequest.current) setError(err instanceof Error ? err.message : 'Unable to load dashboard')
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
      if (mounted.current) await refresh()
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to complete reminder')
    }
  }

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const attentionCount = snapshot.overdueInvoices.length + snapshot.dueReminders.length + snapshot.pendingApprovals.length

  return <div className="page-stack">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Velnu Office · Today</p><h1>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need your attention.` : 'Your office is caught up.'}</h1></div>
      <button className="secondary-button compact" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {!business.profile_completed_at && ['owner', 'admin'].includes(business.role) && <section className="setup-prompt"><div><strong>Complete your company profile</strong><p>Add your logo, address and phone so your invoices and estimates look like they come from your business.</p></div><button className="primary-button compact" onClick={onSetup}>Set up company</button></section>}
    <section className="metric-grid">
      <article className="metric-card"><span>Outstanding</span><strong>{loading ? '—' : money.format(snapshot.outstandingBalance)}</strong><small>{snapshot.openInvoices} unpaid invoice{snapshot.openInvoices === 1 ? '' : 's'}</small></article>
      <article className="metric-card"><span>Jobs next 7 days</span><strong>{loading ? '—' : snapshot.jobsThisWeek}</strong><small>{snapshot.todayAppointments.length} scheduled today</small></article>
      <article className="metric-card"><span>Waiting on customers</span><strong>{loading ? '—' : snapshot.pendingApprovals.length}</strong><small>Sent estimates and change orders</small></article>
    </section>

    {error && <p className="form-message error-text">{error}</p>}

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
      <div><p className="eyebrow">AI-assisted office manager</p><h2>Tell Velnu what needs to get done.</h2><p>Create customers, jobs, estimates, change orders, invoices, payments and schedule changes by voice. Anything involving money, scope or schedule is shown for confirmation first.</p></div>
      <div className="command-examples"><span>“Who hasn’t paid me?”</span><span>“Schedule Williams Tuesday at 10.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>
    </section>
  </div>
}
