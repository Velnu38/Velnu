import test from 'node:test'
import assert from 'node:assert/strict'
import {DateTime} from 'luxon'
import {workerAvailabilityDay,wholeLocalDay} from '../../src/lib/workerAvailability'
import {localInstant} from '../../src/lib/calendarTime'
import type {WorkerProfile} from '../../src/services/workers'
const worker:WorkerProfile={id:'worker',name:'Alex',trade:'Painter',active:true,is_owner:false,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:600,end_minutes:900,updated_at:'2026-01-01'}
const prefs={work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:60,buffer_minutes:30,notice_hours:24}
const block=(start:string,end:string,id='leave',user='worker')=>({id,user_id:user,starts_at:start,ends_at:end,note:'Time off'})
test('inherited and custom hours, off weekdays and inactive profiles',()=>{
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[]).normal,'8:00 AM – 5:00 PM')
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',{...worker,use_business_hours:false},prefs,[]).normal,'10:00 AM – 3:00 PM')
 assert.equal(workerAvailabilityDay('2026-11-14','UTC',worker,prefs,[]).state,'Off day')
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',{...worker,active:false},prefs,[]).state,'Off day')
})
test('partial, overlapping and full leave subtract only this worker and respect exclusive ends',()=>{
 const partial=workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[block('2026-11-10T10:00Z','2026-11-10T12:00Z'),block('2026-11-10T11:00Z','2026-11-10T13:00Z','second'),block('2026-11-10T00:00Z','2026-11-11T00:00Z','other','other')])
 assert.equal(partial.state,'Partial time off');assert.deepEqual(partial.remaining,['8:00 AM – 10:00 AM','1:00 PM – 5:00 PM']);assert.equal(partial.blocks.length,2)
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[block('2026-11-09T00:00Z','2026-11-11T00:00Z')]).state,'Time off')
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[block('2026-11-09T00:00Z','2026-11-10T00:00Z')]).blocks.length,0)
})
test('today excludes elapsed hours and already-ended time off from remaining schedule',()=>{
 const d=workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[block('2026-11-10T08:00Z','2026-11-10T10:00Z')],'2026-11-10T12:00Z')
 assert.deepEqual(d.remaining,['12:00 PM – 5:00 PM']);assert.equal(d.blocks.length,0)
 assert.equal(workerAvailabilityDay('2026-11-10','UTC',worker,prefs,[],'2026-11-10T18:00Z').state,'Hours ended')
})
test('all-day local blocks preserve DST 23/25-hour days and timezone dates',()=>{
 for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]] as const){const range=wholeLocalDay(date,'America/New_York');assert.equal(DateTime.fromISO(localInstant(range.end,'America/New_York')).diff(DateTime.fromISO(localInstant(range.start,'America/New_York')),'hours').hours,hours)}
 const d=workerAvailabilityDay('2026-11-10','Pacific/Kiritimati',worker,prefs,[block('2026-11-09T10:00Z','2026-11-10T10:00Z')]);assert.equal(d.state,'Time off')
})
test('DST nonexistent or ambiguous recurring boundaries warn instead of inventing normal instants',()=>{
 const sunday={...worker,use_business_hours:false,work_days:[7],start_minutes:90,end_minutes:150}
 assert.equal(workerAvailabilityDay('2026-03-08','America/New_York',sunday,prefs,[]).state,'Check daylight-saving time')
 assert.equal(workerAvailabilityDay('2026-11-01','America/New_York',sunday,prefs,[]).state,'Check daylight-saving time')
 const midnight=workerAvailabilityDay('2026-11-10','UTC',{...worker,use_business_hours:false,start_minutes:600,end_minutes:1440},prefs,[])
 assert.equal(midnight.normal,'10:00 AM – midnight');assert.deepEqual(midnight.remaining,['10:00 AM – midnight'])
})
