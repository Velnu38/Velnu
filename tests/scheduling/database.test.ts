import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash,randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { fixture,ids,actor,estimate } from './fixture.js'
const hash=(token:string)=>createHash('sha256').update(token).digest('hex')
const day=()=>DateTime.now().setZone('America/New_York').plus({days:14}).startOf('week').plus({days:1}).toISODate()!
async function suggestions(db:any,workers=[ids.owner],duration=120) {
 return (await db.query('select suggest_scheduling_slots($1,$2,$3,$4) r',[ids.business,workers,duration,day()])).rows[0].r
}
async function offer(db:any,e:string,workers=[ids.owner]) {
 const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),request=randomUUID(),slots=(await suggestions(db,workers)).slice(0,3)
 const input={title:'Mow and trim',property_id:ids.site,workers,slots,note:'Please choose a time.',recipient_email:'customer@example.test'}
 const result=(await db.query('select approve_scheduling_offer($1,$2,$3,$4) r',[e,request,input,hash(token)])).rows[0].r
 return {token,request,input,result}
}
test('approved quote -> owner-reviewed offer -> customer booking preserves scope/site/crew and is retry safe',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),o=await offer(db,e)
 assert.equal((await db.query('select count(*)::int n from jobs')).rows[0].n,0)
 const replay=(await db.query('select approve_scheduling_offer($1,$2,$3,$4) r',[e,o.request,o.input,hash(o.token)])).rows[0].r
 assert.equal(replay.id,o.result.id)
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon;")
 const view=(await db.query('select customer_schedule_offer($1) r',[o.token])).rows[0].r
 await assert.rejects(()=>db.query('select customer_schedule_offer($1)',[hash(o.token)]),/unavailable/)
 assert.equal(view.title,'Mow and trim');assert.equal(view.slots.length,3);assert.equal(view.business_id,undefined);assert.equal(view.assigned_user_ids,undefined)
 const slot=view.slots[0].id
 const booked=(await db.query('select customer_schedule_offer($1,$2,$3) r',[o.token,slot,'Test Customer'])).rows[0].r
 assert.equal(booked.status,'booked')
 await db.query('select customer_schedule_offer($1,$2,$3)',[o.token,slot,'Test Customer'])
 await assert.rejects(()=>db.query('select customer_schedule_offer($1,$2,$3)',[o.token,view.slots[1].id,'Test Customer']),/already confirmed/)
 await assert.rejects(()=>db.query('select * from private.scheduling_offers'),/permission denied/)
 await db.exec('reset role')
 const job=(await db.query('select * from jobs')).rows[0] as any
 assert.equal(job.description,'Mow and trim × 2');assert.equal(job.property_id,ids.site);assert.deepEqual(job.assigned_user_ids,[ids.owner]);assert.equal(job.source_estimate_id,e)
 assert.equal((await db.query('select count(*)::int n from appointments')).rows[0].n,1)
 assert.equal((await db.query('select job_id from estimates where id=$1',[e])).rows[0].job_id,job.id)
 }finally{await db.close()}
})
test('availability respects business hours, travel buffer, all required workers and time off',async()=>{
 const db=await fixture();try{
 const slots=await suggestions(db,[ids.owner,ids.worker]);assert.ok(slots.length>0)
 const first=slots[0],e=await estimate(db)
 await db.query('select book_approved_estimate($1,$2)',[e,{title:'Visit',property_id:ids.site,workers:[ids.worker],...first}])
 const workerSlots=await suggestions(db,[ids.worker]);assert.ok(!workerSlots.some((x:any)=>x.starts_at===first.starts_at))
 const ownerSlots=await suggestions(db,[ids.owner]);assert.ok(ownerSlots.some((x:any)=>x.starts_at===first.starts_at))
 await db.query('select manage_worker_time_off($1,$2,$3,$4,$5)',[ids.business,ids.owner,first.starts_at,first.ends_at,'Unavailable'])
 assert.ok(!(await suggestions(db,[ids.owner])).some((x:any)=>x.starts_at===first.starts_at))
 for(const x of await suggestions(db,[ids.owner,ids.worker])) {const local=DateTime.fromISO(x.starts_at).setZone('America/New_York');assert.ok(local.hour>=8&&local.hour<17);assert.ok(local.weekday<=5)}
 }finally{await db.close()}
})
test('stale slots, unapproved/cross-tenant quotes, foreign workers/sites and mismatched retries are denied',async()=>{
 const db=await fixture();try{
 const a=await estimate(db),b=await estimate(db),oa=await offer(db,a),ob=await offer(db,b)
 await db.query('select book_approved_estimate($1,$2)',[a,{...oa.input,...oa.input.slots[0]}])
 const remaining=(await db.query('select customer_schedule_offer($1) r',[ob.token])).rows[0].r
 assert.ok(remaining.slots.length<ob.input.slots.length)
 await assert.rejects(()=>db.query('select approve_scheduling_offer($1,$2,$3,$4)',[b,ob.request,{...ob.input,title:'Changed'},hash(ob.token)]),/different scheduling details/)
 await assert.rejects(()=>suggestions(db,[ids.outsider]),/worker/)
 await actor(db,ids.outsider)
 await assert.rejects(()=>db.query('select get_scheduling_context($1,$2)',[ids.business,b]),/access/)
 await actor(db,ids.worker)
 await assert.rejects(()=>db.query('select approve_scheduling_offer($1,$2,$3,$4)',[b,randomUUID(),ob.input,hash('a'.repeat(64))]),/access/)
 await actor(db,ids.owner)
 const free=(await suggestions(db))[0]
 await assert.rejects(()=>db.query('select book_approved_estimate($1,$2)',[b,{...ob.input,...free,property_id:randomUUID()}]),/address/)
 }finally{await db.close()}
})
test('completion prepares exactly one correctly priced draft invoice, including when a technician completes work',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),slot=(await suggestions(db))[0]
 const booking=(await db.query('select book_approved_estimate($1,$2) r',[e,{title:'Visit',property_id:ids.site,workers:[ids.owner],...slot}])).rows[0].r as any
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role;")
 const done=(await db.query('select complete_job_workflow($1,$2) r',[booking.job_id,ids.worker])).rows[0].r as any
 assert.equal(done.invoice_ready,true);assert.equal(done.invoice_id,null)
 await db.query('select complete_job_workflow($1,$2)',[booking.job_id,ids.worker])
 await db.exec('reset role')
 const invoices=(await db.query('select * from invoices')).rows as any[]
 assert.equal(invoices.length,1);assert.equal(invoices[0].status,'draft');assert.equal(Number(invoices[0].total),105);assert.equal(invoices[0].job_id,booking.job_id)
 assert.equal((await db.query('select status from estimates where id=$1',[e])).rows[0].status,'converted')
 assert.equal((await db.query('select status from appointments')).rows[0].status,'completed')
 }finally{await db.close()}
})
test('forged service calls and direct private-table access cannot complete work or send messages',async()=>{
 const db=await fixture();try{
 await assert.rejects(()=>db.query('select complete_job_workflow($1,$2)',[randomUUID(),ids.owner]),/permission denied/)
 await assert.rejects(()=>db.query('select prepare_scheduling_email($1,$2,$3,$4,$5)',[randomUUID(),ids.owner,randomUUID(),'a'.repeat(64),'https://finviant.com']),/permission denied/)
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon;")
 await assert.rejects(()=>db.query('select get_scheduling_context($1)',[ids.business]),/permission denied/)
 await assert.rejects(()=>db.query('select customer_schedule_offer($1)',['bad-token']),/unavailable/)
 }finally{await db.close()}
})
test('direct job scheduling is atomic, prevents crew overlap, and verifies retried content',async()=>{
 const db=await fixture();try{
 const slot=(await suggestions(db))[0],request=randomUUID()
 const payload={customer_id:ids.customer,property_id:ids.site,title:'Unquoted service',description:'Review work and price after completion',assigned_user_ids:[ids.owner],scheduled_start:slot.starts_at,scheduled_end:slot.ends_at}
 const saved=(await db.query('select create_dispatched_job($1,$2,$3) r',[ids.business,request,payload])).rows[0].r as any
 await db.query('select create_dispatched_job($1,$2,$3)',[ids.business,request,payload])
 await assert.rejects(()=>db.query('select create_dispatched_job($1,$2,$3)',[ids.business,request,{...payload,title:'Different'}]),/different details/)
 await assert.rejects(()=>db.query('select create_dispatched_job($1,$2,$3)',[ids.business,randomUUID(),payload]),/already booked/)
 assert.equal((await db.query('select count(*)::int n from jobs')).rows[0].n,1)
 assert.equal((await db.query('select count(*)::int n from appointments')).rows[0].n,1)
 const invoice=(await db.query('select create_job_invoice($1,$2,$3,$4,$5) r',[saved.id,randomUUID(),[{description:'Completed work',quantity:1,unit_price:125,tax_rate:5}],null,{notes:'Internal review'}])).rows[0].r as any
 assert.equal(Number(invoice.total),131.25)
 const repeated=(await db.query('select create_job_invoice($1,$2,$3) r',[saved.id,randomUUID(),[{description:'Different',quantity:1,unit_price:999,tax_rate:0}]])).rows[0].r as any
 assert.equal(repeated.id,invoice.id);assert.equal(repeated.already_created,true)
 assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,1)
 }finally{await db.close()}
})
test('expired/replaced offers cannot book and customer confirmation reflects a later reschedule or cancellation',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),old=await offer(db,e),next=await offer(db,e)
 await assert.rejects(()=>db.query('select customer_schedule_offer($1)',[old.token]),/replaced/)
 const view=(await db.query('select customer_schedule_offer($1) r',[next.token])).rows[0].r as any
 await db.query('select customer_schedule_offer($1,$2,$3)',[next.token,view.slots[0].id,'Customer'])
 const job=(await db.query('select job_id from estimates where id=$1',[e])).rows[0].job_id
 const later=(await suggestions(db))[0]
 await db.query('select dispatch_job($1,$2,$3,$4)',[job,[ids.owner],later.starts_at,later.ends_at])
 const updated=(await db.query('select customer_schedule_offer($1) r',[next.token])).rows[0].r as any
 assert.equal(Date.parse(updated.confirmed.starts_at),Date.parse(later.starts_at))
 await db.query("update jobs set status='canceled' where id=$1",[job])
 assert.equal(((await db.query('select customer_schedule_offer($1) r',[next.token])).rows[0].r as any).status,'canceled')
 const another=await estimate(db),expired=await offer(db,another)
 await db.exec('reset role')
 await db.query("update private.scheduling_offers set expires_at=now()-interval '1 second' where id=$1",[expired.request])
 await db.exec('set role authenticated')
 await assert.rejects(()=>db.query('select customer_schedule_offer($1)',[expired.token]),/expired/)
 }finally{await db.close()}
})
test('service addresses and worker/module revocation cannot be forged through direct operations',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),offered=await offer(db,e),otherCustomer=(await db.query("insert into customers(business_id,first_name) values($1,'Other customer') returning id",[ids.business])).rows[0].id
 const site=(await db.query("insert into properties(business_id,customer_id,address_line1) values($1,$2,'Other Street') returning id",[ids.business,otherCustomer])).rows[0].id
 await assert.rejects(()=>db.query('update estimates set property_id=$1 where id=$2',[site,e]),/address/)
 await db.exec('reset role')
 await db.query("update business_members set access_modules=array['jobs'] where business_id=$1 and user_id=$2",[ids.business,ids.owner])
 await db.exec('set role authenticated')
 await assert.rejects(()=>suggestions(db),/access/)
 const view=(await db.query('select customer_schedule_offer($1) r',[offered.token])).rows[0].r as any
 await assert.rejects(()=>db.query('select customer_schedule_offer($1,$2,$3)',[offered.token,view.slots[0].id,'Customer']),/review/)
 }finally{await db.close()}
})
test('invoice preparation failure preserves completion and recovers to one draft on a later office retry',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),slot=(await suggestions(db))[0]
 const booking=(await db.query('select book_approved_estimate($1,$2) r',[e,{title:'Visit',property_id:ids.site,workers:[ids.owner],...slot}])).rows[0].r as any
 await db.exec("reset role;create function private.simulated_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'Simulated item failure';end$$;create trigger simulated_failure before insert on invoice_items for each row execute function private.simulated_invoice_failure();select set_config('request.jwt.claim.sub','',false);set role service_role;")
 const failed=(await db.query('select complete_job_workflow($1,$2) r',[booking.job_id,ids.worker])).rows[0].r as any
 assert.equal(failed.status,'completed');assert.equal(failed.invoice_ready,false);assert.equal(failed.needs_review,true)
 await db.exec('reset role;drop trigger simulated_failure on invoice_items;set role service_role;')
 const recovered=(await db.query('select complete_job_workflow($1,$2,true) r',[booking.job_id,ids.owner])).rows[0].r as any
 assert.equal(recovered.invoice_ready,true)
 await db.exec('reset role')
 assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,1)
 }finally{await db.close()}
})
test('scheduling email freezes the reviewed recipient and stale invitations cannot be claimed for delivery',async()=>{
 const db=await fixture();try{
 const e=await estimate(db),o=await offer(db,e),send=randomUUID()
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role;")
 const saved=(await db.query('select prepare_scheduling_email($1,$2,$3,$4,$5) r',[o.request,ids.owner,send,o.token,'https://finviant.com'])).rows[0].r as any
 assert.equal(saved.id,send)
 await db.exec('reset role')
 const payload=(await db.query('select payload from private.finviant_email_outbox where id=$1',[send])).rows[0].payload as any
 assert.deepEqual(payload.to,['customer@example.test']);assert.ok(payload.text.includes('/?booking='+o.token))
 await db.query("update customers set email='changed@example.test' where id=$1",[ids.customer])
 const claim=(await db.query('select claim_document_email($1) r',[send])).rows[0].r as any
 assert.equal(claim.status,'reconciliation_required')
 }finally{await db.close()}
})
