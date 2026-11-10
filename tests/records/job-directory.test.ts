import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {recordFixture,asUser,asAnon,ids,val} from './record-action-fixture.ts'
const page=(db:any,filter='all',search='',n=0,worker:string|null=null)=>val(db,'select public.get_job_directory_page($1,null,$2,$3,$4,$5) value',[ids.business,filter,worker,search,n])

test('job directory returns bounded pages, full counts and literal search beyond 50,000 rows without exposing another tenant',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'))
  await db.query("insert into public.jobs(business_id,customer_id,title,status) select $1,$2,'Historical job '||n,'completed' from generate_series(1,50001)n",[ids.business,ids.customer])
  await db.query("insert into public.jobs(business_id,customer_id,title,status,assigned_user_ids) values($1,$2,'Literal 100% inspection','lead',$3)",[ids.business,ids.customer,[ids.worker]])
  await asUser(db)
  const first=await page(db);assert.equal(first.items.length,25);assert.equal(first.total,50002);assert.equal(first.counts.history,50001);assert.equal(first.counts.active,1)
  const last=await page(db,'all','',2000);assert.equal(last.items.length,2);assert.equal(last.page,2000);assert.ok(last.items.every((j:any)=>!first.items.some((f:any)=>f.id===j.id)))
  const clamped=await page(db,'all','',999999);assert.equal(clamped.page,2000);assert.deepEqual(clamped.items,last.items)
  const literal=await page(db,'all','100%');assert.equal(literal.total,1);assert.equal(literal.items[0].title,'Literal 100% inspection');assert.equal(literal.counts.all,50002)
  const assigned=await page(db,'active','',0,ids.worker);assert.equal(assigned.total,1);assert.equal(assigned.counts.all,1)
  for(const args of [['invalid','',0],['all','x'.repeat(201),0],['all','',-1]])await assert.rejects(()=>page(db,...args as [string,string,number]),(e:any)=>e.code==='22023')
  await asUser(db,ids.outsider);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
  await asAnon(db);await assert.rejects(()=>page(db),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})

test('job directory hides billing details and billing counts from jobs-only staff',async()=>{
 const db=await recordFixture();try{
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261110174500_jobs_directory_pagination.sql','utf8'))
  await db.query("insert into public.jobs(business_id,customer_id,title,status) values($1,$2,'Completed work','completed')",[ids.business,ids.customer])
  await asUser(db);assert.equal((await page(db,'billing')).total,1)
  await db.exec('reset role');await db.query("update public.business_members set access_modules=array['jobs'] where user_id=$1",[ids.worker]);await asUser(db,ids.worker)
  const result=await page(db);assert.equal(result.total,1);assert.equal(result.counts.billing,0);assert.equal(result.items[0].invoice,null)
  await assert.rejects(()=>page(db,'billing'),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
