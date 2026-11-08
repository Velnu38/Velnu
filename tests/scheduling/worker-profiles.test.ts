import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {fixture,ids,actor} from './fixture'
const migration=await readFile('supabase/migrations/20261108131228_team_management_workers.sql','utf8')
const input=(name:string,extra={})=>({name,trade:'Landscaping',active:true,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,...extra})
async function setup(){const db=await fixture(true);await db.exec('reset role;set check_function_bodies=true');await db.exec(migration);await db.exec('set role authenticated');return db}
async function save(db:any,name:string,extra={}){return (await db.query('select public.save_worker_profile($1,gen_random_uuid(),$2::jsonb)',[ids.business,JSON.stringify(input(name,extra))]))}
async function roster(db:any){return (await db.query('select public.get_worker_roster($1) r',[ids.business])).rows[0].r}
test('independent workers enforce 5/25 limits, preserve inactive history, and grant no account seats',async()=>{
 const db=await setup();try{
  await db.exec(`reset role;update private.business_entitlements set plan='basic';set role authenticated`)
  assert.equal((await roster(db)).worker_limit,5)
  for(let i=0;i<3;i++)await save(db,'Worker '+i)
  assert.equal((await roster(db)).active_count,5)
  await assert.rejects(save(db,'Over limit'),/limit is reached/)
  const r=await roster(db),w=r.workers.find((w:any)=>w.name==='Worker 0')
  await db.query('select public.save_worker_profile($1,$2,$3::jsonb,$4)',[ids.business,w.id,JSON.stringify({...w,active:false}),w.updated_at])
  await save(db,'Replacement');assert.equal((await roster(db)).workers.length,6)
  await assert.rejects(db.query('select public.save_worker_profile($1,$2,$3::jsonb,$4)',[ids.business,w.id,JSON.stringify({...w,active:true}),(await roster(db)).workers.find((x:any)=>x.id===w.id).updated_at]),/limit is reached/)
  assert.equal((await db.query('select count(*)::int n from business_members where business_id=$1',[ids.business])).rows[0].n,2)
  await db.exec(`reset role;update private.business_entitlements set plan='pro';set role authenticated`)
  for(let i=0;i<20;i++)await save(db,'Pro worker '+i)
  assert.equal((await roster(db)).active_count,25);await assert.rejects(save(db,'Pro over limit'),/limit is reached/)
 }finally{await db.close()}
})
test('Free permits owner only, strangers cannot read or mutate roster, anonymous callers lack grants',async()=>{
 const db=await setup();try{
  await db.exec(`reset role;update private.business_entitlements set plan='free';set role authenticated`)
  await assert.rejects(save(db,'Free extra'),/owner worker only/)
  await assert.rejects(db.query('select public.dispatch_job(gen_random_uuid(),$1,now(),now())',[[ids.worker]]))
  await actor(db,ids.outsider);await assert.rejects(roster(db),/access is required/);await assert.rejects(save(db,'Intruder'),/access is required/)
  await db.exec('reset role;set role anon');await assert.rejects(roster(db),/permission denied/)
 }finally{await db.close()}
})
test('Individual assigns internal workers, checks custom hours, conflicts, time off and stale edits',async()=>{
 const db=await setup();try{
  await db.exec(`reset role;update private.business_entitlements set plan='basic';set role authenticated`)
  await save(db,'Internal worker',{use_business_hours:false,work_days:[1,2,3,4,5,6,7],start_minutes:540,end_minutes:1020})
  const w=(await roster(db)).workers.find((w:any)=>w.name==='Internal worker')
  const job=(await db.query(`insert into public.jobs(business_id,customer_id,title) values($1,$2,'Worker assignment') returning id`,[ids.business,ids.customer])).rows[0].id
  await db.query('select public.assign_job_crew($1,$2,$3,$4,$5)',[job,[w.id],null,null,[]])
  const day=(await db.query("select (current_date+3)::text d")).rows[0].d
  await assert.rejects(db.query('select public.save_job_appointment($1,$2,$3,null,null,false)',[job,day+'T07:00:00Z',day+'T08:00:00Z']),/already booked/)
  await db.query('select public.save_job_appointment($1,$2,$3,null,null,false)',[job,day+'T15:00:00Z',day+'T16:00:00Z'])
  assert.deepEqual((await db.query('select assigned_user_ids from jobs where id=$1',[job])).rows[0].assigned_user_ids,[w.id])
  await assert.rejects(db.query('select public.save_worker_profile($1,$2,$3::jsonb,$4)',[ids.business,w.id,JSON.stringify({...w,active:false}),w.updated_at]),/Reassign open jobs/)
  await assert.rejects(db.query('select public.manage_worker_time_off($1,$2,$3,$4,\'Vacation\',null)',[ids.business,w.id,day+'T15:00:00Z',day+'T17:00:00Z']),/already has work/)
  await db.query('select public.manage_worker_time_off($1,$2,$3,$4,\'Vacation\',null)',[ids.business,w.id,day+'T17:00:00Z',day+'T19:00:00Z'])
  const c=(await db.query('select public.get_scheduling_context($1,null) c',[ids.business])).rows[0].c
  assert.ok(c.team.some((x:any)=>x.id===w.id));assert.ok(c.time_off.some((x:any)=>x.user_id===w.id))
  await db.query('select public.save_worker_profile($1,$2,$3::jsonb,$4)',[ids.business,w.id,JSON.stringify({...w,name:'Renamed'}),w.updated_at])
  await assert.rejects(db.query('select public.save_worker_profile($1,$2,$3::jsonb,$4)',[ids.business,w.id,JSON.stringify(w),w.updated_at]),/worker changed/)
 }finally{await db.close()}
})
