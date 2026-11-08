import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { businessLogoUrl } from '../lib/business'
import { customerBooking, type BookingView, type Slot } from '../services/schedulingWorkflow'
import { appointmentIcs } from '../lib/calendarDownload'
import '../components/scheduling/scheduling.css'

function validSlot(slot: Slot) {
  return Number.isFinite(Date.parse(slot.starts_at)) && Number.isFinite(Date.parse(slot.ends_at)) && Date.parse(slot.ends_at) > Date.parse(slot.starts_at)
}
function conflict(error: unknown) {
  return error instanceof Error && /no longer available|slot.*(?:unavailable|taken|conflict)|time.*(?:taken|unavailable)|already reserved|schedule.*conflict/i.test(error.message)
}

export default function CustomerBookingPage({ token }: { token: string }) {
  const [data, setData] = useState<BookingView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [slot, setSlot] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [localTimes, setLocalTimes] = useState(false)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const sending = useRef(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  const selected = useRef('')
  selected.current = slot
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [])
  const businessZone = data && DateTime.now().setZone(data.timezone).isValid ? data.timezone : 'UTC'
  const displayZone = localTimes ? deviceZone : businessZone

  const load = useCallback(async (silent = false) => {
    if (sending.current) return
    const current = ++generation.current
    if (!silent) setRefreshing(true)
    try {
      const next = await customerBooking(token)
      if (!mounted.current || current !== generation.current || sending.current) return
      setData(next)
      const available = next.slots.filter(item => validSlot(item) && Date.parse(item.starts_at) > Date.now())
      if (selected.current && next.status === 'approved' && !available.some(item => item.id === selected.current)) {
        setSlot(''); setNotice('That time is no longer available. Please choose another appointment.')
      }
      if (next.status !== 'approved') { setSlot(''); setNotice('') }
      if (!silent || next.status === 'booked') setError('')
    } catch (failure) {
      if (mounted.current && current === generation.current) setError(failure instanceof Error ? failure.message : 'Appointment times could not be loaded. Please try again.')
    } finally { if (mounted.current && current === generation.current) setRefreshing(false) }
  }, [token])

  useEffect(() => {
    mounted.current = true; sending.current = false; setBusy(false); setData(null); setSlot(''); setError(''); setNotice(''); setName('')
    void load()
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, 20000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { mounted.current = false; generation.current++; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [load])

  async function confirm() {
    if (sending.current || !slot || name.trim().length < 2 || refreshing) return
    sending.current = true; const current = ++generation.current
    setBusy(true); setError(''); setNotice('')
    let reconcile = false
    try {
      const booked = await customerBooking(token, slot, name.trim())
      if (!mounted.current || current !== generation.current) return
      if (booked.status !== 'booked' || !booked.confirmed || !validSlot(booked.confirmed)) throw new Error('Confirmation is not verified yet. Refresh the appointment status before choosing another time.')
      setData(booked); setSlot('')
      setNotice('Your appointment is confirmed and has been saved with the business.')
    } catch (failure) {
      if (!mounted.current || current !== generation.current) return
      if (conflict(failure)) {
        setSlot(''); setError('That appointment was just taken. We’re refreshing the available times so you can choose another.')
      } else setError(failure instanceof Error ? failure.message : 'Your confirmation could not be verified. Refresh status or retry this same appointment.')
      reconcile = true
    } finally {
      if (current === generation.current) { sending.current = false; if (mounted.current) setBusy(false) }
    }
    if (reconcile && mounted.current && current === generation.current) await load(true)
  }

  function formatted(item: Slot, zone = displayZone) {
    const start = DateTime.fromISO(item.starts_at).setZone(zone), end = DateTime.fromISO(item.ends_at).setZone(zone)
    return `${start.toFormat('cccc, MMMM d, yyyy')} · ${start.toFormat('h:mm a')}–${end.toFormat(start.toISODate() === end.toISODate() ? 'h:mm a' : 'ccc, MMM d h:mm a')} ${start.toFormat('ZZZZ')}`
  }
  async function download() {
    if (!data?.confirmed || calendarBusy) return
    setCalendarBusy(true)
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      const calendarId = 'booking-' + Array.from(new Uint8Array(hash).slice(0, 16), value => value.toString(16).padStart(2, '0')).join('')
      const text = appointmentIcs({ id: calendarId, title: `${data.business_name}: ${data.title}`, start: data.confirmed.starts_at, end: data.confirmed.ends_at, address: data.address })
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })), link = document.createElement('a')
      link.href = url; link.download = 'Finviant-appointment.ics'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError('The calendar file could not be prepared. Your appointment is still confirmed; try downloading again.') }
    finally { setCalendarBusy(false) }
  }

  const available = data?.slots.filter(item => validSlot(item) && Date.parse(item.starts_at) > Date.now()) || []
  const groups = new Map<string, typeof available>()
  for (const item of available) {
    const day = DateTime.fromISO(item.starts_at).setZone(displayZone).toISODate() || item.starts_at
    groups.set(day, [...(groups.get(day) || []), item])
  }
  const picked = available.find(item => item.id === slot)
  const appointmentCanceled = data?.status === 'canceled' || data?.confirmed?.status === 'canceled'
  const appointmentComplete = data?.confirmed?.status === 'completed'
  const booked = !appointmentCanceled && data?.status === 'booked' && data.confirmed && validSlot(data.confirmed)
  const expired = data?.status === 'expired' || data?.status === 'approved' && Date.parse(data.expires_at) <= Date.now()
  const active = data?.status === 'approved' && data.can_book !== false && !expired
  const terminal = appointmentCanceled || data?.can_book === false && !booked || data?.status === 'paused' || data?.status === 'replaced' || data?.status === 'revoked' || data?.status === 'unavailable'
  const brandLogo = data?.business_logo_path ? businessLogoUrl({logo_path:data.business_logo_path}) : null
  const accent = data?.document_accent && /^#[0-9a-f]{6}$/i.test(data.document_accent) ? data.document_accent : '#126c58'
  return <main className="customer-booking-page"><section className="customer-booking-card booking-professional" style={{borderTop:'4px solid '+accent}}>
    <header className="booking-business-header">{brandLogo?<img className="booking-business-logo" src={brandLogo} alt={(data?.business_name||'Business')+' logo'}/>:<div className="booking-business-monogram" aria-hidden="true">{data?.business_name?.trim().charAt(0) || 'F'}</div>}<div><p className="eyebrow">{data?.business_name || 'Secure appointment booking'}</p><span>Customer appointments</span></div><span className="booking-security-label">Private invitation</span></header>
    {!data ? <><h1>{error ? 'We couldn’t open this invitation' : 'Opening your appointment…'}</h1>{!error && <p role="status">Checking the latest appointment availability.</p>}</> : <>
      <p className="booking-step">{booked ? 'Appointment confirmed' : active ? 'Choose your appointment' : 'Appointment invitation'}</p>
      <h1>{booked ? appointmentComplete?'Your appointment is complete.':'You’re booked.' : expired ? 'This invitation has expired' : terminal ? 'This invitation is unavailable' : 'Find a time that works for you.'}</h1>
      <div className="booking-service-card"><h2>{data.title}</h2>{data.estimate_number&&<p className="booking-estimate-reference">Estimate {data.estimate_number}</p>}{data.address && <p><span className="booking-detail-label">Service address</span>{data.address}</p>}{data.note && <p className="booking-note">{data.note}</p>}</div>
      {booked && data.confirmed ? <section className="booking-confirmed" role="status"><span className="booking-confirmed-mark" aria-hidden="true">✓</span><h2>{appointmentComplete?'Appointment complete':'Your appointment is confirmed'}</h2><strong>{formatted(data.confirmed, businessZone)}</strong>{deviceZone !== businessZone && <p>Your local time: {formatted(data.confirmed, deviceZone)}</p>}<p>{appointmentComplete?'Thank you for choosing '+data.business_name+'.':'Saved with '+data.business_name+'. You don’t need to call to confirm.'}</p>{data.booking_reference&&<p className="booking-reference">Confirmation: <strong>{data.booking_reference}</strong></p>}<button type="button" className="primary-button" disabled={calendarBusy} onClick={() => void download()}>{calendarBusy ? 'Preparing calendar file…' : 'Add to my calendar'}</button><p>Need to change this appointment? Contact {data.business_name}{data.business_phone ? ` at ${data.business_phone}` : ''}.</p></section>
        : active ? <>
          <div className="booking-availability-heading"><div><h2>Available appointments</h2><p>Availability updates automatically. Your time is reserved when you confirm.</p></div><button type="button" className="text-button" disabled={busy || refreshing} onClick={() => void load()}>{refreshing ? 'Refreshing…' : 'Refresh times'}</button></div>
          <div className="booking-zone"><span>Times shown in <strong>{displayZone.replaceAll('_', ' ')}</strong></span>{deviceZone !== businessZone && <label><input type="checkbox" checked={localTimes} disabled={busy} onChange={event => setLocalTimes(event.target.checked)} />Use my local timezone</label>}</div>
          {available.length ? <>
            <div className="booking-date-groups">{[...groups].map(([day, items]) => <fieldset key={day} className="booking-day"><legend>{DateTime.fromISO(day, { zone: displayZone }).toFormat('cccc, MMMM d')}</legend><div className="booking-time-grid">{items.map(item => {
              const start = DateTime.fromISO(item.starts_at).setZone(displayZone), end = DateTime.fromISO(item.ends_at).setZone(displayZone)
              const minutes = Math.round(end.diff(start, 'minutes').minutes)
              return <label key={item.id} className={'booking-time-option' + (slot === item.id ? ' selected' : '')}><input type="radio" name="customer-slot" value={item.id} disabled={busy} checked={slot === item.id} onChange={() => { setSlot(item.id); setNotice(''); setError('') }} /><span><strong>{start.toFormat('h:mm a')}–{end.toFormat('h:mm a')}</strong><small>{minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`} · {start.toFormat('ZZZZ')}</small></span><span className="booking-option-check" aria-hidden="true">{slot === item.id ? '✓' : ''}</span></label>
            })}</div></fieldset>)}</div>
            <section className="booking-selection" aria-label="Review your appointment"><h2>Your appointment</h2>{picked ? <p className="booking-selected-time">{formatted(picked)}</p> : <p>Choose an available time above.</p>}<label>Your full name<input autoComplete="name" maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="First and last name" /></label><button type="button" className="primary-button booking-confirm" disabled={busy || refreshing || !picked || name.trim().length < 2} onClick={() => void confirm()}>{busy ? 'Confirming your appointment…' : 'Confirm appointment'}</button><p className="quiet">This confirms the selected appointment with {data.business_name}. No payment is made here.</p></section>
          </> : <section className="guided-empty"><h2>No available appointments remain</h2><p>Contact {data.business_name}{data.business_phone ? ` at ${data.business_phone}` : ''} for new options. Nothing has been booked.</p></section>}
          <p className="booking-deadline">Choose a time by {DateTime.fromISO(data.expires_at).setZone(businessZone).toFormat('MMM d, yyyy · h:mm a ZZZZ')}.</p>
        </> : <section className="guided-empty"><p>{data.status_reason || (expired ? 'Please contact the business for a fresh invitation. No appointment was booked from this expired invitation.' : 'Please contact the business to arrange another appointment.')}</p>{data.business_phone && <a href={'tel:' + data.business_phone.replace(/[^+\d]/g, '')}>Call {data.business_name}</a>}</section>}
    </>}
    {notice && !booked && <p role="status" className="booking-live-notice">{notice}</p>}{error && <p role="alert" className="form-message error-text">{error}</p>}
    {!data && <button type="button" className="secondary-button" disabled={busy || refreshing} onClick={() => void load()}>Try again</button>}
    <footer className="booking-powered"><img src="/finviant-mark.svg" alt="" /><span>Secure scheduling with Finviant</span></footer>
  </section></main>
}
