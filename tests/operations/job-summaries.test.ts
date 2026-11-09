import assert from 'node:assert/strict'
import test from 'node:test'
import {operationsFixture,B,J,W,U,O,user,value} from './fixture.ts'
test('bounded job summaries retain checklist progress, exact labor costs and financial authorization',async()=>{
 const db=await operationsFixture();try{
  await db.exec(`reset role;insert into private.job_tasks(business_id,job_id,title,completed,due_on) values('${B}','${J}','Done',true,(now() at time zone 'America/New_York')::date-1),('${B}','${J}','Due',false,(now() at time zone 'America/New_York')::date),('${B}','${J}','Future',false,(now() at time zone 'America/New_York')::date+1);
  insert into private.job_time_entries(business_id,job_id,worker_id,worked_on,minutes,hourly_cost,created_by,request_id) values('${B}','${J}','${W}',current_date,90,20,'${U}',gen_random_uuid());
  insert into private.job_budgets(business_id,job_id,cost) values('${B}','${J}',200);
  insert into public.bookkeeping_entries(business_id,created_by,entry_date,direction,amount,category,description,job_id) values('${B}','${U}',current_date,'expense',50,'Materials','Test supplies','${J}');`)
  await user(db,U)
  let rows=await value(db,'select public.get_job_plan_summaries($1,$2) value',[B,[J]])
  assert.equal(rows.length,1);assert.equal(rows[0].tasks_total,3);assert.equal(rows[0].tasks_completed,1);assert.equal(rows[0].due_tasks,1);assert.equal(Number(rows[0].hours),1.5);assert.equal(Number(rows[0].tracked_cost),80);assert.equal(Number(rows[0].budget_cost),200)
  assert.equal('time' in rows[0],false);assert.equal('activity' in rows[0],false)
  await db.exec(`reset role;update public.business_members set role='technician',access_modules=array['jobs'] where business_id='${B}' and user_id='${U}'`);await user(db,U)
  rows=await value(db,'select public.get_job_plan_summaries($1,$2) value',[B,[J]])
  assert.equal(rows[0].financial_access,false);for(const k of ['hours','tracked_cost','budget_cost'])assert.equal(k in rows[0],false)
 }finally{await db.close()}
})
test('job summaries reject stranger/foreign/null/oversized requests and anonymous grants',async()=>{
 const db=await operationsFixture();try{
  await user(db,U)
  for(const ids of [null,[J,J,J,J,J],['ffffffff-ffff-4fff-8fff-ffffffffffff'],[J,null],[J,J]])await assert.rejects(()=>value(db,'select public.get_job_plan_summaries($1,$2) value',[B,ids]),/access/)
  assert.deepEqual(await value(db,'select public.get_job_plan_summaries($1,$2) value',[B,[]]),[])
  await db.exec(`reset role;update public.business_members set access_modules=array['billing'] where user_id='${O}'`);await user(db,O)
  await assert.rejects(()=>value(db,'select public.get_job_plan_summaries($1,$2) value',[B,[J]]),/access/)
  await db.exec('reset role;set role anon');await assert.rejects(()=>value(db,'select public.get_job_plan_summaries($1,$2) value',[B,[J]]),/permission/)
 }finally{await db.close()}
})
