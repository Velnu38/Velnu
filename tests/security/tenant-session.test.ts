import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,B,U,O} from '../tiers/fixture.ts'
const X='99999999-9999-4999-8999-999999999999',V='88888888-8888-4888-8888-888888888888'
const S='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',T='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const migration=await readFile('supabase/migrations/20261112212102_tenant_session_authorization.sql','utf8')
async function setup(){
 const db=await fixture()
 await db.exec(`reset role;
 create role authenticator;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
 create table private.field_accounts(business_id uuid,user_id uuid,worker_id uuid,enabled boolean);
 create table private.worker_profiles(business_id uuid,id uuid,active boolean);
 create function private.field_mode(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.field_accounts where business_id=b and user_id=actor)$$;
 create function private.fin_account_catalog() returns jsonb language sql as $$select '{"resources":{"business_profile":{},"invoices":{"module":"billing"}}}'::jsonb$$;
 create schema storage;create table storage.objects(bucket_id text,name text);
 alter table storage.objects enable row level security;
 create policy tenant_read on storage.objects for select to authenticated using(private.is_business_member(split_part(name,'/',1)::uuid));
 grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;
 insert into auth.users values('${V}');
 insert into businesses(id,name,created_by_user_id) values('${X}','Second controlled business','${V}');
 insert into business_members(business_id,user_id,role) values('${X}','${V}','owner');
 insert into private.business_entitlements(business_id,plan) values('${X}','pro');
 insert into auth.sessions values('${S}','${U}',null),('${T}','${V}',null);
 update user_agreement_acceptances set agreement_version='2026-11-06-v5';
 insert into user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values('${V}','2026-11-06-v5',true,true,true);
 insert into storage.objects values('finviant-record-photos','${B}/photo.png');
 `)
 await db.exec("create function private.velnu_has_accepted_terms() returns boolean language sql as $$select false$$")
 await db.exec(migration)
 return db
}
async function actor(db:any,id=U,session:any=S,extra={}){
 await db.exec('reset role')
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:session,...extra})])
 await db.exec('set role authenticated')
}
const val=async(db:any,sql:string,args:any[]=[]) => (await db.query(sql,args)).rows[0].v

test('two businesses: active session preserves owner access but never grants foreign membership, roles or private files',async()=>{
 const db=await setup();try{
  await actor(db)
  assert.equal(await val(db,'select current_session_actor() v'),U)
  await db.query('select check_request_session()')
  assert.equal(await val(db,'select private.is_business_member($1) v',[B]),true)
  assert.equal(await val(db,'select private.is_business_member($1) v',[X]),false)
  assert.equal(await val(db,"select private.has_business_role($1,array['owner']) v",[X]),false)
  assert.equal((await db.query('select * from storage.objects')).rows.length,1)
  await actor(db,V,T)
  assert.equal(await val(db,'select private.is_business_member($1) v',[X]),true)
  assert.equal(await val(db,'select private.is_business_member($1) v',[B]),false)
  assert.equal((await db.query('select * from storage.objects')).rows.length,0)
 }finally{await db.close()}
})
test('deleted, expired, missing, malformed and other-user sessions fail closed despite forged metadata',async()=>{
 const db=await setup();try{
  for(const session of [null,'not-a-uuid',T]){
   await actor(db,U,session,{role:'service_role',user_metadata:{role:'owner'}})
   assert.equal(await val(db,'select current_session_actor() v'),null)
   await assert.rejects(db.query('select check_request_session()'),/session has ended/)
   assert.equal(await val(db,'select private.is_primary_owner($1) v',[B]),false)
   assert.equal(await val(db,"select private.member_module_access($1,$2,'billing') v",[B,U]),false)
   assert.equal((await db.query('select * from storage.objects')).rows.length,0)
  }
  await db.exec('reset role');await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[S])
  await actor(db);assert.equal(await val(db,'select private.can_write_business($1) v',[B]),false)
  await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[S])
  await actor(db);assert.equal(await val(db,"select private.fin_access($1,'profile') v",[B]),false)
  assert.equal(await val(db,'select private.is_business_member($1) v',[B]),false)
 }finally{await db.close()}
})
test('role and membership changes take effect with the same active session; privileged session data stays private',async()=>{
 const db=await setup();try{
  await db.query("update business_members set role='viewer',access_modules='{}' where user_id=$1",[U])
  await actor(db)
  assert.equal(await val(db,'select private.can_write_business($1) v',[B]),false)
  assert.equal(await val(db,"select private.member_module_access($1,$2,'billing') v",[B,U]),false)
  await assert.rejects(db.query('select * from auth.sessions'),/permission denied/)
  await db.exec('reset role');await db.query('delete from business_members where user_id=$1',[U])
  await actor(db);assert.equal(await val(db,'select private.is_business_member($1) v',[B]),false)
  await db.exec('reset role;set role anon');await db.query('select check_request_session()');await assert.rejects(db.query('select current_session_actor()'),/permission denied/)
  await db.exec('reset role;set role service_role');await db.query('select check_request_session()');await assert.rejects(db.query('select current_session_actor()'),/permission denied/)
 }finally{await db.close()}
})
