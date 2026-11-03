import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { readableError } from '../lib/errors'
import { changeWorkReminder, getWorkReminder, type WorkReminder } from '../services/reminders'
import FormDialog from './FormDialog'
import './reminders.css'

export default function ReminderDetailsDialog({ business, reminderId, onClose, onSaved }: {
  business: CurrentBusiness; reminderId: string; onClose: () => void; onSaved?: () => void
}) {
  const zone = business.timezone || 'America/New_York'
  const [record, setRecord] = useState<WorkReminder | null>(null)
  const [note, setNote] = useState(''), [due, setDue] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false)
  const [reload, setReload] = useState(0)
  const saving = useRef(false)
  const writable = canWrite(business.role) && record?.status !== 'canceled'
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setRecord(null); setConfirmDelete(false)
    void getWorkReminder(business.id, reminderId).then(row => {
      if (!active) return
      setRecord(row); setNote(row.note || ''); setDue(DateTime.fromISO(row.due_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"))
    }).catch(e => { if (active) setError(readableError(e, 'Unable to open this reminder.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id, reminderId, zone, reload])

  async function apply(action: 'save' | 'complete' | 'reopen' | 'delete') {
    if (saving.current || !record || !writable) return
    saving.current = true; setBusy(true); setError('')
    try {
      const changes: { note?: string; dueAt?: string; status?: WorkReminder['status'] } = {}
      if (action === 'delete') changes.status = 'canceled'
      else {
        const time = DateTime.fromISO(due, { zone })
        const original = DateTime.fromISO(record.due_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
        // Preserve seconds/offset for an unchanged historical time, including a DST overlap.
        if (due !== original && (!time.isValid || time.toFormat("yyyy-MM-dd'T'HH:mm") !== due || time.getPossibleOffsets().length > 1)) {
          throw new Error('Choose an unambiguous valid date and time in your business timezone.')
        }
        changes.note = note; changes.dueAt = due === original ? record.due_at : time.toUTC().toISO()!
        if (action === 'complete') changes.status = 'completed'
        if (action === 'reopen') changes.status = 'pending'
      }
      await changeWorkReminder(business, record, changes)
      onSaved?.(); onClose()
    } catch (e) { setError(readableError(e, 'The change could not be confirmed. Your edits are still here; try again.')) }
    finally { saving.current = false; setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void apply('save') }
  return <FormDialog label="Manage reminder" busy={busy} onClose={onClose}>
    <div className="modal-head"><div><p className="eyebrow">{record?.status === 'completed' ? 'Completed reminder' : 'Reminder'}</p><h2>Manage reminder</h2></div><button type="button" className="icon-button" aria-label="Close reminder" onClick={onClose}>×</button></div>
    {loading ? <p role="status">Loading reminder…</p> : <>
      {record?.status === 'canceled' ? <p role="status">This reminder has been deleted.</p> : record && <form className="form-grid reminder-details-form" onSubmit={submit}>
        <label className="full">What needs to be done?<textarea required maxLength={2000} rows={4} disabled={!writable} value={note} onChange={e => setNote(e.target.value)} /></label>
        <label className="full">Remind me on<input type="datetime-local" required disabled={!writable || record.status === 'completed'} value={due} onChange={e => setDue(e.target.value)} /></label>
        <p className="quiet full">Times use {zone.replaceAll('_', ' ')}.{record.status === 'completed' ? ' Reopen this reminder to reschedule it. An overdue reminder will return to Needs Attention.' : ' Rescheduling moves this reminder to its new date and updates Needs Attention.'}</p>
        {record.jobs[0]?.title && <p className="quiet full">Related job: {record.jobs[0].title}</p>}
        {!writable && <p className="quiet full">You have read-only access to this reminder.</p>}
        {writable && !confirmDelete && <div className="reminder-detail-actions full">
          <button type="button" className="primary-button" onClick={() => void apply(record.status === 'completed' ? 'reopen' : 'complete')}>{record.status === 'completed' ? 'Reopen reminder' : 'Mark complete'}</button>
          <button className="primary-button">Save changes</button>
        </div>}
      </form>}
      {writable && record && <div className="reminder-delete-area">
        {confirmDelete ? <div role="group" aria-label="Confirm reminder deletion"><strong>Delete this reminder?</strong><p>It will be removed from the calendar and Needs Attention.</p><div className="reminder-detail-actions"><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep reminder</button><button type="button" className="reminder-delete-button" onClick={() => void apply('delete')}>Delete reminder</button></div></div> : <button type="button" className="reminder-delete-button" onClick={() => setConfirmDelete(true)}>Delete reminder</button>}
      </div>}
    </>}
    {error && <div role="alert" className="form-message error-text">{error} <button type="button" className="text-button" onClick={() => setReload(n => n + 1)}>Reload reminder</button></div>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Back</button></div>
  </FormDialog>
}
