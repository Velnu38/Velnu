import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../../lib/business'
import { localInstant } from '../../lib/calendarTime'
import { useTierUsage } from '../../lib/useTierUsage'
import { canAccess,isPrimaryOwner } from '../../lib/workspaceAccess'
import { assignJobCrew, getSchedulingContext, saveJobAppointment, type SchedulingContext } from '../../services/schedulingWorkflow'
import FormDialog from '../FormDialog'
import PlanRestriction from '../PlanRestriction'
import './scheduling.css'

type Work = {
  id: string
  title: string
  assigned_user_ids?: string[]
  scheduled_start: string | null
  scheduled_end?: string | null
}
export type JobScheduleMode = 'appointment' | 'crew'

export default function DispatchJobDialog({ business, job, mode = 'appointment', initialDay, needsAppointmentRepair = false, onClose, onSaved, onReschedule }: {
  business: CurrentBusiness
  job: Work
  mode?: JobScheduleMode
  initialDay?: string
  needsAppointmentRepair?: boolean
  onClose: () => void
  onSaved: (noticeId?:string|null) => void
  onReschedule?: () => void
}) {
  const saving = useRef(false)
  const zone = business.timezone || 'America/New_York'
  const usage = useTierUsage(business.id)
  const plan = usage?.plan
  const bookingLimit = !job.scheduled_start && usage?.plan === 'free' && usage.jobs_limit !== null && usage.jobs_used >= usage.jobs_limit
  const crewOnly = mode === 'crew'
  const lockedCrew = crewOnly && plan !== 'pro' && plan !== 'basic'
  const title = crewOnly ? 'Assign crew' : job.scheduled_start && !needsAppointmentRepair ? 'Reschedule appointment' : 'Schedule job'
  const [context, setContext] = useState<SchedulingContext | null>(null)
  const [selectedWorkers, setWorkers] = useState(job.assigned_user_ids ?? [])
  const [error, setError] = useState('')
  const [canResolveWithTime, setCanResolveWithTime] = useState(false)
  const [busy, setBusy] = useState(false)
  const [useMySchedule, setUseMySchedule] = useState(false)
  const formatInput = (time?: string | null) => time ? DateTime.fromISO(time).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm") : ''
  const originalStart = formatInput(job.scheduled_start)
  const originalEnd = formatInput(job.scheduled_end)
  const selectedDay = initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : null
  const proposedStart = selectedDay ? selectedDay + 'T' + (originalStart.split('T')[1] || '09:00') : originalStart
  const [start, setStart] = useState(proposedStart)
  const [end, setEnd] = useState(selectedDay ? '' : originalEnd)

  useEffect(() => {
    let active = true
    void getSchedulingContext(business.id).then(value => {
      if (!active) return
      setContext(value)
      if (selectedDay) {
        setEnd(current => current || DateTime.fromISO(proposedStart, { zone }).plus({ minutes: value.preferences.duration_minutes }).toFormat("yyyy-MM-dd'T'HH:mm"))
      } else if (job.scheduled_start && !job.scheduled_end) {
        setEnd(DateTime.fromISO(job.scheduled_start).setZone(zone)
          .plus({ minutes: value.preferences.duration_minutes }).toFormat("yyyy-MM-dd'T'HH:mm"))
      }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [business.id, job.id, job.scheduled_start, job.scheduled_end, selectedDay, proposedStart, zone])

  const currentWorkers = job.assigned_user_ids ?? []
  const crewChanged = selectedWorkers.length !== currentWorkers.length || selectedWorkers.some(id => !currentWorkers.includes(id))
  const myId = context?.team.find(worker => worker.is_you)?.id
  const mustReassign = plan === 'free' && currentWorkers.some(id => id !== myId)
  const hasChanged = crewOnly ? selectedWorkers.length > 0 && crewChanged : !!start && !!end && (needsAppointmentRepair || start !== originalStart || end !== originalEnd)
  const canSave = !!plan && !!context && hasChanged && !lockedCrew &&
    (crewOnly || (!bookingLimit && (!mustReassign || useMySchedule)))

  function toggleWorker(id: string, checked: boolean) {
    setWorkers(workers => checked ? [...workers, id] : workers.filter(worker => worker !== id))
    setError('')
    setCanResolveWithTime(false)
  }

  async function save() {
    if (saving.current || !canSave) return
    saving.current = true
    setBusy(true)
    setError('')
    setCanResolveWithTime(false)
    try {
      let noticeId:string|null=null
      if (crewOnly) {
        await assignJobCrew(job, selectedWorkers)
      } else {
        noticeId=await saveJobAppointment(job, start === originalStart && job.scheduled_start ? job.scheduled_start : localInstant(start, zone),
          end === originalEnd && job.scheduled_end ? job.scheduled_end : localInstant(end, zone), useMySchedule,
          plan==='pro'&&canAccess(business,'billing')&&['owner','admin','office'].includes(business.role)?business.id:undefined)
      }
      onSaved(noticeId)
      onClose()
    } catch (e) {
      const code = e instanceof Error && 'code' in e ? e.code : undefined
      if (code === '23P01') {
        setError(crewOnly
          ? 'The selected crew is unavailable at this appointment time. Choose another crew or reschedule the appointment.'
          : 'This appointment time conflicts with the work schedule. Choose a different time.')
        setCanResolveWithTime(crewOnly)
      } else {
        setError(e instanceof Error ? e.message : 'Unable to save this change.')
        setCanResolveWithTime(crewOnly && code === '23514' && !!job.scheduled_start && !job.scheduled_end)
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <FormDialog label={title} busy={busy} onClose={onClose} wide>
    <header className="guided-dialog-head">
      <div><p className="eyebrow">{job.title}</p><h2>{title}</h2></div>
      <button type="button" className="calendar-arrow" aria-label={`Close ${title.toLowerCase()}`} disabled={busy} onClick={onClose}>×</button>
    </header>
    {bookingLimit && !crewOnly && <PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
    {plan === 'free' && crewOnly && <PlanRestriction plan={plan} required="basic" feature="Crew assignment" canUpgrade={isPrimaryOwner(business)}/>}
    {!context && !error && <p role="status">Loading scheduling options…</p>}
    {crewOnly ? !lockedCrew && <>
      <p className="quiet">{job.scheduled_start
        ? `Appointment: ${DateTime.fromISO(job.scheduled_start).setZone(zone).toFormat('EEE, MMM d · h:mm a ZZZZ')}. The time stays the same and the customer receives no message.`
        : 'Assign the crew now and book the customer’s appointment separately.'}</p>
      {context && <fieldset className="guided-workers">
        <legend>Who will do the work?</legend>
        {context.team.map(worker => <label key={worker.id}>
          <input type="checkbox" checked={selectedWorkers.includes(worker.id)}
            onChange={event => toggleWorker(worker.id, event.target.checked)}/>
          {worker.label}{worker.is_you ? ' (you)' : ''}
        </label>)}
        {selectedWorkers.some(id => !context.team.some(worker => worker.id === id)) && <button type="button" className="text-button"
          onClick={() => setWorkers(workers => workers.filter(id => context.team.some(worker => worker.id === id)))}>
          Remove unavailable crew members
        </button>}
      </fieldset>}
    </> : <>
      <p className="quiet">Times use {zone.replaceAll('_', ' ')}. {mustReassign ? 'Moving this job to your schedule changes its crew.' : 'The current crew stays assigned.'} Confirm the time with your customer. Saving does not send a change notice. Eligible rescheduled visits open a customer email for review afterward.</p>
      {mustReassign && <label className="guided-approval">
        <input type="checkbox" checked={useMySchedule} onChange={event => setUseMySchedule(event.target.checked)}/>
        <span>Move this job to my schedule. The current crew assignment isn’t available on this plan.</span>
      </label>}
      <div className="guided-form-grid">
        <label>Start<input type="datetime-local" value={start} disabled={bookingLimit} onChange={event => {
          const value = event.target.value
          const duration = start && end ? DateTime.fromISO(end, { zone }).diff(DateTime.fromISO(start, { zone }), 'minutes').minutes : 0
          setStart(value)
          if (value) setEnd(DateTime.fromISO(value, { zone }).plus({ minutes: duration > 0 ? duration : context?.preferences.duration_minutes ?? 120 }).toFormat("yyyy-MM-dd'T'HH:mm"))
        }}/></label>
        <label>End<input type="datetime-local" value={end} disabled={bookingLimit} onChange={event => setEnd(event.target.value)}/></label>
      </div>
    </>}
    {error && <p role="alert" className="form-message error-text">{error}</p>}
    <div className="guided-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
      {canResolveWithTime && onReschedule && <button type="button" className="secondary-button" disabled={busy} onClick={onReschedule}>Reschedule appointment</button>}
      {!lockedCrew && <button type="button" className="primary-button" disabled={busy || !canSave} onClick={() => void save()}>
        {busy ? 'Saving…' : crewOnly ? 'Save crew' : job.scheduled_start && !needsAppointmentRepair ? 'Save new time' : 'Schedule job'}
      </button>}
    </div>
  </FormDialog>
}
