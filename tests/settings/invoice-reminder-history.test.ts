import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
const sql=await readFile('supabase/migrations/20261105161826_invoice_payment_reminders.sql','utf8')
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',I='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',R='55555555-5555-4555-8555-555555555555'
async function baseSetup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${U}'::uuid$$;
create function private.member_module_access(uuid,uuid,text) returns boolean language sql as $$select $1='${B}' and $2='${U}'$$;
create table businesses(id uuid,name text,email text,currency text,timezone text);
create table customers(id uuid,business_id uuid,first_name text,last_name text,company text,email text,phone text);
create table invoices(id uuid,business_id uuid,customer_id uuid,invoice_number text,status text,balance_due numeric,due_date date,issuer_snapshot jsonb,payment_instructions text,payment_links jsonb,updated_at timestamptz);
create table business_members(business_id uuid,user_id uuid,role text);create table user_agreement_acceptances(user_id uuid,terms_accepted boolean,ai_disclosure_acknowledged boolean,electronic_records_consent boolean);
create table private.business_entitlements(business_id uuid,plan text,valid_until timestamptz);
create table private.finviant_email_outbox(id uuid primary key,business_id uuid,actor_id uuid,document_kind text,document_id uuid,payload jsonb,status text default 'queued',created_at timestamptz default now());
create table messages(id uuid primary key,business_id uuid,customer_id uuid,invoice_id uuid,direction text,channel text,recipient text,subject text,body text,provider text,status text,sent_at timestamptz,created_at timestamptz default now());
insert into businesses values('${B}','Sample Business','owner@example.test','USD','America/New_York');insert into customers values('${C}','${B}','Jordan','Taylor',null,'jordan@example.test','7575550123');
insert into invoices values('${I}','${B}','${C}','INV-1','partial',75,'2020-01-01','{}','Pay by check','[{"provider":"stripe","url":"https://buy.stripe.com/sample"}]','2026-01-01');
insert into business_members values('${B}','${U}','owner');insert into user_agreement_acceptances values('${U}',true,true,true);insert into private.business_entitlements values('${B}','pro',null);`);await db.exec(sql);return db}

const historySql=await readFile('supabase/migrations/20261112004157_invoice_reminder_history.sql','utf8')
async function setup(){const db=await baseSetup();await db.exec(`
 create or replace function auth.uid() returns uuid language sql as $$select case when current_setting('test.actor',true)='none' then null else '${U}'::uuid end$$;
 create function private.fin_access(uuid,text,boolean default false) returns boolean language sql as $$select auth.uid() is not null and $1='${B}' and coalesce(current_setting('test.access',true),'true')='true'$$;
 alter table messages alter column id set default gen_random_uuid();alter table messages add column provider_message_id text;
 alter table private.finviant_email_outbox add column provider_id text,add column last_event_at timestamptz,add column attempts integer default 0,add column next_attempt_at timestamptz,add column last_code text;
 create table private.delivery_tasks(id uuid primary key,business_id uuid,kind text,document_id uuid,actor_id uuid,created_at timestamptz default now(),reminder boolean,status text,last_error text,snapshot jsonb);
 create table private.document_shares(token_hash text primary key,business_id uuid,kind text,document_id uuid,actor_id uuid,snapshot jsonb,revoked_at timestamptz,expires_at timestamptz);
 create table private.finviant_delivery_events(event_id text primary key,provider_id text,event_type text,occurred_at timestamptz,received_at timestamptz default now());
 create table user_profiles(user_id uuid primary key,full_name text);
 insert into user_profiles values('${U}','Synthetic owner');
 `);await db.exec(historySql)
 const bootstrap=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8');const a=bootstrap.indexOf('CREATE OR REPLACE FUNCTION public.record_delivery_event('),b=bootstrap.indexOf('CREATE OR REPLACE FUNCTION public.record_manual_payment(',a);await db.exec(bootstrap.slice(a,b));return db}
async function history(db:PGlite,before?:any,limit=20){return (await db.query<{v:any}>('select public.get_invoice_reminder_history($1,$2,$3,$4,$5) v',[B,I,before?.created_at??null,before?.id??null,limit])).rows[0].v}
async function seed(db:PGlite,status='queued',automatic=false){await db.exec(`insert into messages(id,business_id,invoice_id,direction,channel,recipient,subject,body,provider,status) values('${R}','${B}','${I}','outbound','email','synthetic@example.test','Payment reminder: INV-1','Body','resend','queued');insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,status,provider_id) values('${R}','${B}','${U}','invoice','${I}','{"secret":"must not appear"}','${status}','provider-1')`);if(automatic)await db.exec(`insert into private.delivery_tasks(id,business_id,kind,document_id,actor_id,reminder,status) values('${R}','${B}','invoice','${I}','${U}',true,'queued')`)}
test('empty, manual/automatic, all delivery states and no provider secrets or writes',async()=>{const db=await setup();try{
 assert.deepEqual((await history(db)).items,[]);await seed(db,'queued',true)
 for(const status of ['queued','sending','accepted','delivered','failed','uncertain','reconciliation_required']){await db.query('update private.finviant_email_outbox set status=$1',[status]);const h=await history(db);assert.equal(h.items.length,1);assert.equal(h.items[0].status,status==='reconciliation_required'?'uncertain':status);assert.equal(h.items[0].source,'automatic');assert.equal(h.items[0].initiator,'Automatic rule');assert.equal(JSON.stringify(h).includes('must not appear'),false)}
 await db.exec('delete from private.delivery_tasks');assert.equal((await history(db)).items[0].initiator,'You');assert.equal((await history(db)).items[0].source,'manual')
 assert.equal((await db.query('select * from messages')).rows.length,1);assert.equal((await db.query<any>('select balance_due from invoices')).rows[0].balance_due,'75')
}finally{await db.close()}})
test('suppressed and canceled unprepared automatic tasks remain visible',async()=>{const db=await setup();try{
 await db.exec(`insert into private.delivery_tasks(id,business_id,kind,document_id,actor_id,reminder,status,last_error) values('${R}','${B}','invoice','${I}','${U}',true,'blocked','raw-secret')`)
 let h=await history(db);assert.equal(h.items[0].status,'suppressed');assert.equal(JSON.stringify(h).includes('raw-secret'),false)
 await db.exec("update private.delivery_tasks set status='canceled'");assert.equal((await history(db)).items[0].status,'canceled')
}finally{await db.close()}})
test('stable cursor, same timestamps, last reminder summary and refresh persistence',async()=>{const db=await setup();try{
 await db.exec(`insert into messages(id,business_id,invoice_id,direction,channel,subject,provider,status,created_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${B}','${I}','outbound','email','Payment reminder: test','resend','sent','2026-11-01T12:00:00Z' from generate_series(1,25)n`)
 const first=await history(db);assert.equal(first.items.length,20);assert.equal(first.has_more,true);const second=await history(db,first.items.at(-1));assert.equal(second.items.length,5);assert.equal(second.has_more,false);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,25);assert.deepEqual(await history(db),first);assert.equal(first.last_success.status,'accepted')
}finally{await db.close()}})
test('cross-tenant, missing identity, module denial, paging bounds and anonymous ACL fail closed',async()=>{const db=await setup();try{
 await assert.rejects(db.query('select public.get_invoice_reminder_history($1,$2)',[C,I]),/unavailable/)
 await assert.rejects(history(db,undefined,51),/Invalid history page/)
 await db.exec("set test.access='false'");await assert.rejects(history(db),/unavailable/)
 await db.exec("set test.access='true';set test.actor='none'");await assert.rejects(history(db),/unavailable/)
 await db.exec('set role anon');await assert.rejects(history(db),/permission denied/)
}finally{await db.close()}})
test('duplicate/out-of-order callback history never regresses confirmed delivery; suppression distinct',async()=>{const db=await setup();try{
 await seed(db,'accepted');const event=async(id:string,type:string,at:string)=>db.query('select public.record_delivery_event($1,$2,$3,$4)',[id,'provider-1',type,at])
 await event('delivered','email.delivered','2026-11-01T12:00:00Z');await event('delivered','email.delivered','2026-11-01T12:00:00Z');await event('older','email.failed','2026-11-01T11:00:00Z');let h=await history(db);assert.equal(h.items[0].status,'delivered');assert.equal(h.items[0].events.length,2)
 await event('suppressed','email.suppressed','2026-11-01T13:00:00Z');assert.equal((await history(db)).items[0].status,'suppressed');await event('bounced','email.bounced','2026-11-01T14:00:00Z');assert.equal((await history(db)).items[0].status,'bounced')
}finally{await db.close()}})
test('native draft persists, deduplicates and stays unverified; cancellation and paid suppression',async()=>{const db=await setup();try{
 const token='a'.repeat(64);await db.query(`insert into private.document_shares values(encode(sha256(convert_to($1,'UTF8')),'hex'),'${B}','invoice','${I}','${U}','{"customer":{"email":"jordan@example.test","phone":"7575550123"}}',null,now()+interval '1 day')`,[token])
 const draft=async(cancel=false)=>db.query('select public.record_invoice_reminder_draft($1,$2,$3,$4)',[B,token,'email',cancel])
 await draft();await draft();let h=await history(db);assert.equal(h.items.length,1);assert.equal(h.items[0].status,'draft_opened');assert.equal(h.last_success,null);assert.equal(h.items[0].initiator,'You')
 await draft(true);assert.equal((await history(db)).items[0].status,'canceled')
 await db.exec(`insert into messages(business_id,invoice_id,direction,channel,provider,provider_message_id,status,sent_at) select '${B}','${I}','outbound','email','personal_app',token_hash,'sent',now() from private.document_shares`);h=await history(db);assert.equal(h.items.length,1);assert.equal(h.items[0].status,'user_reported');assert.equal(h.last_success,null)
 await db.exec("update invoices set status='paid',balance_due=0");await assert.rejects(draft(),/no longer overdue/);assert.equal((await history(db)).items[0].status,'user_reported');assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,0)
}finally{await db.close()}})

