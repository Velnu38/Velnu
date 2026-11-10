import {useState} from 'react'
import {DateTime} from 'luxon'
import type {WorkerProfile} from '../../services/workers'
import type {SchedulingContext} from '../../services/schedulingWorkflow'
import {workerAvailabilityDay} from '../../lib/workerAvailability'
export default function WorkerAvailabilityCalendar({worker,context,zone,today,onChoose,disabled,asOf}:{worker:WorkerProfile;context:SchedulingContext;zone:string;today:string;onChoose:(date:string)=>void;disabled:boolean;asOf:string}){
 const [offset,setOffset]=useState(0)
 const start=DateTime.fromISO(today,{zone}).plus({days:offset}),days=Array.from({length:7},(_,n)=>workerAvailabilityDay(start.plus({days:n}).toISODate()!,zone,worker,context.preferences,context.time_off,asOf))
 return <section className="availability-calendar" aria-label={`${worker.name} normal hours and time off`}>
 <div className="availability-heading"><div><h3>{worker.name}: normal hours &amp; time off</h3><p>{start.toFormat('MMM d')} – {start.plus({days:6}).toFormat('MMM d, yyyy')}</p></div><nav aria-label="Availability dates"><button type="button" className="secondary-button" disabled={disabled||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-7))}>Previous week</button><button type="button" className="text-button" disabled={disabled||offset===0} onClick={()=>setOffset(0)}>Today</button><button type="button" className="secondary-button" disabled={disabled||offset+13>=60} onClick={()=>setOffset(n=>n+7)}>Next week</button></nav></div>
 <p className="quiet">Normal hours minus recorded time off, not open booking slots. Existing appointments, jobs and travel buffers are checked when scheduling. Today shows only hours from the last refresh onward, not completed time off. This view covers the next eight weeks in {zone.replaceAll('_',' ')}.</p>
 <ul className="availability-days">{days.map(day=><li key={day.date} data-state={day.state}><button type="button" disabled={disabled} onClick={()=>onChoose(day.date)} aria-label={`Set time off for ${worker.name} on ${day.label}`}><strong>{day.label}</strong><span className="availability-state">{day.state}</span>{day.normal&&<span>Normal: {day.normal}</span>}{day.remaining.length>0&&<span>Hours outside time off: {day.remaining.join('; ')}</span>}{day.blocks.length>0&&<span>{day.blocks.length} time-off {day.blocks.length===1?'block':'blocks'}</span>}<small>Set time off</small></button></li>)}</ul>
 </section>
}
