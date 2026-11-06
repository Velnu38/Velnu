import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fixture,plan,user,invoice,B,U,O,C,I} from './fixture'

test('all tier limits are real, private testing is privileged, restore preserves original access',async()=>{const db=await fixture();try{
 const free=await plan(db,'free');assert.equal(free.plan,'free');assert.equal(free.actual_plan,'pro');assert.equal(free.customers_limit,10);assert.equal(free.ai_limit,20);assert.equal(free.voice_limit,10);assert.equal(free.email_limit,0);assert.equal(free.seats_limit,1)
 const individual=await plan(db,'basic');assert.equal(individual.ai_limit,150);assert.equal(individual.voice_limit,60);assert.equal(individual.storage_bytes_limit,2_000_000_000);assert.equal(individual.delivery_mode,'personal');assert.equal(individual.customers_limit,null)
 const pro=await plan(db,'pro');assert.equal(pro.ai_limit,600);assert.equal(pro.voice_limit,180);assert.equal(pro.email_limit,2000);assert.equal(pro.sms_limit,200);assert.equal(pro.seats_limit,5)
 await assert.rejects(()=>plan(db,'enterprise'),/Unknown tier/);await user(db,O);await assert.rejects(()=>db.query('select set_tier_test($1,$2)',[B,'pro']),/authorized primary owner/)
 await user(db);await assert.rejects(()=>db.query('select set_tier_test($1,$2)',[O,'pro']),/authorized primary owner/)
 assert.equal((await plan(db,null)).testing,false);await db.exec('reset role');assert.equal((await db.query<any>('select plan from private.business_entitlements')).rows[0].plan,'pro')
 await db.exec("update private.workspace_feature_flags set enabled=false where name='tier_testing'");await assert.rejects(()=>plan(db,'free'),/authorized primary owner/)
}finally{await db.close()}})

test('Free caps active customers and bookings, allows records and edits after downgrade',async()=>{const db=await fixture();try{
 await plan(db,'free');for(let i=0;i<10;i++)await db.query("insert into customers(business_id,first_name) values($1,$2)",[B,'Customer '+i]);await assert.rejects(()=>db.query("insert into customers(business_id,first_name) values($1,'Over')",[B]),/10 active/)
 const c=(await db.query<any>('select id from customers limit 1')).rows[0].id;await db.query('update customers set archived=true where id=$1',[c]);await db.query("insert into customers(business_id,first_name) values($1,'Replacement')",[B]);await assert.rejects(()=>db.query('update customers set archived=false where id=$1',[c]),/10 active/)
 for(let i=0;i<5;i++)await db.query("insert into jobs(business_id,title,status,scheduled_start,scheduled_end) values($1,'Job','scheduled',now(),now()+interval '1 hour')",[B]);await assert.rejects(()=>db.query("insert into jobs(business_id,title,status,scheduled_start,scheduled_end) values($1,'Over','scheduled',now(),now()+interval '1 hour')",[B]),/5 new job/)
 await db.query("update jobs set scheduled_start=now()+interval '2 days',scheduled_end=now()+interval '2 days 1 hour' where business_id=$1",[B]);assert.equal((await plan(db,'free')).jobs_used,5)
 await plan(db,'basic');await db.query("insert into customers(business_id,first_name) values($1,'More')",[B]);await plan(db,'free');assert.equal((await db.query('select * from customers')).rows.length,12);await db.query("update customers set notes='Still editable' where business_id=$1",[B])
 for(let i=0;i<12;i++)await db.query("insert into invoices(business_id,customer_id,status) values($1,$2,'draft')",[B,c]);assert.equal((await db.query('select * from invoices')).rows.length,12)
}finally{await db.close()}})

