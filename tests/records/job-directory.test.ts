import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {recordFixture,asUser,asAnon,ids,val} from './record-action-fixture.ts'
const page=(db:any,filter='all',search='',n=0,worker:string|null=null)=>val(db,'select public.get_job_directory_page($1,null,$2,$3,$4,$5) value',[ids.business,filter,worker,search,n])

test('job directory returns bounded pages, full counts and literal search beyond 50,000 rows without exposing another tenant',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'));await db.exec(await readFile('supabase/migrations/20261110182728_jobs_overview_summary.sql','utf8'))
  await db.query("insert into public.jobs(business_id,customer_id,title,status) select $1,$2,'Historical job '||n,'completed' from generate_series(1,50001)n",[ids.business,ids.customer])
  await db.query("insert into public.jobs(business_id,customer_id,title,status,assigned_user_ids) values($1,$2,'Literal 100% inspection','lead',$3)",[ids.business,ids.customer,[ids.worker]])
  await asUser(db)
  const summary=await val(db,'select public.get_jobs_overview($1) value',[ids.business]);assert.equal(summary.counts.all,50002);assert.equal(summary.counts.history,50001);assert.equal(summary.focus.length,1);assert.equal(summary.agenda.length,0);assert.equal(summary.focus[0].title,'Literal 100% inspection');assert.ok(JSON.stringify(summary).length<4000,'overview response stays bounded beyond 50,000 rows');
  const first=await page(db);assert.deepEqual(summary.counts,first.counts);assert.equal(first.items.length,25);assert.equal(first.total,50002);assert.equal(first.counts.history,50001);assert.equal(first.counts.active,1)
  const last=await page(db,'all','',2000);assert.equal(last.items.length,2);assert.equal(last.page,2000);assert.ok(last.items.every((j:any)=>!first.items.some((f:any)=>f.id===j.id)))
  const clamped=await page(db,'all','',999999);assert.equal(clamped.page,2000);assert.deepEqual(clamped.items,last.items)
  const literal=await page(db,'all','100%');assert.equal(literal.total,1);assert.equal(literal.items[0].title,'Literal 100% inspection');assert.equal(literal.counts.all,50002)
  const assigned=await page(db,'active','',0,ids.worker);assert.equal(assigned.total,1);assert.equal(assigned.counts.all,1)
  for(const args of [['invalid','',0],['all','x'.repeat(201),0],['all','',-1]])await assert.rejects(()=>page(db,...args as [string,string,number]),(e:any)=>e.code==='22023')
  await asUser(db,ids.outsider);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
  await assert.rejects(()=>val(db,'select public.get_jobs_overview($1) value',[ids.business]),(e:any)=>e.code==='42501');
  await asAnon(db);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})

test('job directory hides billing details and billing counts from jobs-only staff',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'));await db.exec(await readFile('supabase/migrations/20261110182728_jobs_overview_summary.sql','utf8'))
  await db.query("insert into public.jobs(business_id,customer_id,title,status) values($1,$2,'Completed work','completed')",[ids.business,ids.customer])
  await asUser(db);assert.equal((await page(db,'billing')).total,1)
  await db.exec('reset role');await db.query("update public.business_members set access_modules=array['jobs'] where user_id=$1",[ids.worker]);await asUser(db,ids.worker)
  const summary=await val(db,'select public.get_jobs_overview($1) value',[ids.business]);assert.equal(summary.counts.billing,0);assert.deepEqual(summary.focus,[]);
  const result=await page(db);assert.equal(result.total,1);assert.equal(result.counts.billing,0);assert.equal(result.items[0].invoice,null)
  await assert.rejects(()=>page(db,'billing'),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})

test('job overview preserves timezone totals and crew counts beyond its four-card limit',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'));await db.exec(await readFile('supabase/migrations/20261110182728_jobs_overview_summary.sql','utf8'))
  await db.query("update public.businesses set timezone='Pacific/Honolulu' where id=$1",[ids.business])
  const start=await val(db,"select (date_trunc('day',now() at time zone 'Pacific/Honolulu') at time zone 'Pacific/Honolulu')::text value")
  for(let n=0;n<7;n++){
   const id=await val(db,"insert into public.jobs(business_id,customer_id,title,status,scheduled_start,scheduled_end,assigned_user_ids) values($1,$2,$3,$4,$5::timestamptz+($6::integer*interval '2 hours'),$5::timestamptz+(($6::integer*2+1)*interval '1 hour'),$7) returning id value",[ids.business,ids.customer,'Today '+n,n===6?'in_progress':'scheduled',start,n,[ids.worker]])
   await db.query("insert into public.appointments(business_id,customer_id,job_id,title,status,starts_at,ends_at) select business_id,customer_id,id,title,'confirmed',scheduled_start,scheduled_end from public.jobs where id=$1",[id])
  }
  // Old planned dates are not confirmed appointments and must not enter the agenda.
  await db.query("insert into public.jobs(business_id,customer_id,title,status,scheduled_start) values($1,$2,'Unbooked old plan','lead',$3)",[ids.business,ids.customer,start])
  await asUser(db)
  const result=await val(db,'select public.get_jobs_overview($1) value',[ids.business]);assert.equal(result.counts.today,7);assert.equal(result.counts.active,8);assert.equal(result.counts.unscheduled,1);assert.equal(result.agenda.length,4);assert.equal(result.focus.length,4);assert.equal(result.focus[0].title,'Today 6');assert.equal(result.crew_today[ids.worker],7);assert.ok(result.agenda.every((j:any)=>j.active_appointment))
  assert.deepEqual(result.counts,(await page(db)).counts)
  const scoped=await val(db,'select public.get_jobs_overview($1,null,$2) value',[ids.business,ids.worker]);assert.equal(scoped.counts.all,7)
  const empty=await val(db,'select public.get_jobs_overview($1,$2) value',[ids.business,ids.outsider]);assert.equal(empty.counts.all,0);assert.deepEqual(empty.crew_today,{})
  await asAnon(db);await assert.rejects(()=>val(db,'select public.get_jobs_overview($1) value',[ids.business]),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})

test('job directory search includes scoped service address fields',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20261113004358_job_directory_location_search.sql','utf8'))
  await db.query("insert into public.properties(id,business_id,customer_id,label,address_line1,city,state,postal_code) values($1,$2,$3,'Primary','1400 Cedar Lane','Chesapeake','VA','23320')",['47000000-0000-4000-8000-000000000001',ids.business,ids.customer])
  await db.query("insert into public.jobs(id,business_id,customer_id,property_id,title,status) values($1,$2,$3,$4,'Kitchen repair','lead')",['47000000-0000-4000-8000-000000000002',ids.business,ids.customer,'47000000-0000-4000-8000-000000000001'])
  await asUser(db)
  const byCity=await page(db,'all','Chesapeake');assert.equal(byCity.total,1);assert.equal(byCity.items[0].title,'Kitchen repair')
  const byStreet=await page(db,'all','Cedar Lane');assert.equal(byStreet.total,1)
  const other=await page(db,'all','Norfolk');assert.equal(other.total,0)
 }finally{await db.close()}
})
