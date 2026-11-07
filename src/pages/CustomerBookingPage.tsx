import { useEffect,useRef,useState } from 'react'
import { DateTime } from 'luxon'
import { customerBooking,type BookingView,type Slot } from '../services/schedulingWorkflow'
import { appointmentIcs } from '../lib/calendarDownload'
import '../components/scheduling/scheduling.css'

export default function CustomerBookingPage({token}:{token:string}) {
  const [data,setData]=useState<BookingView|null>(null),[error,setError]=useState(''),[name,setName]=useState(''),[slot,setSlot]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0)
  const sending=useRef(false),calendarId=useRef(crypto.randomUUID())
  useEffect(()=>{let active=true;setError('');void customerBooking(token).then(value=>{if(active){setData(value);setSlot('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[token,version])
  async function confirm(){
    if(sending.current||!slot||name.trim().length<2)return
    sending.current=true;setBusy(true);setError('')
    try{setData(await customerBooking(token,slot,name.trim()))}
    catch(e){setError(e instanceof Error?e.message:'Your booking could not be confirmed. Refresh the times and try again.')}
    finally{sending.current=false;setBusy(false)}
  }
  const when=(item:Slot)=>`${DateTime.fromISO(item.starts_at).setZone(data?.timezone || 'UTC').toFormat('cccc, MMMM d · h:mm a')} – ${DateTime.fromISO(item.ends_at).setZone(data?.timezone || 'UTC').toFormat('h:mm a')}`
  function download(){
    if(!data?.confirmed)return
    const text=appointmentIcs({id:calendarId.current,title:`${data.business_name}: ${data.title}`,start:data.confirmed.starts_at,end:data.confirmed.ends_at,address:data.address})
    const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'})),link=document.createElement('a')
    link.href=url;link.download='Finviant-appointment.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <main className="customer-booking-page"><section className="customer-booking-card">
    <div className="customer-booking-brand"><img src="/finviant-mark.svg" alt=""/><span>Appointments · Powered by Finviant</span></div>
    {!data?<><h1>{error?'Appointment link unavailable':'Opening your appointment…'}</h1>{!error&&<p role="status">Loading the business’s appointment options.</p>}</>:<>
      <p className="eyebrow">{data.business_name}</p><h1>{data.status==='booked'?'Your appointment is confirmed':data.status==='canceled'?'Appointment canceled':'Choose a time that works for you'}</h1>
      <h2>{data.title}</h2>{data.address&&<p className="booking-address">{data.address}</p>}
      {data.status==='booked'&&data.confirmed?<div className="booking-confirmed" role="status"><strong>{when(data.confirmed)}</strong><p>{data.timezone.replaceAll('_',' ')}. Your appointment is saved with the business.</p><button type="button" className="primary-button" onClick={download}>Add to calendar (.ics)</button><p>Need to change the time? Contact {data.business_name}{data.business_phone?` at ${data.business_phone}`:''}.</p></div>:data.status==='canceled'?<p>Please contact the business to arrange another appointment.</p>:<>
        {data.note&&<p className="booking-note">{data.note}</p>}
        <p>All times are in {data.timezone.replaceAll('_',' ')}. The business has reviewed these options; the final time is checked when you confirm.</p>
        {data.slots.length?<><fieldset className="guided-slot-grid booking-options"><legend>Available appointments</legend>{data.slots.map(item=><label className={slot===item.id?'selected':''} key={item.id}><input type="radio" name="customer-slot" checked={slot===item.id} onChange={()=>setSlot(item.id)}/><span>{when(item)}</span></label>)}</fieldset><label>Your full name<input autoComplete="name" maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><button type="button" className="primary-button booking-confirm" disabled={busy||!slot||name.trim().length<2} onClick={()=>void confirm()}>{busy?'Confirming…':'Confirm this appointment'}</button></>:<div className="guided-empty"><h2>No appointment options remain</h2><p>Please contact {data.business_name}{data.business_phone?` at ${data.business_phone}`:''} for new times.</p></div>}
      </>}
    </>}
    {error&&<p role="alert" className="form-message error-text">{error}</p>}{(!data||data.status==='approved')&&<button type="button" className="text-button" disabled={busy} onClick={()=>setVersion(n=>n+1)}>Refresh appointment times</button>}
  </section></main>
}
