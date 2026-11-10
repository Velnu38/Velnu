import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const migration=await readFile('supabase/migrations/20261110131000_rls_identity_initplans.sql','utf8')
const A='11111111-1111-4111-8111-111111111111',B='11111111-1111-4111-8111-111111111112'
const OWNER='22222222-2222-4222-8222-222222222221',OFFICE='22222222-2222-4222-8222-222222222222',OTHER='22222222-2222-4222-8222-222222222223'
const modules:Record<string,string>={jobs:'jobs',appointments:'calendar',reminders:'calendar',document_schedules:'calendar',invoices:'billing',invoice_items:'billing',estimates:'billing',estimate_items:'billing',change_orders:'billing',change_order_items:'billing',document_approval_links:'billing',document_approvals:'billing',messages:'billing',payments:'billing',bookkeeping_entries:'finances',quickbooks_connections:'finances',quickbooks_transactions:'finances',record_photos:'jobs',ai_actions:'billing',voice_transcriptions:'billing'}

// Synthetic permission fixture for the transformation. The mandatory complete
// Supabase replay independently exercises final application policies/functions.
async function fixture(){
 const db=new PGlite()
 await db.exec(`create role authenticated;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table private.members(business_id uuid,actor uuid,modules text[],primary key(business_id,actor));
 insert into private.members values('${A}','${OWNER}',array['jobs','billing','calendar','finances']),('${A}','${OFFICE}',array['jobs']),('${B}','${OTHER}',array['jobs','billing','calendar','finances']);
 create function private.member_module_access(b uuid,p_actor uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.members m where m.business_id=b and m.actor=p_actor and feature=any(m.modules))$$;
 grant usage on schema public,auth,private to authenticated;
 create table public.user_plan_preferences(user_id uuid,selected_tier text);
 create table public.user_agreement_acceptances(user_id uuid,selected_tier_at_acceptance text,terms_accepted boolean);
 alter table public.user_agreement_acceptances enable row level security;
 create policy velnu_agreement_acceptance_insert on public.user_agreement_acceptances for insert to authenticated with check(user_id=auth.uid() and terms_accepted and exists(select 1 from public.user_plan_preferences p where p.user_id=auth.uid() and p.selected_tier=selected_tier_at_acceptance));
 insert into public.user_plan_preferences values('${OWNER}','pro');
 create table public.business_settings(business_id uuid);
 alter table public.business_settings enable row level security;
 create policy visible on public.business_settings for select to authenticated using(true);
 create policy module_settings_read on public.business_settings as restrictive for select to authenticated using(private.member_module_access(business_id,auth.uid(),'billing'));
 `)
 for(const [table,module] of Object.entries(modules)){
  await db.exec(`create table public.${table}(id bigint generated always as identity,business_id uuid,job_id uuid,invoice_id uuid,estimate_id uuid);
   alter table public.${table} enable row level security;
   create policy fixture_base on public.${table} to authenticated using(true) with check(true);
   create policy owner_module_access on public.${table} as restrictive to authenticated using(private.member_module_access(business_id,auth.uid(),'${module}')) with check(private.member_module_access(business_id,auth.uid(),'${module}'));
   insert into public.${table}(business_id) values('${A}'),('${B}');`)
 }
 await db.exec(`create policy owner_parent_access on public.bookkeeping_entries as restrictive to authenticated using((job_id is null or private.member_module_access(business_id,auth.uid(),'jobs')) and ((invoice_id is null and estimate_id is null) or private.member_module_access(business_id,auth.uid(),'billing'))) with check((job_id is null or private.member_module_access(business_id,auth.uid(),'jobs')) and ((invoice_id is null and estimate_id is null) or private.member_module_access(business_id,auth.uid(),'billing')));
 grant select,insert,update,delete on all tables in schema public to authenticated;
 grant usage,select on all sequences in schema public to authenticated;`)
 return db
}
async function permissions(db:PGlite){
 const result=[]
 for(const actor of [OWNER,OFFICE,OTHER,'']){
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  const reads=[]
  for(const table of ['jobs','invoices','bookkeeping_entries'])reads.push((await db.query<{n:number}>(`select count(*)::int n from public.${table} where business_id='${A}'`)).rows[0].n)
  let blocked=false
  try{await db.exec(`insert into public.invoices(business_id) values('${A}')`)}catch(e:any){assert.equal(e.code,'42501');blocked=true}
  result.push({actor,reads,blocked})
  await db.exec('reset role')
  await db.exec('delete from public.invoices where id>2')
 }
 return result
}

test('identity initplans preserve tenant/module reads and writes, revocation and policy metadata',async()=>{
 const db=await fixture()
 try{
  const metadata=()=>db.query('select schemaname,tablename,policyname,permissive,roles,cmd from pg_policies order by schemaname,tablename,policyname')
  const beforeMetadata=(await metadata()).rows,before=await permissions(db)
  assert.deepEqual(before.map(r=>[r.reads,r.blocked]),[[[1,1,1],false],[[1,0,0],true],[[0,0,0],true],[[0,0,0],true]])
  await db.exec(migration)
  assert.deepEqual((await metadata()).rows,beforeMetadata)
  assert.deepEqual(await permissions(db),before)
  await db.exec(`update private.members set modules='{}' where actor='${OFFICE}'`)
  assert.deepEqual((await permissions(db))[1].reads,[0,0,0])
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${OWNER}'`)
  await db.exec(`insert into user_agreement_acceptances values('${OWNER}','pro',true)`)
  await assert.rejects(db.exec(`insert into user_agreement_acceptances values('${OTHER}','pro',true)`),{code:'42501'})
  await assert.rejects(db.exec(`insert into user_agreement_acceptances values('${OWNER}','free',true)`),{code:'42501'})
 }finally{await db.close()}
})

test('high-row query evaluates the identity InitPlan once without changing selected records',async t=>{
 const db=await fixture()
 try{
  await db.exec(`insert into public.jobs(business_id) select case when i%2=0 then '${A}'::uuid else '${B}'::uuid end from generate_series(1,12000) i;analyze public.jobs`)
  async function plan(){
   await db.exec(`set role authenticated;set request.jwt.claim.sub='${OWNER}'`)
   const p=(await db.query<any>('explain(analyze,format json) select id from public.jobs')).rows[0]['QUERY PLAN'][0]
   await db.exec('reset role');return p
  }
  const before=await plan();await db.exec(migration);const after=await plan()
  assert.equal(before.Plan['Actual Rows'],6001);assert.equal(after.Plan['Actual Rows'],6001)
  const nodes=(p:any):any[]=>[p,...(p.Plans??[]).flatMap(nodes)]
  const init=nodes(after.Plan).filter((p:any)=>p['Parent Relationship']==='InitPlan')
  assert.equal(init.length,1);assert.equal(init[0]['Actual Loops'],1)
  t.diagnostic(JSON.stringify({fixture:'synthetic-12002-jobs',beforeMs:before['Execution Time'],afterMs:after['Execution Time'],identityInitPlanLoops:1,visibleRows:6001}))
 }finally{await db.close()}
})

test('migration refuses missing policy scope without partially changing other policies',async()=>{
 const db=await fixture()
 try{
  await db.exec('drop policy owner_module_access on public.jobs')
  await assert.rejects(db.exec(migration),/Expected 23/)
  assert.doesNotMatch((await db.query<{qual:string}>("select qual from pg_policies where tablename='invoices' and policyname='owner_module_access'")).rows[0].qual,/SELECT/)
 }finally{await db.close()}
})
