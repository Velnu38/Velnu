import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',OTHER='11111111-1111-4111-8111-111111111112',U='22222222-2222-4222-8222-222222222222',I='33333333-3333-4333-8333-333333333333'
const sql=await readFile('supabase/migrations/20261109222000_invoice_reminder_overrides.sql','utf8')
// Reuse one instance to keep this sequential synthetic suite memory bounded.
const db=new PGlite()
const ready=db.exec('create role anon;create role authenticated;create role service_role;')
after(async()=>{await db.close()})
async function fixture(){
 await ready
 await db.exec("set test.access='true';set test.owner='true';set test.plan='pro'")
 await db.exec('drop schema if exists private cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;')
 await db.exec(`create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${U}'::uuid$$;
 create function private.fin_access(uuid,text,boolean) returns boolean language sql as $$select $1='${B}'::uuid and coalesce(current_setting('test.access',true),'true')='true'$$;
 create function private.is_primary_owner(uuid,uuid) returns boolean language sql as $$select coalesce(current_setting('test.owner',true),'true')='true'$$;
 create function private.effective_plan(uuid) returns text language sql as $$select coalesce(current_setting('test.plan',true),'pro')$$;
 create table businesses(id uuid primary key,timezone text);insert into businesses values('${B}','UTC'),('${OTHER}','UTC');
 create table customers(id uuid primary key,business_id uuid not null references businesses(id),archived boolean not null default false,preferred_contact text);
 insert into customers(id,business_id) values('${U}','${B}');
 create table invoices(id uuid primary key,business_id uuid,customer_id uuid references customers(id),status text,balance_due numeric,due_date date);
 insert into invoices values('${I}','${B}','${U}','sent',100,current_date-2);
 create table private.reminder_rules(business_id uuid primary key,actor_id uuid,enabled boolean,after_days int,repeat_days int,max_reminders int);
 insert into private.reminder_rules values('${B}','${U}',true,2,7,3);
 create table private.managed_delivery_accounts(business_id uuid,email_active boolean);insert into private.managed_delivery_accounts values('${B}',true);
 create table private.delivery_tasks(id uuid primary key default gen_random_uuid(),business_id uuid,actor_id uuid,kind text,document_id uuid,due_at timestamptz,snapshot jsonb,reminder boolean default false,status text default 'scheduled',last_error text,created_at timestamptz default now());
 create table private.finviant_email_outbox(id uuid primary key,business_id uuid,document_id uuid,status text default 'queued',provider_id text,payload jsonb default '{"to":["synthetic@example.test"]}',last_code text);
 create function private.invoice_reminder_review(uuid,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb) returns void language sql as $$insert into private.finviant_email_outbox(id,business_id,document_id) values($4,$2,$3)$$;
 create function private.customer_document_snapshot(uuid,text,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text) returns void language sql as $$select$$;
 create function public.claim_document_email(p_request uuid,p_pdf_capable boolean) returns jsonb language sql as $$select jsonb_build_object('status',case when p_pdf_capable then 'claimed' else 'pdf_artifact_required' end,'wrapped',true)$$;
 create function public.claim_document_email(p_request uuid) returns jsonb language sql as $$select public.claim_document_email(p_request,false)$$;
 `)
 await db.exec(sql);return db
}
async function get(){return (await db.query<{v:any}>(`select public.get_invoice_reminder_preference('${B}','${I}') v`)).rows[0].v}
async function save(mode='custom',after=5,repeat=9,max=2){return db.query(`select public.save_invoice_reminder_preference('${B}','${I}',$1,$2,$3,$4)`,[mode,after,repeat,max])}
async function schedule(){return (await db.query<{n:number}>('select public.prepare_due_delivery_tasks() n')).rows[0].n}
async function claim(id:string,pdf=true){return (await db.query<{v:any}>('select public.claim_document_email($1,$2) v',[id,pdf])).rows[0].v}
async function task(){return (await db.query<{id:string}>('select id from private.delivery_tasks limit 1')).rows[0].id}

