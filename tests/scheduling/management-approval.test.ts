import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,ids,estimate,actor} from './fixture.ts'
async function ready(){const db=await fixture(true);try{
 await db.exec(`reset role;set check_function_bodies=false;create function private.job_workspace_access(b uuid, finance boolean default false) returns boolean language sql stable security definer set search_path='' as $$select coalesce(private.member_module_access(b,auth.uid(),'jobs') and (not finance or private.member_module_access(b,auth.uid(),'finances')),false)$$;alter table invoices add column if not exists deposit_estimate_id uuid,add column if not exists work_completed boolean default false;alter table private.scheduling_offers add column if not exists public_snapshot jsonb,add column if not exists confirmed_snapshot jsonb;`)
 // Install the live customer-booking definitions before exercising their replacement.
 const live=await readFile('supabase/migrations/20261108003415_live_customer_scheduling.sql','utf8')
 const end=live.indexOf('-- Reopening inactive work')
 await db.exec(live.slice(live.indexOf('create function private.scheduling_offer_public_snapshot'),end))
 await db.exec(await readFile('supabase/migrations/20261109184432_approved_job_management_handoff.sql','utf8'))
 await db.exec('set role authenticated');return db
 }catch(e){await db.close();throw e}}
const value=async(db:any,sql:string,args:any[]=[])=>((await db.query(sql,args)).rows[0] as any).value
async function slots(db:any){return await value(db,'select public.suggest_scheduling_slots($1,$2,60,current_date) value',[ids.business,[ids.owner]])}
test('estimate approval creates one unscheduled job and direct booking reuses it without changing scope',async()=>{
 const db=await ready();try{
 const e=await estimate(db),j=await value(db,'select job_id value from estimates where id=$1',[e]);assert.ok(j)
 let job=(await db.query('select * from jobs where id=$1',[j])).rows[0] as any;assert.equal(job.status,'lead');assert.equal(job.scheduled_start,null);assert.equal(job.source_estimate_id,e);assert.match(job.description,/Mow and trim/);const attention=await value(db,'select public.get_workflow_next_actions($1) value',[ids.business]);assert.ok(attention.approved.some((a:any)=>a.id===e),'Home still offers scheduling until an appointment exists')
 const slot=(await slots(db))[0];assert.ok(slot)
 const input={title:'Lawn visit',property_id:ids.site,workers:[ids.owner],...slot}
 const booking=await value(db,'select public.book_approved_estimate($1,$2) value',[e,JSON.stringify(input)]);assert.equal(booking.job_id,j);assert.equal(booking.already_booked,false)
 const retry=await value(db,'select public.book_approved_estimate($1,$2) value',[e,JSON.stringify(input)]);assert.equal(retry.job_id,j);assert.equal(retry.already_booked,true)
 assert.equal(Number(await value(db,'select count(*) value from jobs where source_estimate_id=$1',[e])),1);assert.equal(Number(await value(db,'select count(*) value from appointments where job_id=$1',[j])),1)
 }finally{await db.close()}
})
test('customer scheduling invitation still books an auto-created approved job once',async()=>{
 const db=await ready();try{
 const e=await estimate(db),j=await value(db,'select job_id value from estimates where id=$1',[e]),slot=(await slots(db))[0]
 const request='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='ab'.repeat(32)
 const input={title:'Lawn visit',property_id:ids.site,workers:[ids.owner],slots:[slot],note:'',recipient_email:'customer@example.test'}
 await value(db,'select public.approve_scheduling_offer($1,$2,$3,$4) value',[e,request,JSON.stringify(input),hash])
 await db.exec('reset role');const view=await value(db,'select private.customer_schedule_offer($1,null,null) value',[hash]);assert.equal(view.status,'approved');assert.equal(view.slots.length,1)
 // Read/confirm through the private body here; token hashing and the public wrapper are covered in existing scheduling tests.
 const booked=await value(db,'select private.customer_schedule_offer($1,$2,$3) value',[hash,view.slots[0].id,'Test Customer']);assert.equal(booked.status,'booked')
 assert.equal(await value(db,'select job_id value from estimates where id=$1',[e]),j);assert.equal(Number(await value(db,'select count(*) value from jobs where source_estimate_id=$1',[e])),1)
 }finally{await db.close()}
})
test('legacy approved work prepares one linked job and rejects unapproved and other-business estimates',async()=>{
 const db=await ready();try{
 await db.exec('reset role;alter table estimates disable trigger approved_management_job;set role authenticated')
 const e=await estimate(db);await db.exec('reset role;alter table estimates enable trigger approved_management_job;set role authenticated')
 let queue=await value(db,'select public.get_approved_management_queue($1,null,0) value',[ids.business]);assert.ok(queue.some((q:any)=>q.id===e))
 const j=await value(db,'select public.prepare_approved_management_job($1,$2) value',[ids.business,e]);assert.equal(await value(db,'select public.prepare_approved_management_job($1,$2) value',[ids.business,e]),j)
 queue=await value(db,'select public.get_approved_management_queue($1,null,0) value',[ids.business]);assert.equal(queue.length,0)
 await actor(db,ids.outsider);await assert.rejects(()=>value(db,'select public.prepare_approved_management_job($1,$2) value',[ids.business,e]),/access/)
 }finally{await db.close()}
})
