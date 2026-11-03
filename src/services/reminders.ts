import { supabase } from '../lib/supabase'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { asList } from './relations'
import { announceCalendarChange } from './calendar'

export type ReminderJob = { id: string; title: string; customer_id: string | null }
export type WorkReminder = {
  id: string; business_id: string; kind: string; due_at: string; note: string | null
  status: 'pending' | 'completed' | 'canceled'; job_id: string | null; customer_id: string | null
  jobs: Array<{ title: string }>
}
type ReminderInput = { id: string; note: string; dueAt: string; jobId?: string; customerId?: string | null }
type Workspace = Pick<CurrentBusiness, 'id' | 'role'>
const fields = 'id,business_id,kind,due_at,note,status,job_id,customer_id,jobs!reminders_job_id_fkey(title)'
export const REMINDER_PAGE_SIZE = 50

export async function listReminders(businessId: string, status: 'pending' | 'completed', offset = 0) {
  const { data, error, count } = await supabase.from('reminders').select(fields, { count: 'exact' })
    .eq('business_id', businessId).eq('status', status)
    .order('due_at', { ascending: status === 'pending' }).order('id', { ascending: true })
    .range(offset, offset + REMINDER_PAGE_SIZE - 1)
  if (error) throw error
  if (count === null) throw new Error('Unable to load the reminder count. Refresh and try again.')
  return { rows: (data ?? []).map(row => ({ ...row, jobs: asList(row.jobs) })) as WorkReminder[], total: count }
}

export async function createReminder(business: Workspace, input: ReminderInput) {
  if (!canWrite(business.role)) throw new Error('Your role cannot create reminders.')
  const note = input.note.trim(), due = new Date(input.dueAt)
  if (!note || note.length > 2000) throw new Error('Enter a reminder between 1 and 2,000 characters.')
  if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) throw new Error('Choose a future reminder date and time.')
  const payload = {
    id: input.id, business_id: business.id, note, due_at: due.toISOString(),
    kind: input.jobId ? 'job_follow_up' : 'general', job_id: input.jobId || null,
    customer_id: input.jobId ? input.customerId || null : null, status: 'pending',
  }
  const { data, error } = await supabase.from('reminders').insert(payload).select('id').single()
  if (!error) {
    if (data?.id !== input.id) throw new Error('Unable to verify the saved reminder. Try again.')
    announceCalendarChange()
    return data.id
  }
  // Reuse the same ID after an uncertain network result; never overwrite a reminder.
  if (error.code !== '23505') throw error
  const previous = await supabase.from('reminders').select('id,business_id,note,due_at,kind,job_id,customer_id')
    .eq('business_id', business.id).eq('id', input.id).maybeSingle()
  if (previous.error) throw previous.error
  if (!previous.data) throw new Error('Unable to verify the saved reminder. Try again.')
  const saved = previous.data
  if (saved.note !== payload.note || new Date(saved.due_at).getTime() !== due.getTime()
    || saved.kind !== payload.kind || saved.job_id !== payload.job_id || saved.customer_id !== payload.customer_id) {
    throw new Error('This reminder was already saved with different details. Start a new reminder.')
  }
  announceCalendarChange()
  return saved.id
}

export async function completeWorkReminder(business: Workspace, id: string) {
  if (!canWrite(business.role)) throw new Error('Your role cannot complete reminders.')
  const { error } = await supabase.from('reminders')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('business_id', business.id).eq('id', id).eq('status', 'pending').select('id').single()
  if (error) throw error
  announceCalendarChange()
}

export async function getWorkReminder(businessId: string, id: string): Promise<WorkReminder> {
  const { data, error } = await supabase.from('reminders').select(fields)
    .eq('business_id', businessId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This reminder is unavailable. It may have been removed or your access changed.')
  return { ...data, jobs: asList(data.jobs) } as WorkReminder
}

/** Compare the reviewed values before writing so another worker's changes are not overwritten. */
export async function changeWorkReminder(business: Workspace, previous: WorkReminder, input: {
  note?: string; dueAt?: string; status?: WorkReminder['status']
}) {
  if (!canWrite(business.role) || previous.business_id !== business.id) throw new Error('Your role cannot manage this reminder.')
  if (previous.status === 'canceled') throw new Error('This reminder has been deleted. Refresh the calendar.')
  const note = input.note === undefined ? previous.note : input.note.trim()
  const due = new Date(input.dueAt ?? previous.due_at)
  const status = input.status ?? previous.status
  if (input.note !== undefined && (!note || note.length > 2000)) throw new Error('Enter a reminder between 1 and 2,000 characters.')
  if (!Number.isFinite(due.getTime())) throw new Error('Choose a valid reminder date and time.')
  const rescheduled = due.getTime() !== new Date(previous.due_at).getTime()
  if (rescheduled && due.getTime() <= Date.now()) throw new Error('Choose a future date and time when rescheduling.')
  if (rescheduled && previous.status === 'completed') throw new Error('Reopen this reminder before changing its due time.')
  const patch = { note, due_at: due.toISOString(), status,
    ...(status !== previous.status && status !== 'canceled' ? { completed_at: status === 'completed' ? new Date().toISOString() : null } : {}) }
  let query = supabase.from('reminders').update(patch).eq('business_id', business.id).eq('id', previous.id)
    .eq('status', previous.status).eq('due_at', previous.due_at)
  query = previous.note === null ? query.is('note', null) : query.eq('note', previous.note)
  const { data, error } = await query.select('id').maybeSingle()
  if (!error && data?.id === previous.id) { announceCalendarChange(); return }
  // Also confirms a retry after the server saved successfully but its response was lost.
  const saved = await getWorkReminder(business.id, previous.id)
  if (saved.note === note && saved.status === status && new Date(saved.due_at).getTime() === due.getTime()) {
    announceCalendarChange(); return
  }
  if (error) throw error
  throw new Error('This reminder changed elsewhere. Reload it before saving your changes.')
}
