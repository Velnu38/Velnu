import { useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../../lib/business'
import { calendarRange, workOnDay, type CalendarView } from '../../lib/calendarView'
import { loadCalendarRange } from '../../services/calendar'
import { completeWorkReminder } from '../../services/reminders'
import { getScheduleTeam, type Worker } from '../../services/schedulingWorkflow'

type Agenda = Awaited<ReturnType<typeof loadCalendarRange>>
export default function DailyCalendar({ business, onReminders, refreshVersion = 0 }: {
  business: CurrentBusiness; onReminders: () => void; refreshVersion?: number
}) {
  const zone = business.timezone || 'America/New_York'
  const [today, setToday] = useState(() => DateTime.now().setZone(zone).toISODate()!)
  const [day, setDay] = useState(today)
  const [view, setView] = useState<CalendarView>('week')
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ key: string; agenda: Agenda } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAllWork, setShowAllWork] = useState(false)
  const [showAllReminders, setShowAllReminders] = useState(false)
  const [team,setTeam]=useState<Worker[]>([]),[worker,setWorker]=useState('all')
  useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(value=>{if(!active)return;setTeam(value);if(business.role==='technician')setWorker(value.find(item=>item.is_you)?.id || 'all')}).catch(()=>{});return()=>{active=false}},[business.id,business.role])
  const previousToday = useRef(today)
  const selected = DateTime.fromISO(day, { zone })
  const range = calendarRange(day, zone, view)
  const from = range.start.toISODate()!, to = range.end.toISODate()!
  const key = [business.id, business.role, business.access_modules?.join(','), zone, from, to].join(':')
  const agenda = result?.key === key ? result.agenda : null
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      const next = DateTime.now().setZone(zone).toISODate()!
      const previous = previousToday.current
      previousToday.current = next
      setToday(next); setDay(value => value === previous ? next : value); setVersion(value => value + 1)
    }
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('finviant-work-changed', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('finviant-work-changed', refresh) }
  }, [zone])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void loadCalendarRange(business.id, from, to, zone).then(value => {
      if (active) setResult({ key, agenda: value })
    }).catch(() => { if (active) { setResult(null); setError('Unable to load the complete calendar. Please try again.') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [key, business.id, from, to, zone, version, refreshVersion])
  useEffect(() => { setShowAllWork(false); setShowAllReminders(false) }, [day])
  const workByDay = useMemo(() => new Map(range.days.map(date => [date.toISODate()!, workOnDay((agenda?.work ?? []).filter(item=>worker==='all'||item.assigned_user_ids?.includes(worker)), date.toISODate()!, zone)])), [agenda, from, to, zone,worker])
  const work = workByDay.get(day) ?? []
  const dueBefore = selected.plus({ days: 1 }).startOf('day').toMillis()
  const reminders = agenda?.reminders.filter(item => DateTime.fromISO(item.due_at).toMillis() < dueBefore) ?? []
  async function complete(id: string) {
    if (busy) return
    setBusy(id)
    try { await completeWorkReminder(business, id); setVersion(value => value + 1) }
    catch { setError('Unable to complete this reminder. Try again.') }
    finally { setBusy(null) }
  }
  const periodLabel = view === 'month' ? selected.toFormat('MMMM yyyy') : `${range.start.toFormat('MMM d')} – ${range.end.minus({ days: 1 }).toFormat('MMM d, yyyy')}`
  return <section className="dashboard-calendar calendar-no-print" aria-label="Work calendar">
    <div className="calendar-heading">
      <div><p className="eyebrow">Your schedule</p><h2>{view === 'week' ? 'Weekly schedule' : 'Monthly calendar'}</h2></div>
      <div className="calendar-heading-actions"><div className="view-switch" role="group" aria-label="Calendar view">{(['week','month'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'week' ? 'Week' : 'Month'}</button>)}</div><button className="calendar-add" onClick={onReminders}>+ Reminder</button></div>
    </div>
    {team.length>0&&<label className="worker-select">Show schedule for<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="all">Everyone</option>{team.map(item=><option value={item.id} key={item.id}>{item.is_you?'My schedule · ':''}{item.label}</option>)}</select></label>}
    <div className="calendar-period-nav">
      <div className="calendar-period-title"><button className="calendar-arrow" aria-label={`Previous ${view}`} onClick={() => setDay(selected.minus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)}>‹</button><strong aria-live="polite">{periodLabel}</strong><button className="calendar-arrow" aria-label={`Next ${view}`} onClick={() => setDay(selected.plus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)}>›</button></div>
      <label className="calendar-date-picker">{view === 'month' ? 'Month' : 'Jump to date'}<input type={view === 'month' ? 'month' : 'date'} aria-label={view === 'month' ? 'Calendar month' : 'Calendar date'} value={view === 'month' ? day.slice(0,7) : day} onChange={event => { const next = view === 'month' ? `${event.target.value}-01` : event.target.value; if (DateTime.fromISO(next, {zone}).isValid) setDay(next) }} /></label>
    </div>
    <div className={`calendar-grid ${view}`} role="group" aria-label={view === 'month' ? 'Choose a day in the month' : 'Choose a day in the week'}>
      {view === 'month' && ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(label => <span className="calendar-weekday" key={label}>{label}</span>)}
      {range.days.map(date => {
        const dateKey = date.toISODate()!, items = workByDay.get(dateKey) ?? [], isSelected = day === dateKey
        return <button key={dateKey} type="button" className={`calendar-day${date.month !== selected.month ? ' outside-month' : ''}`} aria-label={`${date.toLocaleString(DateTime.DATE_FULL)}${agenda ? `, ${items.length} scheduled ${items.length === 1 ? 'item' : 'items'}` : ''}`} aria-current={dateKey === today ? 'date' : undefined} aria-pressed={isSelected} onClick={() => setDay(dateKey)}>
          {view === 'week' && <span className="calendar-weekday">{date.toFormat('ccc')}</span>}<strong>{date.day}</strong>
          <span className="calendar-day-count" aria-hidden="true">{items.length ? <><i />{items.length}<span className="calendar-count-word"> scheduled</span></> : <i className="calendar-empty-dot" />}</span>
        </button>
      })}
    </div>
    {loading && !agenda && <p role="status" className="calendar-status">Loading your schedule…</p>}
    {error && <p role="alert" className="form-message error-text">{error} <button className="text-button" onClick={() => setVersion(value => value + 1)}>Retry</button></p>}
    {agenda && <div className="calendar-agenda" aria-busy={loading}>
      <div className="calendar-agenda-date"><strong>{selected.toFormat('cccc, MMMM d')}</strong><span>{zone.replaceAll('_',' ')} · {selected.offsetNameShort}</span></div>
      <div className="calendar-agenda-columns">
        <div><div className="calendar-list-heading"><h3>Scheduled work</h3><span>{work.length}</span></div>
          {!work.length ? <p className="calendar-empty">No work scheduled for this day.</p> : <ul className="calendar-work-list">{(showAllWork ? work : work.slice(0,3)).map(item => <li key={item.source_key}>
            <a className={`calendar-event ${item.document_kind}`} href={`/?view=${item.document_kind === 'invoice' ? 'invoices' : item.document_kind === 'estimate' ? 'estimates' : 'work'}&document=${encodeURIComponent(item.document_id)}`}>
              <time>{DateTime.fromISO(item.starts_at).setZone(zone).toFormat('h:mm a')}</time><span><strong>{item.title}</strong><small>{DateTime.fromISO(item.starts_at).setZone(zone).toISODate() !== day ? `Started ${DateTime.fromISO(item.starts_at).setZone(zone).toFormat('MMM d')} · ` : ''}{item.status.replaceAll('_',' ')}{item.ends_at ? ` · Until ${DateTime.fromISO(item.ends_at).setZone(zone).toFormat('MMM d, h:mm a')}` : ''}</small>{item.assigned_user_ids?.length?<small>Assigned: {item.assigned_user_ids.map(id=>team.find(person=>person.id===id)?.label || 'Team member').join(', ')}</small>:null}</span><span aria-hidden="true">↗</span>
            </a>
          </li>)}</ul>}
          {work.length > 3 && <button className="text-button calendar-show-more" aria-expanded={showAllWork} onClick={() => setShowAllWork(value => !value)}>{showAllWork ? 'Show fewer scheduled items' : `Show all ${work.length} scheduled items`}</button>}
        </div>
        <div><div className="calendar-list-heading"><h3>To do</h3><span>{reminders.length}</span></div>
          {!reminders.length ? <p className="calendar-empty">No pending reminders due by this day.</p> : <ul className="calendar-reminders">{(showAllReminders ? reminders : reminders.slice(0,3)).map(item => <li key={item.id}><div><strong>{item.note || 'Follow up'}</strong><span>{DateTime.fromISO(item.due_at).toMillis() < Date.now() ? 'Overdue · ' : ''}{DateTime.fromISO(item.due_at).setZone(zone).toFormat('MMM d, h:mm a')}</span></div>{business.role !== 'viewer' && <button className="calendar-done" disabled={busy !== null} onClick={() => void complete(item.id)} aria-label={`Complete ${item.note || 'reminder'}`}>{busy === item.id ? '…' : '✓'}</button>}</li>)}</ul>}
          {reminders.length > 3 && <button className="text-button calendar-show-more" aria-expanded={showAllReminders} onClick={() => setShowAllReminders(value => !value)}>{showAllReminders ? 'Show fewer reminders' : `Show all ${reminders.length} reminders`}</button>}
        </div>
      </div>
    </div>}
  </section>
}
