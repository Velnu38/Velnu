import assert from 'node:assert/strict'
import test from 'node:test'
import {journeyFixture,B,C,I,J,O,U,W,invoice,user,value} from './journey-fixture.ts'
const R='aaaaaaaa-0000-4000-8000-000000000001',E='aaaaaaaa-0000-4000-8000-000000000002'
const work=(db:any)=>value(db,'select public.get_job_management($1,$2) value',[B,J])
const history=(db:any,job:string|null=J,inv:string|null=null,page=0)=>value(db,'select public.get_workflow_activity($1,$2,$3,$4) value',[B,job,inv,page])
test('canonical facts advance with the existing job, visit, checklist, scope and final invoice; mutations return the same facts',async()=>{
 const db=await journeyFixture();try{
  await invoice(db);await db.query('update public.invoices set job_id=$1 where id=$2',[J,I]);await user(db)
  let data=await work(db);assert.equal(data.journey.workStatus,'lead');assert.equal(data.journey.billingVisible,true);assert.equal(data.journey.invoice.id,I)
  data=await value(db,'select public.manage_job_management($1,$2,$3,$4) value',[B,J,'save_material',JSON.stringify({id:R,version:0,name:'Sand',quantity:2,status:'needed'})]);assert.equal(data.journey.missingMaterials,1)
  await db.exec('reset role');await db.query("insert into public.appointments(id,business_id,job_id,customer_id,starts_at,ends_at) values($1,$2,$3,$4,now()+interval '1 day',now()+interval '1 day 1 hour')",[E,B,J,C]);await db.query("update public.jobs set status='in_progress' where id=$1",[J]);await user(db)
  data=await work(db);assert.equal(data.journey.hasVisit,true);assert.equal(data.journey.remainingVisits,1);assert.equal(data.journey.workStatus,'in_progress')
  assert.deepEqual((await history(db)).items.map((e:any)=>e.kind).sort(),['appointment_booked','work_started'])
 }finally{await db.close()}
})
test('workflow access hides financial events/facts from staff and denies other tenants, anonymous callers and private table reads',async()=>{
 const db=await journeyFixture();try{
  await invoice(db);await db.query('update public.invoices set job_id=$1 where id=$2',[J,I]);await db.query("update public.jobs set status='in_progress' where id=$1",[J]);await db.query('update public.invoices set amount_paid=10 where id=$1',[I])
  await db.query("update public.business_members set role='technician',access_modules=array['jobs','billing'] where user_id=$1",[O]);await user(db,O)
  const data=await work(db);assert.equal(data.journey.billingVisible,false);assert.equal(data.journey.invoice,null);assert.equal(data.journey.estimateId,null);assert.equal(data.journey.depositInvoiceId,null)
  assert.deepEqual((await history(db)).items.map((e:any)=>e.kind),['work_started'])
  await assert.rejects(()=>history(db,null,I),/Invoice access/);await assert.rejects(()=>db.query('select * from private.workflow_events'),/permission/)
  await assert.rejects(()=>value(db,'select public.get_workflow_activity($1,$2) value',[R,J]),/access/)
  await user(db,W);await assert.rejects(()=>history(db),/access/)
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon");await assert.rejects(()=>history(db),/permission/)
 }finally{await db.close()}
})
test('issued invoice opens are capability validated, revision deduplicated, and never downgrade partial or settled invoices',async()=>{
 const db=await journeyFixture();try{
  await invoice(db);await db.query("update public.invoices set status='sent',job_id=$1 where id=$2",[J,I]);const token='a'.repeat(64)
  await db.query('select private.create_document_share($1,$2,$3,$4,$5)',[U,B,'invoice',I,token])
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon")
  assert.equal((await value(db,'select public.record_customer_invoice_open($1) value',[token])).recorded,true)
  await value(db,'select public.record_customer_invoice_open($1) value',[token]);await assert.rejects(()=>value(db,'select public.record_customer_invoice_open($1) value',['b'.repeat(64)]),/unavailable/)
  await db.exec('reset role');assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'viewed');assert.equal(await value(db,"select count(*)::int value from private.workflow_events where kind='invoice_opened'"),1)
  for(const status of ['partial','paid']){await db.query('update public.invoices set status=$1 where id=$2',[status,I]);await value(db,'select public.record_customer_invoice_open($1) value',[token]);assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),status)}
  await db.query("update public.invoices set status='sent',customer_message='Updated payment instructions' where id=$1",[I]);await db.query('select private.publish_document_version($1,$2,$3,$4)',[U,B,'invoice',I]);await value(db,'select public.record_customer_invoice_open($1) value',[token]);assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'sent','opening a superseded revision cannot mark the current invoice viewed')
  await db.query("update private.document_shares set expires_at=now()-interval '1 second'");assert.equal((await value(db,'select public.record_customer_invoice_open($1) value',[token])).recorded,false)
  await db.query('update private.document_shares set revoked_at=now()');await assert.rejects(()=>value(db,'select public.record_customer_invoice_open($1) value',[token]),/revoked|unavailable/)
  const events=await db.query<{facts:any}>('select facts from private.workflow_events');assert.ok(events.rows.every(e=>!JSON.stringify(e.facts).includes(token)))
 }finally{await db.close()}
})
test('pending and review-required provider operations hold automatic reminders; settlement cancels queued reminders without altering an in-flight outcome',async()=>{
 const db=await journeyFixture();try{
  await invoice(db);await db.query("update public.invoices set status='sent',job_id=$1,due_date=current_date-30 where id=$2",[J,I]);await db.query("insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test')",[B]);await db.query('insert into private.reminder_rules(business_id,actor_id,enabled,after_days,repeat_days,max_reminders) values($1,$2,true,2,7,3)',[B,U])
  const eligible=()=>value(db,'select private.invoice_automatic_reminder_eligible($1,$2,$3) value',[B,I,U]);assert.equal(await eligible(),true)
  await db.query("insert into private.customer_invoice_checkouts(business_id,invoice_id,revision_id,token_hash,request_id,stripe_account_id,livemode,amount_minor,currency,status) values($1,$2,$3,$4,$3,'acct_test',false,10000,'usd','pending')",[B,I,R,'a'.repeat(64)]);assert.equal(await eligible(),false)
  await db.exec("update private.customer_invoice_checkouts set status='review_required'");assert.equal(await eligible(),false);await db.exec("update private.customer_invoice_checkouts set status='expired'");assert.equal(await eligible(),true)
  await db.query("insert into private.square_invoice_operations(business_id,invoice_id,request_id,kind,environment,merchant_id,location_id,amount_minor,currency,invoice_total,status) values($1,$2,$3,'online','sandbox','fixture-merchant','fixture-location',10000,'USD',100,'pending')",[B,I,R]);assert.equal(await eligible(),false);await db.exec("update private.square_invoice_operations set status='canceled'");assert.equal(await eligible(),true)
  await db.query("insert into private.delivery_tasks(id,business_id,actor_id,kind,document_id,due_at,reminder,status) values($1,$2,$3,'invoice',$4,now(),true,'queued')",[R,B,U,I]);await db.query(`insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,status) values($1,$2,$3,'invoice',$4,'{"to":["jordan@example.test"]}','queued'),($5,$2,$3,'invoice',$4,'{"to":["jordan@example.test"]}','sending')`,[R,B,U,I,E])
  await db.query("insert into public.payments(business_id,invoice_id,amount,method,status,paid_at) values($1,$2,100,'cash','succeeded',now())",[B,I]);assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'paid');assert.equal(await value(db,'select status value from private.delivery_tasks where id=$1',[R]),'canceled');assert.equal(await value(db,'select status value from private.finviant_email_outbox where id=$1',[R]),'reconciliation_required');assert.equal(await value(db,'select status value from private.finviant_email_outbox where id=$1',[E]),'sending')
  await user(db);assert.equal((await history(db,null,I)).items.filter((e:any)=>e.kind==='payment_received').length,1)
 }finally{await db.close()}
})
test('worker rows share one visit event, canceling one crew member does not cancel the visit, and history is bounded and paginated',async()=>{
 const db=await journeyFixture();try{
  await db.query("insert into public.appointments(id,business_id,job_id,customer_id,starts_at,ends_at,status) values($1,$3,$4,$5,now()+interval '1 day',now()+interval '25 hours','confirmed'),($2,$3,$4,$5,now()+interval '1 day',now()+interval '25 hours','confirmed')",[R,E,B,J,C]);await user(db)
  assert.equal((await history(db)).items.filter((e:any)=>e.kind==='appointment_booked').length,1)
  await db.exec('reset role');await db.query("update public.appointments set status='canceled' where id=$1",[R]);await user(db);assert.equal((await history(db)).items.filter((e:any)=>e.kind==='appointment_canceled').length,0)
  await db.exec('reset role');await db.query("update public.appointments set status='canceled' where id=$1",[E]);await user(db);assert.equal((await history(db)).items.filter((e:any)=>e.kind==='appointment_canceled').length,1)
  await db.exec('reset role');await db.query("insert into private.workflow_events(business_id,job_id,kind,event_key,created_at) select $1,$2,'work_started','page-'||n,now()-n*interval '1 hour' from generate_series(1,28)n",[B,J]);await user(db)
  const first=await history(db),second=await history(db,J,null,1);assert.equal(first.items.length,25);assert.equal(first.total,30);assert.equal(second.items.length,5);assert.equal(new Set([...first.items,...second.items].map(e=>e.id)).size,30);assert.ok(first.items.every((e:any)=>!('facts'in e)))
  await assert.rejects(()=>history(db,J,null,-1),/access/)
  await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from private.owner_archive_sources($1,$2)',[B,U]),30);assert.equal(await value(db,'select count(*)::int value from private.owner_archive_sources($1,$2)',[R,U]),0)
 }finally{await db.close()}
})
