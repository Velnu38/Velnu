import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',A='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',J='55555555-5555-4555-8555-555555555555',A2='66666666-6666-4666-8666-666666666666'
const sql=await readFile('supabase/migrations/20261109221000_appointment_customer_reminders.sql','utf8')
async function setup(target?:PGlite){const db=target??new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create function auth.uid() returns uuid language sql as $$select case when current_setting('test.actor',true)='none' then null else '${U}'::uuid end$$;
create function private.is_primary_owner(uuid,uuid default auth.uid()) returns boolean language sql as $$select coalesce($1='${B}' and $2='${U}' and coalesce(current_setting('test.owner',true),'true')='true',false)$$;
create function private.can_manage_schedule(uuid) returns boolean language sql as $$select $1='${B}' and coalesce(current_setting('test.access',true),'true')='true'$$;
create function private.effective_plan(uuid) returns text language sql as $$select coalesce(current_setting('test.plan',true),'pro')$$;
create function private.sms_owner_phone_verified(uuid) returns boolean language sql as $$select coalesce(current_setting('test.sms_verified',true),'true')='true'$$;
create function private.private_beta_email_payload_allowed(uuid,jsonb) returns boolean language sql as $$select coalesce(current_setting('test.beta',true),'true')='true'$$;
create table public.businesses(id uuid primary key,name text,timezone text);create table auth.users(id uuid primary key,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,phone text);
create table public.customers(id uuid primary key,business_id uuid,email text,phone text,archived boolean default false,preferred_contact text default 'email');
create table public.jobs(id uuid primary key,business_id uuid,customer_id uuid,status text,scheduled_start timestamptz);
create table public.appointments(id uuid primary key,business_id uuid,customer_id uuid,job_id uuid,starts_at timestamptz,status text,created_at timestamptz default now());
create table public.messages(id uuid primary key,business_id uuid,customer_id uuid,direction text,channel text,recipient text,subject text,body text,provider text,provider_message_id text,status text,sent_at timestamptz);
create table private.managed_delivery_accounts(business_id uuid,email_active boolean,sms_active boolean,sms_from text,sms_reply_route text,reply_to text);
create table private.sms_permissions(business_id uuid,phone text,actor_id uuid,primary key(business_id,phone));create table private.sms_opt_outs(phone text primary key);
create table private.usage(id uuid primary key,feature text,units integer);
create function private.reserve_tier_usage(uuid,uuid,text,integer) returns boolean language plpgsql as $$begin
 perform pg_advisory_xact_lock(hashtextextended('tier-usage:'||$1::text||$3,0));
 if coalesce(current_setting('test.budget',true),'true')='false' then raise exception 'Budget exceeded';end if;
 insert into private.usage values($2,$3,$4) on conflict do nothing;
 case coalesce(current_setting('test.after_reserve',true),'')
 when 'recipient' then update customers set email='changed@example.test';
 when 'cancel' then update appointments set status='canceled';
 when 'pause' then update private.appointment_reminder_rules set enabled=false;
 when 'owner' then perform set_config('test.owner','false',true);
 when 'beta' then perform set_config('test.beta','false',true);
 when 'permission' then delete from private.appointment_sms_permissions;
 else null;end case;return true;end$$;
insert into businesses values('${B}','Test business','America/New_York');insert into auth.users values('${U}',now(),now(),'+12125550199');
insert into customers(id,business_id,email,phone) values('${C}','${B}','customer@example.test','2125550100');
insert into private.managed_delivery_accounts values('${B}',true,true,'+12125550199','owner','owner@example.test');
insert into appointments values('${A}','${B}','${C}',null,now()+interval '24 hours','confirmed',now()-interval '3 days');`);await db.exec(sql);await db.exec(await readFile('supabase/migrations/20261110202917_appointment_reminder_queue_scan.sql','utf8'));return db}
async function value(db:PGlite,query:string){return (await db.query<{v:any}>(`select ${query} as v`)).rows[0].v}
async function enable(db:PGlite,ch='email'){await value(db,`public.save_appointment_reminder_settings('${B}',true,48,'${ch}')`)}
async function queue(db:PGlite){await value(db,'public.prepare_due_appointment_reminders()');return (await db.query<{id:string}>('select id from private.appointment_reminder_queue order by created_at,id')).rows[0]?.id}
async function consent(db:PGlite){await value(db,`public.record_appointment_sms_permission('${B}','${A}',true,'+12125550100')`)}
async function siblings(db:PGlite){await db.exec(`insert into jobs select '${J}','${B}','${C}','scheduled',starts_at from appointments where id='${A}';update appointments set job_id='${J}' where id='${A}';insert into appointments select '${A2}',business_id,customer_id,job_id,starts_at,status,created_at from appointments where id='${A}'`)}

test('disabled 48h email defaults, owner/tier gates, scoped overrides and purpose-specific consent',async()=>{const db=await setup();try{
assert.deepEqual((await value(db,`public.get_appointment_reminder_settings('${B}')`)).rule,{enabled:false,lead_hours:48,channel:'email'});assert.equal(await queue(db),undefined);
let o=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(o.recipient_phone,'+12125550100');assert.equal(o.sms_consented,false);assert.equal(o.shared_occurrence,false);
await assert.rejects(value(db,`public.record_appointment_sms_permission('${B}','${A}',false,'+12125550100')`),/permission/);await consent(db);o=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(o.sms_consented,true);assert.equal((await db.query('select * from private.sms_permissions')).rows.length,0);
await db.exec(`set test.plan='basic'`);await assert.rejects(enable(db),/Business Pro/);await value(db,`public.save_appointment_reminder_settings('${B}',false,48,'sms')`);
await db.exec(`set test.owner='false'`);await assert.rejects(value(db,`public.get_appointment_reminder_settings('${B}')`),/owner/);
await db.exec(`set test.access='false'`);await assert.rejects(value(db,`public.get_appointment_reminder_override('${B}','${A}')`),/access/);
}finally{await db.close()}})
test('one occurrence one attempt, timezone payload and truthful activity',async()=>{const db=await setup();try{await enable(db);const id=await queue(db);assert.ok(id);assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),0);
const claimed=await value(db,`public.claim_appointment_reminder('${id}')`);assert.equal(claimed.status,'claimed');assert.match(claimed.body,/America\/New_York/);assert.deepEqual(claimed.payload.to,['customer@example.test']);assert.deepEqual(claimed.payload.reply_to,['owner@example.test']);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'sending');
await value(db,`public.finish_appointment_reminder('${id}','accepted','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`);assert.equal((await db.query('select * from messages')).rows.length,1);assert.equal((await db.query('select * from private.usage')).rows.length,1);
await value(db,`public.finish_appointment_reminder('${id}','failed',null)`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'accepted');
}finally{await db.close()}})
for(const [label,change] of Object.entries({cancel:`update appointments set status='canceled'`,reschedule:`update appointments set starts_at=starts_at+interval '2 days'`,contact:`update customers set email='changed@example.test'`,owner:`set test.owner='false'`,tier:`set test.plan='basic'`,paused:`update private.appointment_reminder_rules set enabled=false`,channel:`update private.appointment_reminder_rules set channel='sms'`,beta:`set test.beta='false'`,budget:`set test.budget='false'`,archived:`update customers set archived=true`,none:`update customers set preferred_contact='none'`,timezone:`update businesses set timezone='invalid/timezone'`}))test(`claim blocks ${label}`,async()=>{const db=await setup();try{await enable(db);const id=await queue(db);await db.exec(change);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');assert.equal((await db.query('select * from private.usage')).rows.length,0)}finally{await db.close()}})
test('generic financial SMS consent is insufficient; appointment consent and opt-out rechecked',async()=>{const db=await setup();try{await enable(db,'sms');await db.exec(`insert into private.sms_permissions values('${B}','+12125550100','${U}')`);assert.equal(await queue(db),undefined);await consent(db);const id=await queue(db);assert.ok(id);await db.exec(`insert into private.sms_opt_outs values('+12125550100')`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');await assert.rejects(consent(db),/opted out/)}finally{await db.close()}})
test('uncertain outcomes suppress retries and new tasks',async()=>{const db=await setup();try{await enable(db);const id=await queue(db);await value(db,`public.claim_appointment_reminder('${id}')`);await value(db,`public.finish_appointment_reminder('${id}','uncertain',null)`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'uncertain');assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),0)}finally{await db.close()}})
test('late-created appointments skipped and per-record off honored',async()=>{const db=await setup();try{await enable(db);await db.exec(`update appointments set created_at=now()`);assert.equal(await queue(db),undefined);await db.exec(`update appointments set created_at=now()-interval '3 days'`);await value(db,`public.save_appointment_reminder_override('${B}','${A}','off',48,'email')`);assert.equal(await queue(db),undefined)}finally{await db.close()}})
test('custom notice, elapsed-hour arithmetic and tenant/customer mismatch fail closed',async()=>{const db=await setup();try{await enable(db);await value(db,`public.save_appointment_reminder_override('${B}','${A}','custom',12,'email')`);assert.equal(await queue(db),undefined);await value(db,`public.save_appointment_reminder_override('${B}','${A}','custom',36,'email')`);const id=await queue(db);assert.ok(id);assert.equal((await db.query<{hours:number}>('select (extract(epoch from(starts_at-due_at))/3600)::integer as hours from private.appointment_reminder_queue')).rows[0].hours,36);await db.exec(`update customers set business_id='${U}'`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');await assert.rejects(value(db,`public.get_appointment_reminder_override('${U}','${A}')`),/access/)}finally{await db.close()}})
test('SMS reserves UTF16 units and accepted receipt validation fails closed',async()=>{const db=await setup();try{await enable(db,'sms');await consent(db);await db.query('update businesses set name=$1',['😀'.repeat(80)]);const id=await queue(db);const s=await value(db,`public.claim_appointment_reminder('${id}')`);assert.equal(s.status,'claimed');assert.equal(s.segments,Math.ceil(s.body.length/67));await assert.rejects(value(db,`public.finish_appointment_reminder('${id}','accepted','bad')`),/receipt/);await value(db,`public.finish_appointment_reminder('${id}','accepted','SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'accepted')}finally{await db.close()}})
test('consent cannot follow a changed phone without fresh review',async()=>{const db=await setup();try{const reviewed=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(reviewed.recipient_phone,'+12125550100');await db.exec("update customers set phone='2125550101'");await assert.rejects(consent(db),/Recipient changed/);assert.equal((await db.query('select * from private.appointment_sms_permissions')).rows.length,0)}finally{await db.close()}})
test('database ACLs isolate all private tables and service-only RPCs',async()=>{const db=await setup();try{for(const role of ['anon','authenticated','service_role']){
for(const table of ['appointment_reminder_rules','appointment_reminder_overrides','appointment_reminder_queue','appointment_sms_permissions'])assert.equal(await value(db,`has_table_privilege('${role}','private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
for(const fn of ['prepare_due_appointment_reminders()','list_due_appointment_reminders(boolean,boolean)','claim_appointment_reminder(uuid,boolean)','finish_appointment_reminder(uuid,text,text)'])assert.equal(await value(db,`has_function_privilege('${role}','public.${fn}','EXECUTE')`),role==='service_role');
for(const fn of ['get_appointment_reminder_settings(uuid)','save_appointment_reminder_settings(uuid,boolean,integer,text)','get_appointment_reminder_override(uuid,uuid)','save_appointment_reminder_override(uuid,uuid,text,integer,text)','record_appointment_sms_permission(uuid,uuid,boolean,text)'])assert.equal(await value(db,`has_function_privilege('${role}','public.${fn}','EXECUTE')`),role==='authenticated');
for(const fn of ['appointment_reminder_snapshot(uuid)','appointment_reminder_occurrence(uuid)'])assert.equal(await value(db,`has_function_privilege('${role}','private.${fn}','EXECUTE')`),false);
}assert.equal((await db.query<{provolatile:string}>("select provolatile from pg_proc where oid='private.appointment_reminder_snapshot(uuid)'::regprocedure")).rows[0].provolatile,'v')}finally{await db.close()}})
test('spring DST preserves 48 elapsed hours and business-local display',async()=>{const db=await setup();try{await enable(db);await db.exec(`update appointments set starts_at='2030-03-10 12:00:00+00',created_at='2030-03-01 12:00:00+00'`);const s=await value(db,`private.appointment_reminder_snapshot('${A}')`);assert.ok(s);assert.equal(new Date(s.starts_at).getTime()-new Date(s.due_at).getTime(),48*3600*1000);assert.equal(new Date(s.due_at).toISOString(),'2030-03-08T12:00:00.000Z');assert.match(s.body,/Mar 10, 2030 08:00 \(America\/New_York\)/)}finally{await db.close()}})
test('enabled SMS bypasses disabled email backlog; business rule distinct from custom override',async()=>{const db=await setup();try{await enable(db,'sms');await value(db,`public.save_appointment_reminder_override('${B}','${A}','custom',36,'email')`);const o=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(o.effective.channel,'email');assert.equal(o.effective.lead_hours,36);assert.deepEqual(o.business_rule,{enabled:true,lead_hours:48,channel:'sms'});
await db.exec(`insert into private.appointment_reminder_queue(business_id,appointment_id,occurrence_id,starts_at,due_at,channel,snapshot) select '${B}','${A}',gen_random_uuid(),now()+interval '1 day',now()-interval '2 days','email','{}'::jsonb from generate_series(1,30);insert into private.appointment_reminder_queue(business_id,appointment_id,occurrence_id,starts_at,due_at,channel,snapshot) values('${B}','${A}',gen_random_uuid(),now()+interval '1 day',now()-interval '1 day','sms','{}')`);const rows=await db.query<{channel:string}>('select * from public.list_due_appointment_reminders(false,true)');assert.deepEqual(rows.rows.map(r=>r.channel),['sms']);assert.equal((await db.query('select * from public.list_due_appointment_reminders(false,false)')).rows.length,0)}finally{await db.close()}})
for(const [name,label] of [['ASCII business','basic'],['^'.repeat(80),'extension']] as const)test(`SMS GSM7 ${label} exact septets`,async()=>{const db=await setup();try{await enable(db,'sms');await consent(db);await db.query('update businesses set name=$1',[name]);const id=await queue(db);const claim=await value(db,`public.claim_appointment_reminder('${id}')`);assert.equal(claim.status,'claimed');const septets=claim.body.length+[...claim.body].filter((c:string)=>'^{}\\[~]|€'.includes(c)).length;assert.equal(claim.segments,septets<=160?1:Math.ceil(septets/153))}finally{await db.close()}})
test('email requires valid reply routing at enable and claim',async()=>{const db=await setup();try{await db.exec('update private.managed_delivery_accounts set reply_to=null');assert.equal((await value(db,`public.get_appointment_reminder_settings('${B}')`)).ready_email,false);await assert.rejects(enable(db),/activated delivery/);await db.exec("update private.managed_delivery_accounts set reply_to='owner@example.test'");await enable(db);const id=await queue(db);await db.exec("update private.managed_delivery_accounts set reply_to='invalid'");assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');assert.equal((await db.query('select * from private.usage')).rows.length,0)}finally{await db.close()}})
test('sibling Off suppresses occurrence; save propagates settings to every sibling',async()=>{const db=await setup();try{await enable(db);await siblings(db);await db.exec(`insert into private.appointment_reminder_overrides values('${A2}','${B}','off',48,'email')`);assert.equal(await queue(db),undefined);const off=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(off.shared_occurrence,true);assert.equal(off.mode,'off');await value(db,`public.save_appointment_reminder_override('${B}','${A}','custom',36,'email')`);assert.equal((await db.query('select * from private.appointment_reminder_overrides where mode=\'custom\' and lead_hours=36')).rows.length,2);await queue(db);assert.equal((await db.query('select * from private.appointment_reminder_queue')).rows.length,1)}finally{await db.close()}})
test('conflicting custom sibling timings and channels fail closed',async()=>{const db=await setup();try{await enable(db);await siblings(db);await db.exec(`insert into private.appointment_reminder_overrides values('${A}','${B}','custom',36,'email'),('${A2}','${B}','custom',48,'sms')`);const o=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(o.occurrence_conflict,true);assert.equal(o.effective.enabled,false);assert.equal(await queue(db),undefined);await value(db,`public.save_appointment_reminder_override('${B}','${A2}','inherit',48,'email')`);assert.equal((await value(db,`public.get_appointment_reminder_override('${B}','${A}')`)).occurrence_conflict,false);assert.ok(await queue(db))}finally{await db.close()}})
test('future visits independent of job first start remain eligible; parent customer/status authoritative',async()=>{const db=await setup();try{await enable(db);await siblings(db);await db.exec(`update jobs set scheduled_start=now()-interval '1 day';update appointments set starts_at=starts_at+interval '2 hours' where id='${A2}'`);await queue(db);assert.equal((await db.query('select * from private.appointment_reminder_queue')).rows.length,2);await db.exec(`update jobs set customer_id='${U}'`);for(const row of (await db.query<{id:string}>('select id from private.appointment_reminder_queue')).rows)assert.equal((await value(db,`public.claim_appointment_reminder('${row.id}')`)).status,'blocked');await db.exec(`update jobs set customer_id='${C}',status='completed'`);assert.equal(await value(db,`private.appointment_reminder_snapshot('${A}')`),null)}finally{await db.close()}})
test('deleting canonical row retains durable occurrence suppression',async()=>{const db=await setup();try{await enable(db);await siblings(db);const id=await queue(db);await db.exec(`delete from appointments where id='${A}'`);assert.equal((await db.query('select * from private.appointment_reminder_queue')).rows.length,1);assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),0);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked')}finally{await db.close()}})
for(const change of ['recipient','cancel','pause','owner','beta','permission'])test(`post-reservation ${change} change blocks and rolls quota back`,async()=>{const db=await setup();try{await enable(db,change==='permission'?'sms':'email');if(change==='permission')await consent(db);const id=await queue(db);await db.exec(`set test.after_reserve='${change}'`);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');assert.equal((await db.query('select * from private.usage')).rows.length,0)}finally{await db.close()}})

test('service-role SMS resolves saved owner verification without auth.uid impersonation',async()=>{const db=await setup();try{await enable(db,'sms');await consent(db);await db.exec("set test.actor='none'");assert.equal(await value(db,'auth.uid()'),null);const id=await queue(db);assert.ok(id);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'claimed');assert.equal(await value(db,'auth.uid()'),null)}finally{await db.close()}})
test('saved owner phone verification is rechecked by service-role claim',async()=>{const db=await setup();try{await enable(db,'sms');await consent(db);const id=await queue(db);await db.exec("set test.actor='none';update auth.users set phone_confirmed_at=null");assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');assert.equal((await db.query('select * from private.usage')).rows.length,0)}finally{await db.close()}})

// Optional real-PostgreSQL check. Requires a pre-created EMPTY disposable database and
// existing anon/authenticated/service_role roles. Never connects to non-loopback hosts.
// Leaves synthetic fixtures for inspection; use a new disposable database on each run.
const localPgUrl=process.env.FINVIANT_REMINDER_LOCAL_PG_URL
test('optional local PostgreSQL: quota-wait race, concurrent claims and sibling saves',{skip:!localPgUrl,timeout:30000},async()=>{
 const url=new URL(localPgUrl!)
 assert.ok(['postgres:','postgresql:'].includes(url.protocol),'PostgreSQL URL required')
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only loopback PostgreSQL is permitted')
 assert.match(decodeURIComponent(url.pathname.slice(1)),/^finviant_reminder_test_[a-z0-9_]+$/,'Use a dedicated disposable test database')
 assert.equal(url.search,'','URL query overrides are not permitted')
 const {Client}=await import('pg')
 const clients=Array.from({length:4},()=>new Client({connectionString:localPgUrl,connectionTimeoutMillis:3000}))
 const [claimant,blocker,editor,observer]=clients
 try{
  await Promise.all(clients.map(c=>c.connect()))
  for(const c of clients)await c.query("set statement_timeout='15s';set lock_timeout='10s'")
  const occupied=await observer.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p','v','m','S')) or exists(select 1 from pg_namespace where nspname in('private','auth')) as occupied")
  assert.equal(occupied.rows[0].occupied,false,'Refusing a nonempty database')
  const roles=await observer.query("select count(*)::integer n from pg_roles where rolname in('anon','authenticated','service_role')")
  assert.equal(roles.rows[0].n,3,'Provision test roles separately; this test does not create cluster roles')
  const adapter={exec:async(s:string)=>{await claimant.query(s.replace(/create role (anon|authenticated|service_role);/g,''))},query:(s:string,params?:unknown[])=>claimant.query(s,params)} as unknown as PGlite
  await setup(adapter);await enable(adapter);await siblings(adapter);const id=await queue(adapter);assert.ok(id)
  const pid=(await claimant.query('select pg_backend_pid() as pid')).rows[0].pid
  await blocker.query('begin')
  await blocker.query("select pg_advisory_xact_lock(hashtextextended('tier-usage:'||$1||'email',0))",[B])
  const pending=claimant.query(`select public.claim_appointment_reminder('${id}') as result`)
  // Attach rejection handling immediately while waiting for the observable lock state.
  const outcome=pending.then(r=>({value:r.rows[0].result}),error=>({error}))
  let waiting=false
  for(let i=0;i<100;i++){
   const locks=await observer.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waiting",[pid])
   if(locks.rows[0].waiting){waiting=true;break}await new Promise(r=>setTimeout(r,25))
  }
  assert.equal(waiting,true,'Claim should reach the allowance lock')
  await editor.query("update customers set email='changed@example.test'")
  await blocker.query('commit')
  const result=await outcome;if('error' in result)throw result.error
  assert.equal(result.value.status,'blocked')
  assert.equal((await observer.query('select count(*)::integer n from private.usage')).rows[0].n,0)
  await editor.query("update customers set email='customer@example.test';update appointments set starts_at=starts_at+interval '1 hour'")
  await value(adapter,'public.prepare_due_appointment_reminders()')
  const next=(await observer.query("select id from private.appointment_reminder_queue where status='queued'")).rows[0].id
  const claims=await Promise.all([claimant,editor].map(c=>c.query(`select public.claim_appointment_reminder('${next}') as result`)))
  assert.deepEqual(claims.map(r=>r.rows[0].result.status).sort(),['claimed','sending'])
  assert.equal((await observer.query('select count(*)::integer n from private.usage')).rows[0].n,1)
  await Promise.all([claimant.query(`select public.save_appointment_reminder_override('${B}','${A}','custom',36,'email')`),editor.query(`select public.save_appointment_reminder_override('${B}','${A2}','custom',40,'email')`)])
  const preferences=await observer.query('select count(distinct(lead_hours,channel))::integer n from private.appointment_reminder_overrides')
  assert.equal(preferences.rows[0].n,1)
 }finally{await blocker.query('rollback').catch(()=>{});await Promise.all(clients.map(c=>c.end().catch(()=>{})))}
})

for(const status of ['in_progress','completed','no_show','canceled'])test(`same-occurrence ${status} sibling blocks preparation and queued claim`,async()=>{const db=await setup();try{await enable(db);await siblings(db);await db.query('update appointments set status=$1 where id=$2',[status,A2]);const state=await value(db,`public.get_appointment_reminder_override('${B}','${A}')`);assert.equal(state.occurrence_status_conflict,true);assert.equal(state.effective.enabled,false);assert.equal(await queue(db),undefined);await db.exec(`update appointments set status='confirmed' where id='${A2}'`);const id=await queue(db);assert.ok(id);await db.query('update appointments set status=$1 where id=$2',[status,A2]);assert.equal((await value(db,`public.claim_appointment_reminder('${id}')`)).status,'blocked');assert.equal((await db.query('select * from private.usage')).rows.length,0)}finally{await db.close()}})
test('terminal earlier visit does not suppress a separate future start',async()=>{const db=await setup();try{await enable(db);await siblings(db);await db.exec(`update appointments set status='completed' where id='${A}';update appointments set starts_at=starts_at+interval '2 hours' where id='${A2}'`);const state=await value(db,`public.get_appointment_reminder_override('${B}','${A2}')`);assert.equal(state.occurrence_status_conflict,false);assert.ok(await queue(db));assert.equal((await db.query('select * from private.appointment_reminder_queue')).rows.length,1)}finally{await db.close()}})

for(const status of ['queued','sending','accepted','failed','uncertain','blocked'])test(`preparation preserves ${status} suppression while allowing a rescheduled occurrence`,async()=>{const db=await setup();try{
 await enable(db);await siblings(db);const id=await queue(db);await db.query('update private.appointment_reminder_queue set status=$1 where id=$2',[status,id]);
 assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),0);
 await db.exec(`update appointments set starts_at=starts_at+interval '1 hour'`);
 assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),1);
 assert.equal((await db.query('select * from private.appointment_reminder_queue')).rows.length,2);
 assert.equal((await db.query<{status:string}>('select status from private.appointment_reminder_queue where id=$1',[id])).rows[0].status,status);
 assert.equal(await value(db,'public.prepare_due_appointment_reminders()'),0);
}finally{await db.close()}})
