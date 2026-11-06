import PlanRestriction from '../PlanRestriction'
import { useTierUsage } from '../../lib/useTierUsage'
import { isPrimaryOwner } from '../../lib/workspaceAccess'
import FormDialog from '../FormDialog'
import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../../lib/business'
import { customerActionsEnabled } from '../../lib/releaseFlags'
import { approveOffer,bookApprovedEstimate,getSchedulingContext,newBookingToken,sendAvailability,suggestSlots,type SchedulingContext,type Slot } from '../../services/schedulingWorkflow'
import { announceCalendarChange } from '../../services/calendar'
import './scheduling.css'

export default function ScheduleEstimateDialog({business,estimateId,onClose,onSaved}:{business:CurrentBusiness;estimateId:string;onClose:()=>void;onSaved?:()=>void}) {
  const zone=business.timezone || 'America/New_York',operation=useRef(false)
  const [context,setContext]=useState<SchedulingContext|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  const [title,setTitle]=useState(''),[site,setSite]=useState(''),[selectedWorkers,setWorkers]=useState<string[]>([]),[duration,setDuration]=useState(120)
  const [from,setFrom]=useState(DateTime.now().setZone(zone).toISODate()!),[slots,setSlots]=useState<Slot[]>([]),[chosen,setChosen]=useState<string[]>([]),[finding,setFinding]=useState(false)
  const [selectedMode,setMode]=useState<'offer'|'book'>('offer'),[note,setNote]=useState('Please choose the appointment that works best for you.'),[approved,setApproved]=useState(false)
  const [created,setCreated]=useState<{id:string;url:string;token:string;expires:string}|null>(null),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0)
  const pending=useRef<{signature:string;id:string;token:string;send:string}|null>(null)
  useEffect(()=>{let active=true;setLoading(true);void getSchedulingContext(business.id,estimateId).then(data=>{
    if(!active)return;setContext(data);setTitle(data.estimate?.title || 'Service visit')
    setSite(data.estimate?.property_id || (data.properties?.length===1?data.properties[0].id:''))
    setWorkers(data.team.filter(w=>w.is_you).slice(0,1).map(w=>w.id));setDuration(data.preferences.duration_minutes)
  }).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[business.id,estimateId])
  const usage = useTierUsage(business.id)
  const plan = usage?.plan
  const bookingLimit = usage?.plan==='free' && usage.jobs_limit!==null && usage.jobs_used>=usage.jobs_limit
  const teamScheduling = plan === 'pro'
  const mode = teamScheduling ? selectedMode : 'book'
  const workers = teamScheduling ? selectedWorkers : context?.team.filter(worker => worker.is_you).map(worker => worker.id) ?? []
  const invitationVisible = teamScheduling || !created?.url
  const workerKey=[...workers].sort().join(',')
  useEffect(()=>{
    if(!context || !workers.length || created || !plan)return
    let active=true;setFinding(true);setError('');setApproved(false);setChosen([]);setSlots([])
    const timer=setTimeout(()=>{void suggestSlots(business.id,workers,duration,from).then(data=>{
      if(!active)return;setSlots(data)
      const days=new Set<string>(),defaults:string[]=[]
      for(const slot of data){const day=DateTime.fromISO(slot.starts_at).setZone(zone).toISODate()!;if(!days.has(day)&&defaults.length<3){days.add(day);defaults.push(slot.starts_at)}}
      setChosen(mode==='book'?defaults.slice(0,1):defaults)
    }).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setFinding(false)})},250)
    return()=>{active=false;clearTimeout(timer)}
  },[business.id,context,workerKey,duration,from,refresh,created,mode,zone,plan])
  function close(){if(operation.current)return;onClose()}
  function toggle(start:string){setApproved(false);setChosen(values=>mode==='book'?[start]:values.includes(start)?values.filter(x=>x!==start):values.length<6?[...values,start]:values)}
  async function save(email:boolean){
    if(operation.current || bookingLimit || !plan || (created?.url && !teamScheduling) || !context?.estimate || (mode==='offer'&&!approved) || !title.trim() || !chosen.length)return
    operation.current=true;setBusy(true);setError('');setNotice('')
    try {
      const selected=slots.filter(slot=>chosen.includes(slot.starts_at))
      const input={title:title.trim(),property_id:site || null,workers:[...workers].sort(),slots:selected,note:note.trim(),recipient_email:context.estimate.customer_email}
      if(mode==='book'){
        const result=await bookApprovedEstimate(estimateId,{title:input.title,property_id:input.property_id,workers:input.workers,...selected[0]})
        setNotice(result.already_booked?'This estimate already has a job. Open Jobs to review it.':'Job booked. The customer, service address, approved scope are linked.')
        onSaved?.();setCreated({id:result.job_id,url:'',token:'',expires:''});return
      }
      let saved=created
      if(!saved){
        const signature=JSON.stringify(input)
        if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID(),token:newBookingToken(),send:crypto.randomUUID()}
        const request=pending.current
        const result=await approveOffer(estimateId,request.id,input,request.token)
        saved={id:result.id,url:window.location.origin+'/?booking='+request.token,token:request.token,expires:result.expires_at}
        setCreated(saved);announceCalendarChange();onSaved?.()
      }
      if(email){
        const result=await sendAvailability(saved.id,saved.token,pending.current!.send)
        setNotice(result.warning || 'The email provider accepted the invitation. Customer booking will update Finviant automatically.')
      }else setNotice('Appointment options approved. Copy this private invitation and share it with this customer. No email was sent.')
    }catch(e){setError(e instanceof Error?e.message:'Unable to save scheduling options. Refresh and try again.')}
    finally{operation.current=false;setBusy(false)}
  }
  const when=(slot:Slot)=>`${DateTime.fromISO(slot.starts_at).setZone(zone).toFormat('ccc, MMM d · h:mm a')} – ${DateTime.fromISO(slot.ends_at).setZone(zone).toFormat('h:mm a')}`
  return <FormDialog label={created?'Your next step is ready':'Find a time that works'} cleanVersion={invitationVisible ? notice : ''} busy={busy} onClose={onClose} wide><header className="guided-dialog-head"><div><p className="eyebrow">Approved estimate · {context?.estimate?.number || 'Schedule next'}</p><h2 id="schedule-estimate-title">{created?'Your next step is ready':'Find a time that works'}</h2></div><button type="button" className="calendar-arrow" aria-label="Close scheduling" disabled={busy} onClick={close}>×</button></header>
    {loading?<p role="status">Loading the customer and scope…</p>:context && <>
      <div className="guided-summary"><strong>{context.estimate?.customer_name}</strong><span>{context.estimate?.customer_email || 'No customer email saved'}</span><details><summary>Approved scope</summary><p>{context.estimate?.scope}</p></details></div>
      {context.estimate?.job_id && <p role="status">This estimate already has a job. Open Jobs to manage its schedule.</p>}
      {!created && !context.estimate?.job_id && <>
        {teamScheduling ? <div className="guided-mode" role="group" aria-label="Scheduling method"><button type="button" aria-pressed={mode==='offer'} onClick={()=>{setMode('offer');setApproved(false)}}>Let customer choose</button><button type="button" aria-pressed={mode==='book'} onClick={()=>{setMode('book');setApproved(false)}}>Time already agreed</button></div> : plan && <PlanRestriction plan={plan} required="pro" feature="Customer self-booking" canUpgrade={isPrimaryOwner(business)}/>}
        <div className="guided-form-grid">
          <label>Job name<input maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);setApproved(false)}}/></label>
          <label>Service address<select value={site} onChange={e=>{setSite(e.target.value);setApproved(false)}}><option value="">Confirm address with customer</option>{context.properties?.map(p=><option value={p.id} key={p.id}>{p.label?`${p.label} · `:''}{p.address}</option>)}</select></label>
          <label>Job length<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[15,30,45,60,90,120,180,240,360,480,600,720].map(n=><option key={n} value={n}>{n<60?`${n} minutes`:`${n/60} hours`}</option>)}</select></label>
          <label>Look for times from<input type="date" min={DateTime.now().setZone(zone).toISODate()!} max={DateTime.now().setZone(zone).plus({days:45}).toISODate()!} value={from} onChange={e=>setFrom(e.target.value)}/></label>
        </div>
        {teamScheduling && <fieldset className="guided-workers"><legend>Who will do the work?</legend>{context.team.map(w=><label key={w.id}><input type="checkbox" checked={workers.includes(w.id)} onChange={e=>{setWorkers(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id));setApproved(false)}}/>{w.label}{w.is_you?' (you)':''}</label>)}</fieldset>}
        {teamScheduling && !workers.length && <p role="status">Choose at least one team member. Working alone? Select yourself.</p>}
        <div className="guided-section-head"><h3>{mode==='book'?'Choose the agreed time':'Review appointment options'}</h3><button type="button" className="text-button" disabled={finding || !workers.length} onClick={()=>setRefresh(n=>n+1)}>Refresh times</button></div>
        <p className="quiet">{zone.replaceAll('_',' ')} · Includes {context.preferences.buffer_minutes} minutes between jobs. Finviant bookings and blocked time are checked; confirm any outside commitments.</p>
        {finding?<p role="status">Checking availability…</p>:slots.length?<div className="guided-slot-grid" role="group" aria-label="Available appointment times">{slots.map(slot=><label className={chosen.includes(slot.starts_at)?'selected':''} key={slot.starts_at}><input type={mode==='book'?'radio':'checkbox'} name="appointment-slot" checked={chosen.includes(slot.starts_at)} disabled={mode==='offer'&&chosen.length>=6&&!chosen.includes(slot.starts_at)} onChange={()=>toggle(slot.starts_at)}/><span>{when(slot)}</span></label>)}</div>:workers.length>0&&!error&&<p className="guided-empty">No free times in this two-week window. Try a later start date or a shorter visit. Working hours and time off are in Settings.</p>}
        {mode==='offer' && <label className="guided-message">Message to customer<textarea maxLength={1000} rows={3} value={note} onChange={e=>{setNote(e.target.value);setApproved(false)}}/></label>}
        {context.offer?.status==='approved' && plan && <p className="quiet">{teamScheduling?'Approving fresh options replaces the previous invitation.':'The customer invitation is paused. You can book the job here.'}</p>}
        {mode==='offer'&&<label className="guided-approval"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/><span>{mode==='offer'?`I approve these ${chosen.length} appointment options, the selected crew, service address and customer message.`:'I have agreed this appointment with the customer and approve the crew and service address.'}</span></label>}
        {bookingLimit&&<PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
        <div className="guided-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button>
          {mode==='offer'?<><button type="button" className="secondary-button" disabled={busy||finding||!approved||!chosen.length||!workers.length||!title.trim()} onClick={()=>void save(false)}>{busy?'Saving…':'Approve & create invitation'}</button><button type="button" className="primary-button" disabled={busy||finding||!approved||!chosen.length||!workers.length||!title.trim()||!customerActionsEnabled||!context.estimate?.customer_email} onClick={()=>void save(true)}>Approve & email customer</button></>:<button type="button" className="primary-button" disabled={busy||!plan||bookingLimit||finding||chosen.length!==1||!workers.length||!title.trim()} onClick={()=>void save(false)}>{busy?'Booking…':'Confirm booking'}</button>}
        </div>
        {mode==='offer'&&!customerActionsEnabled&&<p className="quiet">Email delivery is disabled during private testing. You can review invitations or book a time already agreed with your customer.</p>}
      </>}
      {invitationVisible && created?.url && <div className="guided-invitation"><h3>Customer invitation</h3><p>Only the appointment options and service address are shared. Staff details and internal notes stay private.</p><label>Private scheduling link<input readOnly value={created.url} onFocus={e=>e.target.select()}/></label><p className="quiet">Expires {DateTime.fromISO(created.expires).setZone(zone).toLocaleString(DateTime.DATETIME_MED)}. Times are checked again when the customer confirms.</p><div className="guided-actions"><button type="button" className="secondary-button" onClick={()=>{void navigator.clipboard.writeText(created.url).then(()=>setNotice('Invitation link copied.')).catch(()=>setError('Select the link above and copy it.'))}}>Copy invitation</button><button type="button" className="primary-button" disabled={busy||!customerActionsEnabled||!context.estimate?.customer_email} onClick={()=>void save(true)}>{busy?'Sending…':'Approve & send email'}</button></div></div>}
    </>}
    {!invitationVisible && <p role="status">The customer invitation is paused. Business Pro is required for customers to choose a time.</p>}
    {invitationVisible&&notice&&<p role="status" className="guided-success">{notice}</p>}{error&&<p role="alert" className="form-message error-text">{error}</p>}
    {created&&<div className="guided-actions"><button type="button" className="primary-button" onClick={close}>Done</button></div>}
  </FormDialog>
}