test('zero-attempt suppression differs from uncertain send and ambiguous same-time events stay failed',async()=>{const db=await setup();try{
 await seed(db,'reconciliation_required');await db.exec("update private.finviant_email_outbox set last_code='automatic_reminder_settings_changed'")
 assert.equal((await history(db)).items[0].status,'suppressed')
 await db.exec('update private.finviant_email_outbox set attempts=1');assert.equal((await history(db)).items[0].status,'uncertain')
 await db.exec("update private.finviant_email_outbox set status='failed',last_event_at='2026-11-01T12:00:00Z';insert into private.finviant_delivery_events(event_id,provider_id,event_type,occurred_at) values('first','provider-1','email.failed','2026-11-01T12:00:00Z'),('stale','provider-1','email.suppressed','2026-11-01T12:00:00Z')")
 assert.equal((await history(db)).items[0].status,'failed')
}finally{await db.close()}})

test('legacy personal app receipt stays visible without inventing a reminder or delivery confirmation',async()=>{const db=await setup();try{
 await db.exec(`insert into messages(business_id,invoice_id,direction,channel,provider,status,subject) values('${B}','${I}','outbound','email','personal_app','sent','Owner reported personal-app send')`)
 const h=await history(db);assert.equal(h.items.length,1);assert.equal(h.items[0].source,'personal_unclassified');assert.equal(h.items[0].status,'user_reported');assert.equal(h.last_attempt,null);assert.equal(h.last_success,null)
}finally{await db.close()}})

test('last successful reminder follows delivery time rather than draft creation time',async()=>{const db=await setup();try{
 await seed(db,'delivered');await db.exec(`update messages set created_at='2026-11-01T12:00:00Z',sent_at='2026-11-01T12:00:00Z';update private.finviant_email_outbox set last_event_at='2026-11-05T12:00:00Z';insert into messages(id,business_id,invoice_id,direction,channel,subject,provider,status,created_at,sent_at) values('${C}','${B}','${I}','outbound','email','Payment reminder: second','resend','delivered','2026-11-02T12:00:00Z','2026-11-02T12:00:00Z');insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,status,last_event_at) values('${C}','${B}','${U}','invoice','${I}','{}','delivered','2026-11-03T12:00:00Z')`)
 const h=await history(db);assert.equal(h.last_attempt.id,C);assert.equal(h.last_success.id,R);assert.equal(new Date(h.last_success.last_event_at).toISOString(),'2026-11-05T12:00:00.000Z')
}finally{await db.close()}})