test('atomic metering, idempotent retry, lifetime intro, downgrade cannot reset usage',async()=>{const db=await fixture();try{
 await plan(db,'free');const id=crypto.randomUUID();await db.query("select reserve_tier_request($1,$2,'ai',1)",[B,id]);await db.query("select reserve_tier_request($1,$2,'ai',1)",[B,id]);assert.equal((await plan(db,'free')).ai_used,1)
 await Promise.all(Array.from({length:19},()=>db.query("select reserve_tier_request($1,$2,'ai',1)",[B,crypto.randomUUID()])));await assert.rejects(()=>db.query("select reserve_tier_request($1,$2,'ai',1)",[B,crypto.randomUUID()]),/allowance reached/)
 await plan(db,'pro');await db.query("select reserve_tier_request($1,$2,'ai',1)",[B,crypto.randomUUID()]);assert.equal((await plan(db,'free')).ai_used,20)
 await assert.rejects(()=>db.query("select reserve_tier_request($1,$2,'email',1)",[B,crypto.randomUUID()]),/access denied/)
 await db.exec('set role anon');await assert.rejects(()=>db.query("select reserve_tier_request($1,$2,'ai',1)",[B,crypto.randomUUID()]),/permission denied/)
}finally{await db.close()}})

test('personal setup validates channels, customer link never records a send, explicit confirmation is scoped',async()=>{const db=await fixture();try{
 await invoice(db);await plan(db,'free');await assert.rejects(()=>db.query('select save_delivery_setup($1,$2,$3,true,true,true)',[B,'bad','123']),/valid email/)
 await db.query('select save_delivery_setup($1,$2,$3,true,true,true)',[B,'owner@example.test','+17575550123']);const token='a'.repeat(64)
 await db.query("select prepare_personal_document($1,'invoice',$2,$3)",[B,I,token]);assert.equal((await db.query<any>('select status from invoices')).rows[0].status,'draft');assert.equal((await db.query('select * from messages')).rows.length,0)
 await db.exec('set role anon');const shared=(await db.query<any>('select get_shared_document($1) d',[token])).rows[0].d;assert.equal(shared.total,100);assert.equal(shared.notes,undefined);assert.equal(shared.customer.name,'Jordan')
 await assert.rejects(()=>db.query('select get_shared_document($1)',['b'.repeat(64)]),/expired or unavailable/)
 await user(db,O);await assert.rejects(()=>db.query("select confirm_personal_document_sent($1,$2,'email')",[B,token]),/Not authorized/)
 await user(db);await db.query("select confirm_personal_document_sent($1,$2,'email')",[B,token]);await db.query("select confirm_personal_document_sent($1,$2,'email')",[B,token]);assert.equal((await db.query('select * from messages')).rows.length,1);assert.equal((await db.query<any>('select status from invoices')).rows[0].status,'sent')
 await db.query("update invoices set total=150 where id=$1",[I]);await assert.rejects(()=>db.query('select get_shared_document($1)',[token]),/changed/)
}finally{await db.close()}})

test('managed email is Pro-only, activation-gated, quotas count once and retries recheck downgrade',async()=>{const db=await fixture();try{
 await invoice(db);await plan(db,'basic');await db.exec('reset role');await assert.rejects(()=>db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,crypto.randomUUID()]),/PAID_FEATURE/)
 await plan(db,'pro');await db.exec('reset role');await assert.rejects(()=>db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,crypto.randomUUID()]),/activated Finviant email/)
 await db.query('insert into private.managed_delivery_accounts(business_id,email_active) values($1,true)',[B]);const request=crypto.randomUUID();await db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,request]);await db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,request]);assert.equal((await plan(db,'pro')).email_used,1)
 await plan(db,'free');await db.exec('reset role');assert.equal((await db.query<any>('select claim_document_email($1) s',[request])).rows[0].s.status,'reconciliation_required')
 await db.exec('set role authenticated');await assert.rejects(()=>db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,crypto.randomUUID()]),/permission denied/)
}finally{await db.close()}})

