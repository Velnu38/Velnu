import {useState} from 'react'
import {DateTime} from 'luxon'
import {workerAvailabilityDay} from '../../lib/workerAvailability'
import type {WorkerProfile} from '../../services/workers'
import type {SchedulingContext} from '../../services/schedulingWorkflow'
export default function TeamAvailabilitySummary({workers,context,today,zone,asOf,selected,onSelect,disabled}:{workers:WorkerProfile[];context:SchedulingContext;today:string;zone:string;asOf:string;selected:string;onSelect:(id:string)=>void;disabled:boolean}){
 const [date,setDate]=useState(today),max=DateTime.fromISO(today,{zone}).plus({days:55}).toISODate()!
 return <section className="team-availability-summary" aria-label="All workers normal hours and time off"><div className="availability-heading"><h3>Team at a glance</h3><label>Team summary date<input type="date" min={today} max={max} value={date} disabled={disabled} onChange={e=>{if(e.target.value>=today&&e.target.value<=max)setDate(e.target.value)}}/></label></div><p className="quiet">Normal hours and upcoming time off, not attendance or open booking slots. Today shows only hours from the last refresh onward; completed time-off blocks are not included.</p>
 <ul>{workers.map(w=>{const day=workerAvailabilityDay(date,zone,w,context.preferences,context.time_off,asOf);return <li key={w.id}><button type="button" className="secondary-button" disabled={disabled} aria-pressed={selected===w.id} onClick={()=>onSelect(w.id)}><strong>{w.name}</strong><span>{day.state}</span><small>{day.normal?`Normal: ${day.normal}`:'No normal working hours'}</small>{day.remaining.length>0&&<small>Hours outside time off: {day.remaining.join('; ')}</small>}</button></li>})}</ul></section>
}
