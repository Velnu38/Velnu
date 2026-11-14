import assert from 'node:assert/strict'
import test from 'node:test'
import {journeyFixture,B,C,I,J,U,O,user,invoice,value} from './journey-fixture.ts'
const A='aaaaaaaa-0000-4000-8000-000000000041'
async function ready(db:any){await db.exec('reset role');await invoice(db);await db.query("insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test')",[B])}
const settings=(db:any)=>value(db,'select public.get_journey_notice_settings($1) value',[B])
const save=(db:any,booking:boolean,receipt:boolean,version=0)=>value(db,'select public.save_journey_notice_settings($1,$2,$3,$4) value',[B,booking,receipt,version])
async function book(db:any){await db.exec('reset role');await db.query("insert into public.appointments(id,business_id,job_id,customer_id,starts_at,ends_at,status) values($1,$2,$3,$4,now()+interval '2 hours',now()+interval '3 hours','confirmed')",[A,B,J,C])}
test('new notification policies start off, require the primary owner, and enable future events without a historical backfill',async()=>{
 const db=await journeyFixture(true);try{
  await ready(db);await user(db);assert.equal((await settings(db)).booking_confirmation,false);assert.equal((await settings(db)).payment_receipt,false)
  await book(db);assert.equal(await value(db,'select count(*)::int value from private.journey_notices'),0)
  await user(db,O);await assert.rejects(()=>save(db,true,true),/Primary owner/);await user(db);await save(db,true,true);await assert.rejects(()=>save(db,false,false),/changed/)
  await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from private.journey_notices'),0)
  await db.query("update public.appointments set status='canceled' where id=$1",[A]);await db.query("update public.appointments set status='confirmed' where id=$1",[A]);assert.equal(await value(db,'select count(*)::int value from private.journey_notices'),1)
  assert.equal(await value(db,'select public.prepare_due_journey_notices() value'),1);assert.equal(await value(db,'select public.prepare_due_journey_notices() value'),0)
  assert.equal(await value(db,"select count(*)::int value from private.finviant_email_outbox where document_kind='journey_notice'"),1)
  const id=await value(db,'select id value from private.journey_notices');await user(db);let history=await value(db,'select public.get_workflow_activity($1,$2) value',[B,J]);assert.equal(history.items.find((e:any)=>e.id===id).notice.status,'queued')
  await db.exec('reset role');const claimed=await value(db,'select public.claim_document_email($1,true) value',[id]);assert.equal(claimed.status,'claimed');assert.equal(claimed.payload.to[0],'jordan@example.test');assert.equal((await value(db,'select public.claim_document_email($1,true) value',[id])).status,'busy');assert.equal(await value(db,'select attempts value from private.finviant_email_outbox where id=$1',[id]),1)
  await db.query("update public.business_members set role='technician',access_modules=array['jobs'] where user_id=$1",[O]);await user(db,O);history=await value(db,'select public.get_workflow_activity($1,$2) value',[B,J]);assert.ok(history.items.every((e:any)=>!e.notice))
 }finally{await db.close()}
})
test('queued confirmations cannot send stale recipients or disabled policies; uncertain operations are never blindly reclaimed',async()=>{
 const db=await journeyFixture(true);try{
  await ready(db);await user(db);await save(db,true,false);await book(db);await value(db,'select public.prepare_due_journey_notices() value')
  const id=await value(db,'select id value from private.journey_notices');await db.query("update public.customers set email='changed@example.test' where id=$1",[C]);assert.equal((await value(db,'select public.claim_document_email($1,true) value',[id])).status,'reconciliation_required')
  await db.query("update private.finviant_email_outbox set status='uncertain' where id=$1",[id]);assert.equal((await value(db,'select public.claim_document_email($1,true) value',[id])).status,'uncertain');assert.equal(await value(db,'select attempts value from private.finviant_email_outbox where id=$1',[id]),0)
  await db.query("update public.customers set email='jordan@example.test' where id=$1",[C]);await db.query("update private.finviant_email_outbox set status='queued' where id=$1",[id]);await user(db);await save(db,false,false,1);await db.exec('reset role');assert.equal((await value(db,'select public.claim_document_email($1,true) value',[id])).status,'reconciliation_required')
 }finally{await db.close()}
})
test('a posted payment queues one receipt; refunded or otherwise changed funds block the old receipt without reopening work',async()=>{
 const db=await journeyFixture(true);try{
  await ready(db);await user(db);await save(db,false,true);await db.exec('reset role');await db.query("update public.invoices set status='sent',job_id=$1 where id=$2",[J,I]);await db.query("update public.jobs set status='completed' where id=$1",[J]);await db.query("insert into public.payments(business_id,invoice_id,amount,status,paid_at,method) values($1,$2,100,'succeeded',now(),'cash')",[B,I]);assert.equal(await value(db,'select public.prepare_due_journey_notices() value'),1)
  const id=await value(db,'select id value from private.journey_notices');assert.match(await value(db,"select payload->>'text' value from private.finviant_email_outbox where id=$1",[id]),/This invoice is paid/)
  await db.query("update public.payments set status='refunded' where invoice_id=$1",[I]);assert.equal((await value(db,'select public.claim_document_email($1,true) value',[id])).status,'reconciliation_required');assert.equal(await value(db,'select status value from public.jobs where id=$1',[J]),'completed')
 }finally{await db.close()}
})
test('reschedule notices require exact review, use one durable event identity and retain actual delivery state on retry',async()=>{
 const db=await journeyFixture(true);try{
  await ready(db);await book(db);await db.query("update public.appointments set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",[A]);const id=await value(db,"select id value from private.workflow_events where kind='appointment_changed'")
  await user(db);const review=await value(db,'select public.review_journey_notice($1,$2) value',[B,id]);assert.equal(review.eligible,true);assert.match(review.snapshot.payload.text,/new appointment time/)
  await assert.rejects(()=>value(db,'select public.queue_reviewed_journey_notice($1,$2,$3) value',[B,id,{}]),/changed/)
  await value(db,'select public.queue_reviewed_journey_notice($1,$2,$3) value',[B,id,review.snapshot]);await value(db,'select public.queue_reviewed_journey_notice($1,$2,$3) value',[B,id,review.snapshot])
  await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from private.finviant_email_outbox'),1);await db.query("update private.finviant_email_outbox set status='accepted' where id=$1",[id]);await user(db);assert.equal((await value(db,'select public.queue_reviewed_journey_notice($1,$2,$3) value',[B,id,review.snapshot])).status,'accepted')
  await user(db,O);await assert.rejects(()=>value(db,'select public.queue_reviewed_journey_notice($1,$2,$3) value',[B,id,review.snapshot]),/Another authorized/)
  await db.exec("reset role;set role anon");await assert.rejects(()=>value(db,'select public.review_journey_notice($1,$2) value',[B,id]),/permission/)
 }finally{await db.close()}
})
test('two payments in one atomic request retain both events and prepare only a current cumulative receipt',async()=>{
 const db=await journeyFixture(true);try{
  await ready(db);await user(db);await save(db,false,true);await db.exec('reset role');await db.query("update public.invoices set status='sent',job_id=$1 where id=$2",[J,I]);await db.exec('begin')
  for(const amount of [40,60])await db.query("insert into public.payments(business_id,invoice_id,amount,status,paid_at,method) values($1,$2,$3,'succeeded',now(),'cash')",[B,I,amount]);await db.exec('commit')
  assert.equal(await value(db,"select count(*)::int value from private.workflow_events where kind='payment_received'"),2)
  assert.equal(await value(db,'select public.prepare_due_journey_notices() value'),1)
  assert.equal(await value(db,"select count(*)::int value from private.finviant_email_outbox where document_kind='journey_notice'"),1)
  assert.match(await value(db,"select payload->>'text' value from private.finviant_email_outbox where document_kind='journey_notice'"),/Remaining balance: USD 0/)
 }finally{await db.close()}
})