test('managed SMS reserves segments once, prevents duplicate provider calls and honors opt-out',async()=>{const db=await fixture();try{
 await invoice(db);await plan(db,'pro');const token='c'.repeat(64),request=crypto.randomUUID(),number='+17575550123';await db.query("select prepare_personal_document($1,'invoice',$2,$3)",[B,I,token]);await db.exec('reset role');
 await db.query("insert into private.managed_delivery_accounts(business_id,sms_active,sms_from,sms_reply_route) values($1,true,'+17575550999','Finviant inbox')",[B]);
 const prepare=()=>db.query<any>("select prepare_managed_sms($1,$2,'invoice',$3,$4,$5,$6) s",[U,B,I,request,token,number]);await assert.rejects(prepare,/permission is required/)
 await user(db);await db.query('select record_sms_permission($1,$2,true)',[B,number]);await db.exec('reset role');const prepared=(await prepare()).rows[0].s;assert.ok(prepared.segments>=2);await prepare();assert.equal((await plan(db,'pro')).sms_used,prepared.segments)
 await db.exec('reset role');assert.equal((await db.query<any>('select claim_managed_sms($1) s',[request])).rows[0].s.status,'claimed');assert.equal((await db.query<any>('select claim_managed_sms($1) s',[request])).rows[0].s.status,'sending');
 const sid='SM'+'a'.repeat(32);await db.query("select finish_managed_sms($1,'delivered',$2)",[request,sid]);await db.query("select finish_managed_sms($1,'accepted',$2)",[request,sid]);assert.equal((await db.query<any>('select status from private.managed_sms')).rows[0].status,'delivered');assert.equal((await db.query('select * from messages')).rows.length,1)
 await db.query("select record_managed_sms_inbound($1,'+17575550999','STOP',$2)",[number,'SM'+'b'.repeat(32)]);await user(db);await assert.rejects(()=>db.query('select record_sms_permission($1,$2,true)',[B,number]),/opted out/)
 await db.exec('set role anon');await assert.rejects(()=>db.query('select claim_managed_sms($1)',[request]),/permission denied/)
}finally{await db.close()}})

test('scheduled sending freezes the review, rechecks downgrade and reminders are opt-in',async()=>{const db=await fixture();try{
 await invoice(db);await plan(db,'pro');await assert.rejects(()=>db.query('select save_reminder_rule($1,true,3,7,3)',[B]),/activated Finviant email/)
 await db.exec('reset role');await db.query('insert into private.managed_delivery_accounts(business_id,email_active) values($1,true)',[B]);await user(db);const id=crypto.randomUUID(),due=new Date(Date.now()+3600000).toISOString();await db.query("select schedule_document_email($1,'invoice',$2,$3,$4)",[B,I,id,due]);await db.query("select schedule_document_email($1,'invoice',$2,$3,$4)",[B,I,id,due]);await db.exec('reset role');assert.equal((await db.query('select * from private.delivery_tasks')).rows.length,1)
 await db.query("update private.delivery_tasks set due_at=now()-interval '1 second' where id=$1",[id]);await plan(db,'free');await db.exec('reset role');await db.query('select prepare_due_delivery_tasks()');assert.equal((await db.query<any>('select status from private.delivery_tasks')).rows[0].status,'blocked');assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,0)
 await plan(db,'pro');await db.query('select save_reminder_rule($1,true,3,7,3)',[B]);await db.exec('reset role');await db.query("update invoices set status='sent' where id=$1",[I]);const result=(await db.query<any>('select prepare_due_delivery_tasks() n')).rows[0].n;assert.equal(result,1);assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,1);await db.query('select prepare_due_delivery_tasks()');assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,1)
 await user(db,O);await assert.rejects(()=>db.query('select save_reminder_rule($1,true,3,7,3)',[B]),/Owner access/)
}finally{await db.close()}})

for(const status of ['void','paid'])test(`queued email and SMS stop when invoice becomes ${status}`,async()=>{const db=await fixture();try{
 await invoice(db);await plan(db,'pro');await db.exec('reset role');await db.query("insert into private.managed_delivery_accounts(business_id,email_active,sms_active,sms_from,sms_reply_route) values($1,true,true,'+17575550999','Finviant inbox')",[B]);
 const emailRequest=crypto.randomUUID(),smsRequest=crypto.randomUUID(),token='d'.repeat(64);await db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,emailRequest]);
 await user(db);await db.query("select prepare_personal_document($1,'invoice',$2,$3)",[B,I,token]);await db.query("select record_sms_permission($1,'+17575550123',true)",[B]);await db.exec('reset role');await db.query("select prepare_managed_sms($1,$2,'invoice',$3,$4,$5,'+17575550123')",[U,B,I,smsRequest,token]);
 await db.query('update invoices set status=$1 where id=$2',[status,I]);assert.equal((await db.query<any>('select claim_document_email($1) s',[emailRequest])).rows[0].s.status,'reconciliation_required');assert.equal((await db.query<any>('select claim_managed_sms($1) s',[smsRequest])).rows[0].s.status,'blocked');
}finally{await db.close()}})
