import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {executionFixture,ids,actor} from './execution-fixture.ts'
const page=async(db:any,filter='all',search='',n=0,customer:string|null=null,business=ids.business)=>(await db.query('select public.get_job_management_page($1,$2,$3,$4,$5) value',[business,customer,filter,search,n])).rows[0].value
async function setup(){const db=await executionFixture();try{await db.exec('reset role;alter table public.invoices add column if not exists work_completed boolean default false');await db.exec(await readFile('supabase/migrations/20261110194508_job_management_queue_pagination.sql','utf8'));return db}catch(e){await db.close();throw e}}
async function user(db:any,id=ids.owner){await db.exec('reset role');await actor(db,id);await db.exec('set role authenticated')}
test('management pagination retains complete counts and literal search beyond 50,000 rows with only ten jobs and signals per page',async()=>{
 const db=await setup();try{
  await db.query("insert into jobs(business_id,customer_id,title,status) select $1,$2,'Historical work '||n,'completed' from generate_series(1,50001)n",[ids.business,ids.customer])
  await db.query("insert into jobs(business_id,customer_id,property_id,title,status,assigned_user_ids) values($1,$2,$3,'100% repair','lead',$4)",[ids.business,ids.customer,ids.site,[ids.worker]])
  await user(db);const first=await page(db);assert.equal(first.total,50002);assert.equal(first.entries.length,10);assert.equal(first.signals.length,10);assert.equal(first.counts.history,50001);assert.equal(first.counts.active,1);assert.ok(JSON.stringify(first).length<15000)
  const last=await page(db,'all','',999999);assert.equal(last.page,5000);assert.equal(last.entries.length,2);assert.ok(last.entries.every((e:any)=>!first.entries.some((f:any)=>e.data.id===f.data.id)))
  const literal=await page(db,'all','100%');assert.equal(literal.total,1);assert.equal(literal.entries[0].data.title,'100% repair');assert.equal(literal.counts.all,50002)
  assert.equal((await page(db,'all','',0,ids.outsider)).total,0)
  for(const args of [['invalid','',0],['all','x'.repeat(201),0],['all','',-1]])await assert.rejects(()=>page(db,...args as [string,string,number]),(e:any)=>e.code==='22023')
  await user(db,ids.outsider);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
  await db.exec('reset role;set role anon');await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
test('management queue includes approved legacy work, overdue tasks and materials; staff billing and revoked jobs permissions fail closed',async()=>{
 const db=await setup();try{
  const J='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',K='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',E='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query("insert into jobs(id,business_id,customer_id,property_id,title,status,assigned_user_ids) values($1,$2,$3,$4,'Task due','lead',$5),($6,$2,$3,$4,'Material needed','in_progress',$5)",[J,ids.business,ids.customer,ids.site,[ids.worker],K])
  await db.query("insert into private.job_tasks(business_id,job_id,title,due_on) values($1,$2,'Due task',current_date-1)",[ids.business,J])
  await db.query("insert into private.job_materials(business_id,job_id,name,quantity,status) values($1,$2,'Sand',1,'ordered')",[ids.business,K])
  // Seed a pre-automation accepted estimate without invoking the current acceptance trigger.
  await db.exec("set session_replication_role='replica'");
  await db.query("insert into estimates(id,business_id,customer_id,estimate_number,status) values($1,$2,$3,'EST-LEGACY','accepted')",[E,ids.business,ids.customer]);await db.exec("set session_replication_role='origin'")
  await user(db);const all=await page(db);assert.equal(all.total,3);assert.equal(all.entries[0].kind,'approved');assert.equal(all.counts.approved,1);assert.equal(all.counts.unscheduled,3);assert.equal(all.counts.attention,2);assert.equal((await page(db,'attention')).total,2)
  assert.equal((await page(db,'approved','EST-LEGACY')).entries[0].data.id,E)
  await db.exec('reset role');await db.query("update business_members set access_modules=array['jobs'] where user_id=$1",[ids.worker]);await user(db,ids.worker)
  const restricted=await page(db);assert.equal(restricted.total,2);assert.equal(restricted.counts.approved,0);assert.equal(restricted.counts.billing,0);assert.ok(restricted.entries.every((e:any)=>e.kind==='job'&&e.data.invoice===null));assert.ok(restricted.signals.every((s:any)=>s.pending_changes===0));await assert.rejects(()=>page(db,'billing'),(e:any)=>e.code==='42501')
  await db.exec('reset role');await db.query("update business_members set access_modules='{}' where user_id=$1",[ids.worker]);await user(db,ids.worker);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