test('inheritance is non-mutating; custom timing survives changed defaults and cannot enable master',async()=>{
 await fixture();assert.equal((await get()).mode,'inherit');assert.equal((await get()).after_days,2)
 assert.equal((await db.query('select * from private.invoice_reminder_preferences')).rows.length,0)
 await save();await db.exec('update private.reminder_rules set after_days=12,enabled=false')
 const v=await get();assert.equal(v.after_days,5);assert.equal(v.defaults.after_days,12);assert.equal(v.master_enabled,false)
 assert.equal(await schedule(),0);assert.equal((await db.query('select * from private.delivery_tasks')).rows.length,0)
})
test('billing managers only; cross-business and invalid invoice/timing requests rejected',async()=>{
 await fixture();await db.exec("set test.access='false'");await assert.rejects(get(),/Billing management/);await assert.rejects(save(),/Billing management/)
 await db.exec("set test.access='true'");await assert.rejects(db.query(`select public.save_invoice_reminder_preference('${B}','${U}','off',2,7,3)`),/Invoice unavailable/)
 await assert.rejects(db.query(`select public.get_invoice_reminder_preference('${OTHER}','${I}')`),/Billing management/)
 for(const [mode,a,r,m] of [['bad',2,7,3],['custom',0,7,3],['custom',2,2,3],['custom',2,7,6]] as const)await assert.rejects(save(mode,a,r,m),/valid invoice reminder timing/)
 assert.equal((await db.query('select * from private.invoice_reminder_preferences')).rows.length,0)
})
test('custom delay/repeat/max, off, inheritance and deduplication are applied',async()=>{
 await fixture();await save('off');assert.equal(await schedule(),0)
 await save('custom',5,9,2);assert.equal(await schedule(),0)
 await db.exec('update invoices set due_date=current_date-5');assert.equal(await schedule(),1);assert.equal(await schedule(),0)
 await db.exec("update private.delivery_tasks set created_at=now()-interval '8 days'");assert.equal(await schedule(),0)
 await db.exec("update private.delivery_tasks set created_at=now()-interval '10 days'");assert.equal(await schedule(),1)
 await db.exec("update private.delivery_tasks set created_at=now()-interval '10 days'");assert.equal(await schedule(),0)
 await save('inherit');assert.equal(await schedule(),1)
})
test('business-local dates apply at both date-line extremes',async()=>{
 for(const zone of ['Etc/GMT+12','Pacific/Kiritimati']){
  await fixture();await db.query('update businesses set timezone=$1 where id=$2',[zone,B])
  await db.query(`update invoices set due_date=(now() at time zone $1)::date-1`,[zone]);assert.equal(await schedule(),0)
  await db.query(`update invoices set due_date=(now() at time zone $1)::date-2`,[zone]);assert.equal(await schedule(),1)
 }
})
test('paid/draft/void, zero balance, no due date, disabled sender and downgraded plan excluded',async()=>{
 await fixture();for(const status of ['paid','draft','void']){await db.query('update invoices set status=$1',[status]);assert.equal(await schedule(),0)}
 await db.exec("update invoices set status='sent',balance_due=0");assert.equal(await schedule(),0)
 await db.exec('update invoices set balance_due=100,due_date=null');assert.equal(await schedule(),0)
 await db.exec('update invoices set due_date=current_date-20;update private.managed_delivery_accounts set email_active=false');assert.equal(await schedule(),0)
 await db.exec("update private.managed_delivery_accounts set email_active=true;set test.plan='basic'");assert.equal(await schedule(),0)
})
test('queued claims recheck master/off while manual and PDF wrappers remain intact',async()=>{
 for(const pause of ['master','invoice']){
  await fixture();assert.equal(await schedule(),1);const id=await task();assert.equal((await claim(id,false)).status,'pdf_artifact_required')
  if(pause==='master')await db.exec('update private.reminder_rules set enabled=false');else await save('off')
  assert.equal((await claim(id)).status,'reconciliation_required')
  assert.equal((await db.query<{status:string}>('select status from private.delivery_tasks')).rows[0].status,'canceled')
  assert.equal((await claim(U)).wrapped,true);assert.equal((await claim(U,false)).status,'pdf_artifact_required')
 }
})
test('accepted, delivered and uncertain attempts are never reset by changed preferences',async()=>{
 await fixture();await schedule();const id=await task();await save('off')
 for(const status of ['accepted','delivered','uncertain']){
  await db.query('update private.finviant_email_outbox set status=$1',[status]);assert.equal((await claim(id)).status,status)
  assert.equal((await db.query<{status:string}>('select status from private.finviant_email_outbox')).rows[0].status,status)
  assert.equal((await db.query<{status:string}>('select status from private.delivery_tasks')).rows[0].status,'queued')
 }
})
test('queued claims recheck custom/default delay, repeat, max and current primary owner',async()=>{
 for(const change of ['delay','default-delay','repeat','max','owner']){
  await fixture()
  if(change==='repeat'||change==='max')await db.exec(`insert into private.delivery_tasks(business_id,actor_id,kind,document_id,due_at,reminder,status,created_at) values('${B}','${U}','invoice','${I}',now()-interval '8 days',true,'queued',now()-interval '8 days')`)
  assert.equal(await schedule(),1);const id=(await db.query<{id:string}>('select id from private.finviant_email_outbox')).rows[0].id
  if(change==='default-delay')await db.exec('update private.reminder_rules set after_days=12')
  if(change==='delay')await save('custom',10,7,3)
  if(change==='repeat')await save('custom',2,10,3)
  if(change==='max')await save('custom',2,7,1)
  if(change==='owner')await db.exec("set test.owner='false'")
  assert.equal((await claim(id)).status,'reconciliation_required');assert.equal(await schedule(),0)
 }
})
test('function grants expose only intended RPCs and service entry point',async()=>{
 await fixture();const allowed=async(role:string,fn:string)=>(await db.query<{v:boolean}>('select has_function_privilege($1,$2,\'execute\') v',[role,fn])).rows[0].v
 for(const fn of ['public.get_invoice_reminder_preference(uuid,uuid)','public.save_invoice_reminder_preference(uuid,uuid,text,integer,integer,integer)']){
  assert.equal(await allowed('authenticated',fn),true);assert.equal(await allowed('anon',fn),false);assert.equal(await allowed('service_role',fn),false)
 }
 for(const role of ['authenticated','anon','service_role']){
  assert.equal(await allowed(role,'private.invoice_automatic_reminder_eligible(uuid,uuid,uuid,uuid)'),false)
  assert.equal(await allowed(role,'private.claim_document_email_before_invoice_preferences(uuid,boolean)'),false)
 }
 assert.equal(await allowed('service_role','public.claim_document_email(uuid,boolean)'),true)
 assert.equal(await allowed('authenticated','public.claim_document_email(uuid,boolean)'),false)
})
test('paused stale sending attempt cannot be claimed again and remains untouched',async()=>{
 await fixture();await schedule();const id=await task()
 await db.exec("update private.finviant_email_outbox set status='sending';update private.reminder_rules set enabled=false")
 const result=await claim(id);assert.equal(result.status,'busy');assert.equal(result.wrapped,undefined)
 assert.equal((await db.query<{status:string}>('select status from private.finviant_email_outbox')).rows[0].status,'sending')
 assert.equal((await claim(U)).wrapped,true)
})
test('archived, opted-out, wrong-business and unknown archive state prevent scheduling',async()=>{
 for(const change of ["update customers set archived=true","update customers set preferred_contact='none'",`update customers set business_id='${OTHER}'`,"alter table customers alter column archived drop not null;update customers set archived=null"]){
  await fixture();await db.exec(change);assert.equal(await schedule(),0)
  assert.equal((await db.query('select * from private.delivery_tasks')).rows.length,0)
  assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,0)
 }
})
test('customer archive or opt-out after queue blocks claim before provider wrapper',async()=>{
 for(const change of ["update customers set archived=true","update customers set preferred_contact='none'"]){
  await fixture();assert.equal(await schedule(),1);const id=await task();await db.exec(change);const result=await claim(id)
  assert.equal(result.status,'reconciliation_required');assert.equal(result.wrapped,undefined)
  assert.equal((await db.query<{status:string}>('select status from private.delivery_tasks')).rows[0].status,'canceled')
  assert.equal((await db.query<{last_code:string}>('select last_code from private.finviant_email_outbox')).rows[0].last_code,'automatic_reminder_settings_changed')
  assert.equal(await schedule(),0)
 }
})
test('NULL channel preference is unspecified, not opt-out, and permits reminder',async()=>{
 await fixture();assert.equal((await db.query<{preferred_contact:string|null}>('select preferred_contact from customers')).rows[0].preferred_contact,null)
 assert.equal(await schedule(),1);assert.equal((await claim(await task())).status,'claimed')
})
