import {useBusinessRefresh} from '../../lib/useBusinessRefresh'
import ConnectedCalendarEvents from './ConnectedCalendarEvents'
import type { ConnectedAgenda } from '../../lib/calendarTypes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { lazy,Suspense } from 'react'
import { DateTime } from 'luxon'
import '../reminders.css'
import type { CurrentBusiness } from '../../lib/business'
import { calendarRange, workOnDay, remindersOnDay, connectedOnDay, type CalendarView } from '../../lib/calendarView'
import { loadCalendarRange, loadConnectedCalendarRange } from '../../services/calendar'
import { completeWorkReminder } from '../../services/reminders'
import { useTierUsage } from '../../lib/useTierUsage'
import { canAccess } from '../../lib/workspaceAccess'
import { updateJobStatus } from '../../services/jobs'
import { jobStatusConfirmation,jobStatusNotice,type JobStatus } from '../../lib/jobActions'
import { getScheduleTeam, type Worker } from '../../services/schedulingWorkflow'

const ReminderDetailsDialog=lazy(()=>import('../ReminderDetailsDialog'))
const JobDetailsDialog=lazy(()=>import('../JobDetailsDialog'))
const CalendarEntryDialog=lazy(()=>import('./CalendarEntryDialog'))
type Agenda = Awaited<ReturnType<typeof loadCalendarRange>>
export default function DailyCalendar({ business, refreshVersion = 0, showReminders = true, compact = false }: {
  business: CurrentBusiness; refreshVersion?: number; showReminders?: boolean; compact?: boolean
}) {
  const zone = business.timezone || 'America/New_York'
  const [today, setToday] = useState(() => DateTime.now().setZone(zone).toISODate()!)
  const [day, setDay] = useState(today)
  const [view, setView] = useState<CalendarView>('week')
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ key: string; agenda: Agenda } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const workFlight=useRef(false)
  const [workNotice,setWorkNotice]=useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [connectedResult, setConnectedResult] = useState<{key:string;agenda:ConnectedAgenda}|null>(null)
  const [connectedError, setConnectedError] = useState('')
  const [connectedLoading, setConnectedLoading] = useState(true)
  const plan = useTierUsage(business.id)?.plan
  const teamScheduling = plan === 'pro' || plan === 'basic'
  const [team,setTeam]=useState<Worker[]>([]),[worker,setWorker]=useState('all')
  useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(value=>{if(!active)return;setTeam(value);if(business.role==='technician')setWorker(value.find(item=>item.is_you)?.id || 'all')}).catch(()=>{});return()=>{active=false}},[business.id,business.role])
  const [entry,setEntry]=useState<{day:string;id?:string}|null>(null)
  const [jobId,setJobId]=useState<string|null>(null)
  const [reminderId,setReminderId]=useState<string|null>(null)
  const previousToday = useRef(today)
  function refreshCalendar() {
    if (document.hidden) return
    const next = DateTime.now().setZone(zone).toISODate()!
    const previous = previousToday.current
    previousToday.current = next
    setToday(next); setDay(value => value === previous ? next : value); setVersion(value => value + 1)
  }
  useBusinessRefresh(business.id,refreshCalendar)
  const selected = DateTime.fromISO(day, { zone })
  const range = calendarRange(day, zone, view)
  const from = range.start.toISODate()!, to = range.end.toISODate()!
  const key = [business.id, business.role, business.access_modules?.join(','), zone, from, to].join(':')
  const agenda = result?.key === key ? result.agenda : null
  const connected = connectedResult?.key === key ? connectedResult.agenda : null
  useEffect(() => {
    const timer = window.setInterval(refreshCalendar, 60000)
    // Focus, visibility and work invalidation are coalesced by useBusinessRefresh.
    // Registering them here too fetched connected-provider events twice per change.
    return () => { clearInterval(timer) }
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
  useEffect(() => {
    let active = true
    setConnectedLoading(true); setConnectedError('')
    void loadConnectedCalendarRange(business.id, from, to, zone).then(agenda => { if (active) setConnectedResult({key, agenda}) })
      .catch(error => { if (active) { setConnectedResult(null); setConnectedError(error.message || 'Unable to load connected calendar events.') } })
      .finally(() => { if (active) setConnectedLoading(false) })
    return () => { active = false }
  }, [key, business.id, from, to, zone, version, refreshVersion])
  const workByDay = useMemo(() => new Map(range.days.map(date => [date.toISODate()!, workOnDay((agenda?.work ?? []).filter(item=>!teamScheduling||worker==='all'||item.assigned_user_ids?.includes(worker)), date.toISODate()!, zone)])), [agenda, from, to, zone,worker,teamScheduling])
  const work = workByDay.get(day) ?? []
  const reminders = remindersOnDay(agenda?.reminders ?? [], day, zone)
  const connectedEvents = connectedOnDay(connected?.events ?? [], day, zone)
  async function complete(id: string) {
    if (busy) return
    setBusy(id)
    try { await completeWorkReminder(business, id); setVersion(value => value + 1) }
    catch { setError('Unable to complete this reminder. Try again.') }
    finally { setBusy(null) }
  }
  function workAction(item: Agenda['work'][number]): 'in_progress'|'completed'|null {
    if(!compact||!item.job_id||business.role==='viewer'||!canAccess(business,'jobs')||!['scheduled','confirmed','in_progress'].includes(item.status))return null
    if(item.job_status==='in_progress')return 'completed'
    return item.job_status==='scheduled'&&Date.parse(item.starts_at)<=Date.now()?'in_progress':null
  }
  async function changeWork(item: Agenda['work'][number],status: JobStatus){
    if(workFlight.current||!item.job_id)return
    const confirm=jobStatusConfirmation(status);if(confirm&&!window.confirm(confirm))return
    workFlight.current=true;setBusy(item.job_id);setError('');setWorkNotice('')
    try{const result=await updateJobStatus(item.job_id,status);setWorkNotice(jobStatusNotice(status,result));setVersion(value=>value+1)}
    catch(e){setError(e instanceof Error?e.message:'Unable to confirm the job status. Open the job to review it.')}
    finally{workFlight.current=false;setBusy(null)}
  }
  const reminderSection=(<div><div className="calendar-list-heading"><h3>Reminders for this day</h3><span>{reminders.length}</span></div>
          {!reminders.length ? <p className="calendar-empty">No reminders for this day.</p> : <ul className="calendar-reminders">{reminders.map(item => <li key={item.id} className={item.status === 'completed' ? 'completed' : undefined}><button type="button" className="reminder-open" aria-label={`Open reminder ${item.note || 'Follow up'}`} onClick={()=>setReminderId(item.id)}><strong>{item.note || 'Follow up'}</strong><span>{item.status === 'completed' ? 'Completed · ' : DateTime.fromISO(item.due_at).toMillis() < Date.now() ? 'Overdue · ' : ''}{DateTime.fromISO(item.due_at).setZone(zone).toFormat('MMM d, h:mm a')}</span><small>{business.role==='viewer'?'View reminder':'Edit reminder'} →</small></button>{business.role !== 'viewer' && item.status !== 'completed' && <button className="calendar-done" disabled={busy !== null} onClick={() => void complete(item.id)} aria-label={`Complete ${item.note || 'reminder'}`}>{busy === item.id ? '…' : 'Done'}</button>}</li>)}</ul>}
        </div>)
  const periodLabel = view === 'month' ? selected.toFormat('MMMM yyyy') : `${range.start.toFormat('MMM d')} – ${range.end.minus({ days: 1 }).toFormat('MMM d, yyyy')}`
  return <section className={`dashboard-calendar dashboard-tile calendar-no-print${compact?' home-calendar-compact':''}`} aria-label="Work calendar">
    <div className="calendar-heading">
      <div><p className="eyebrow">Your schedule</p><h2 className="dashboard-tile-title">{view === 'week' ? 'Weekly Schedule' : 'Monthly calendar'}</h2></div>
      <div className="calendar-heading-actions"><div className="view-switch" role="group" aria-label="Calendar view">{(['week','month'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'week' ? 'Week' : 'Month'}</button>)}</div>{business.role!=='viewer'&&<button type="button" className="calendar-add" onClick={()=>setEntry({day})}>{compact?'Add to calendar':'+ Add entry'}</button>}</div>
    </div>
    {teamScheduling&&team.length>(compact?1:0)&&<label className="worker-select">Scheduled work for<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="all">Everyone</option>{team.map(item=><option value={item.id} key={item.id}>{item.is_you?'My schedule · ':''}{item.label}</option>)}</select><small>Shared reminders and connected personal events are shown separately.</small></label>}
    <div className="calendar-period-nav">
      <div className="calendar-period-title"><button className="calendar-arrow" aria-label={`Previous ${view}`} onClick={() => setDay(selected.minus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)}>‹</button><strong aria-live="polite">{periodLabel}</strong><button className="calendar-arrow" aria-label={`Next ${view}`} onClick={() => setDay(selected.plus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)}>›</button>{compact&&<button type="button" className="text-button" onClick={()=>setDay(today)}>Today</button>}</div>
    </div>
    <div className={`calendar-grid ${view}`} role="group" aria-label={view === 'month' ? 'Choose a day in the month' : 'Choose a day in the week'}>
      {view === 'month' && ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(label => <span className="calendar-weekday" key={label}>{label}</span>)}
      {range.days.map(date => {
        const dateKey = date.toISODate()!, items = workByDay.get(dateKey) ?? [], isSelected = day === dateKey
        const reminderCount = showReminders ? remindersOnDay(agenda?.reminders ?? [], dateKey, zone).length : 0
        const eventCount = connectedOnDay(connected?.events ?? [], dateKey, zone).length
        const total = items.length + reminderCount + eventCount
        return <button key={dateKey} type="button" className={`calendar-day${date.month !== selected.month ? ' outside-month' : ''}`} aria-label={`${date.toLocaleString(DateTime.DATE_FULL)}${agenda ? `, ${items.length} scheduled ${items.length === 1 ? 'item' : 'items'}, ${reminderCount} reminders, ${eventCount} connected events` : ''}`} aria-current={dateKey === today ? 'date' : undefined} aria-pressed={isSelected} onClick={() => setDay(dateKey)}>
          {view === 'week' && <span className="calendar-weekday">{date.toFormat('ccc')}</span>}<strong>{date.day}</strong>
          <span className="calendar-day-count" aria-hidden="true">{total ? <><i />{total}<span className="calendar-count-word"> {total === 1 ? 'item' : 'items'}</span></> : <i className="calendar-empty-dot" />}</span>
        </button>
      })}
    </div>
    {loading && !agenda && <p role="status" className="calendar-status">Loading your schedule…</p>}
    {error && <p role="alert" className="form-message error-text">{error} <button className="text-button" onClick={() => setVersion(value => value + 1)}>Retry</button></p>}
    {workNotice&&<p role="status" className="home-work-notice">{workNotice}</p>}
    {agenda && <div className="calendar-agenda" aria-busy={loading}>
      <div className="calendar-agenda-date"><strong aria-live="polite">{selected.toFormat('cccc, MMMM d')}</strong><span>{zone.replaceAll('_',' ')} · {selected.offsetNameShort}</span></div>
      <div className="calendar-agenda-columns">
        <div><div className="calendar-list-heading"><h3>Scheduled work</h3><span>{work.length}</span></div>
          {!work.length ? <p className="calendar-empty">No work scheduled for this day.</p> : <ul className="calendar-work-list">{work.map(item => <li key={item.source_key} className={compact?'home-agenda-row':undefined}>
            <a onClick={event=>{if(item.job_id){event.preventDefault();setJobId(item.job_id);return}if(item.source_key.startsWith('appointment:')&&!item.job_id&&item.document_kind==='work'){event.preventDefault();setEntry({day,id:item.source_key.slice(12)})}}} className={`calendar-event ${item.document_kind}`} href={`/?view=${item.document_kind === 'invoice' ? 'invoices' : item.document_kind === 'estimate' ? 'estimates' : 'work'}&document=${encodeURIComponent(item.document_id)}`}>
              <time>{DateTime.fromISO(item.starts_at).setZone(zone).toFormat('h:mm a')}</time><span><strong>{item.title}</strong><small>{DateTime.fromISO(item.starts_at).setZone(zone).toISODate() !== day ? `Started ${DateTime.fromISO(item.starts_at).setZone(zone).toFormat('MMM d')} · ` : ''}{item.status.replaceAll('_',' ')}{item.ends_at ? ` · Until ${DateTime.fromISO(item.ends_at).setZone(zone).toFormat('MMM d, h:mm a')}` : ''}</small>{item.customer_name && <small>{item.customer_name}</small>}{item.address && <small className="calendar-address">{item.address}</small>}{item.description && <small className="calendar-description">{item.description}</small>}{item.assigned_user_ids?.length?<small>Assigned: {item.assigned_user_ids.map(id=>team.find(person=>person.id===id)?.label || 'Team member').join(', ')}</small>:null}</span><span aria-hidden="true">↗</span>
            </a>
            {compact&&item.job_id&&(workAction(item)?<button type="button" className="primary-button compact" disabled={busy!==null} onClick={()=>void changeWork(item,workAction(item)!)}>{busy===item.job_id?'Updating…':workAction(item)==='completed'?'Mark complete':'Start job'}</button>:<button type="button" className="secondary-button compact" onClick={()=>setJobId(item.job_id!)}>Open job</button>)}
          </li>)}</ul>}
        </div>
        {!compact&&showReminders&&reminderSection}
      </div>
      {agenda.detailsUnavailable && <p role="status">Some job details could not be loaded. Open a job to try again.</p>}
    </div>}
    {compact?<div className="home-calendar-extras">
      {showReminders&&<details open={reminders.length>0}><summary>Reminders <span>{agenda?reminders.length:'—'}</span></summary>{reminderSection}</details>}
      <details open={!!connectedError||!!connected?.issues.length||connectedEvents.length>0}><summary>Connected calendars <span>{connectedLoading&&!connected?'—':connectedEvents.length}</span></summary>    <ConnectedCalendarEvents events={connectedEvents} issues={connected?.issues ?? []} connections={connected?.connections ?? 0} loading={connectedLoading && !connected} error={connectedError} zone={zone} onRetry={()=>setVersion(value=>value+1)}/></details>
      {!connectedLoading&&!connectedError&&!connected?.connections&&<a href="/?view=settings&section=calendar">Connect a calendar</a>}
    </div>:<ConnectedCalendarEvents events={connectedEvents} issues={connected?.issues ?? []} connections={connected?.connections ?? 0} loading={connectedLoading && !connected} error={connectedError} zone={zone} onRetry={()=>setVersion(value=>value+1)}/>}
    {reminderId&&<Suspense fallback={<p role="status">Opening reminder…</p>}><ReminderDetailsDialog key={business.id+reminderId} business={business} reminderId={reminderId} onClose={()=>setReminderId(null)}/></Suspense>}
    {jobId&&<Suspense fallback={<p role="status">Opening job…</p>}><JobDetailsDialog business={business} jobId={jobId} onClose={()=>setJobId(null)}/></Suspense>}
    {entry&&<Suspense fallback={<p role="status">Opening calendar entry…</p>}><CalendarEntryDialog business={business} day={entry.day} entryId={entry.id} onClose={()=>setEntry(null)} onSaved={()=>setVersion(v=>v+1)}/></Suspense>}
  </section>
}
