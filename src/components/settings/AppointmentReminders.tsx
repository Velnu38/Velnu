import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { VelnuTier } from '../../lib/pricing'

type ReminderState = { enabled: boolean; ready: boolean }

export default function AppointmentReminders({ businessId, plan }: { businessId: string; plan: VelnuTier }) {
  const [state, setState] = useState<ReminderState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void supabase.rpc('get_appointment_reminders', { p_business: businessId }).then(({ data, error }) => {
      if (!active) return
      if (error || typeof data?.enabled !== 'boolean') setError(error?.message || 'Unable to check appointment reminders.')
      else setState(data)
    })
    return () => { active = false }
  }, [businessId, plan])

  async function toggle(enabled: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error } = await supabase.rpc('set_appointment_reminders', { p_business: businessId, p_enabled: enabled })
      if (error) throw error
      setState(data)
      setNotice(enabled ? 'Appointment email reminders enabled.' : 'Appointment email reminders turned off.')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (plan !== 'pro' && !state?.enabled) return null
  return <section className="settings-panel">
    <h3>Customer appointment reminders</h3>
    <p>Email customers about 24 hours before a scheduled job. Finviant uses the email saved on the customer record and counts each reminder toward your Business Pro allowance.</p>
    {state && <>
      {(plan !== 'pro' || !state.ready) && <p className="quiet">{state.enabled ? 'Appointment email reminders are paused. ' : ''}Business Pro and activated Finviant email are required.</p>}
      <button type="button" className="secondary-button" disabled={busy || (!state.enabled && (plan !== 'pro' || !state.ready))}
        onClick={() => void toggle(!state.enabled)}>{state.enabled ? 'Turn off appointment reminders' : 'Enable appointment reminders'}</button>
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
