import {DateTime} from 'luxon'
import {localInstant} from './calendarTime'
import type {SchedulingContext,SchedulingPreferences} from '../services/schedulingWorkflow'
import type {WorkerProfile} from '../services/workers'
export type TimeOff=SchedulingContext['time_off'][number]
export type AvailabilityDay={date:string;label:string;normal:string|null;remaining:string[];blocks:TimeOff[];state:'Normal hours'|'Partial time off'|'Time off'|'Off day'|'Hours ended'|'Check daylight-saving time'}
export function workerAvailabilityDay(date:string,zone:string,worker:WorkerProfile,prefs:SchedulingPreferences,timeOff:TimeOff[],asOf?:string):AvailabilityDay{
 const day=DateTime.fromISO(date,{zone}).startOf('day'),end=day.plus({days:1})
 if(!day.isValid||day.toISODate()!==date)throw new Error('Choose a valid calendar date and business timezone.')
 const now=asOf?DateTime.fromISO(asOf).toMillis():day.toMillis(),cutoff=Math.max(day.toMillis(),now)
 const hours=worker.use_business_hours?prefs:worker
 const blocks=timeOff.filter(t=>t.user_id===worker.id&&DateTime.fromISO(t.starts_at).toMillis()<end.toMillis()&&DateTime.fromISO(t.ends_at).toMillis()>cutoff)
 const base:Omit<AvailabilityDay,'state'>={date,label:day.toFormat('ccc, MMM d'),normal:null,remaining:[],blocks}
 if(!worker.active||!hours.work_days.includes(day.weekday))return {...base,state:'Off day'}
 const clock=(m:number)=>m===1440?'midnight':DateTime.fromObject({hour:Math.floor(m/60),minute:m%60},{zone:'UTC'}).toFormat('h:mm a')
 base.normal=`${clock(hours.start_minutes)} – ${clock(hours.end_minutes)}`
 const at=(m:number)=>m===1440?end.toMillis():DateTime.fromISO(localInstant(`${date}T${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,zone)).toMillis()
 let start:number,finish:number
 try{start=at(hours.start_minutes);finish=at(hours.end_minutes)}catch{return {...base,state:'Check daylight-saving time'}}
 start=Math.max(start,cutoff)
 if(start>=finish)return {...base,state:'Hours ended'}
 let spans:Array<[number,number]>=[[start,finish]]
 for(const block of blocks){const a=DateTime.fromISO(block.starts_at).toMillis(),b=DateTime.fromISO(block.ends_at).toMillis();spans=spans.flatMap(([s,e])=>b<=s||a>=e?[[s,e]]:[...(a>s?[[s,Math.min(a,e)] as [number,number]]:[]),...(b<e?[[Math.max(b,s),e] as [number,number]]:[])])}
 const range=(s:number,e:number)=>`${DateTime.fromMillis(s,{zone}).toFormat('h:mm a')} – ${e===end.toMillis()?'midnight':DateTime.fromMillis(e,{zone}).toFormat('h:mm a')}`
 const changed=spans.length!==1||spans[0][0]!==start||spans[0][1]!==finish
 return {...base,remaining:spans.map(([s,e])=>range(s,e)),state:!spans.length?'Time off':changed?'Partial time off':'Normal hours'}
}
export function wholeLocalDay(date:string,zone:string){const start=DateTime.fromISO(date,{zone}).startOf('day');if(!start.isValid||start.toISODate()!==date)throw new Error('Choose a valid date.');return {start:start.toFormat("yyyy-MM-dd'T'HH:mm"),end:start.plus({days:1}).toFormat("yyyy-MM-dd'T'HH:mm")}}
