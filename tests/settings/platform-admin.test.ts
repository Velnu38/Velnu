import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile('supabase/migrations/20261103215156_platform_admin_support.sql','utf8')
const id=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`
const OP=id(1),CUSTOMER=id(2),OTHER=id(3),B=id(10),X=id(11),SID=id(20),CASE=id(30)
async function setup(){const db=new PGlite();await db.exec(`
create role authenticated;create role anon;create role service_role;create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create table public.businesses(id uuid primary key,name text);
create table public.business_members(business_id uuid,user_id uuid,role text);
create table private.workspace_feature_flags(name text primary key,enabled boolean);
create table private.business_entitlements(business_id uuid,plan text,valid_until timestamptz);
create table private.finviant_email_outbox(status text);
create function private.is_business_member(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid())$$;
create function private.is_pro(b uuid) returns boolean language sql stable as $$select false$$;
grant usage on schema private,public,auth to authenticated;
insert into auth.users(id,email,email_confirmed_at) values('${OP}','owner@example.test',now()),('${CUSTOMER}','customer@example.test',now()),('${OTHER}','other@example.test',now());
insert into auth.sessions values('${SID}','${OP}');insert into auth.mfa_factors values('${id(21)}','${OP}','verified');insert into businesses values('${B}','Test business'),('${X}','Other business');
insert into business_members values('${B}','${CUSTOMER}','owner'),('${X}','${OTHER}','owner');
`);await db.exec(sql);await db.exec(`insert into private.platform_operators(user_id) values('${OP}');update private.workspace_feature_flags set enabled=true;`);return db}
async function actor(db:PGlite,who:string,aal:string|null='aal2',session=SID){await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[who,JSON.stringify({aal,session_id:session})])}
async function admin(db:PGlite,action:string,input:any={}){return(await db.query<any>('select public.platform_admin_request($1,$2) r',[action,input])).rows[0].r}
async function support(db:PGlite,business:string,action:string,input:any={}){return(await db.query<any>('select public.support_request($1,$2,$3) r',[business,action,input])).rows[0].r}
async function createCase(db:PGlite){await actor(db,CUSTOMER);return support(db,B,'create',{request_id:CASE,title:'Calendar issue',description:'The reminder is missing.',priority:'normal'})}
test('operator role, confirmed identity, live session and MFA are independently required, including raw RPC calls',async()=>{
 const db=await setup();try{
  await actor(db,CUSTOMER);assert.match((await admin(db,'overview')).error,/restricted/)
  await actor(db,OP,'aal1');assert.equal((await admin(db,'access')).mfa_required,true);assert.match((await admin(db,'accounts')).error,/authenticator/)
  await actor(db,OP,null);assert.match((await admin(db,'overview')).error,/authenticator/)
  await actor(db,OP,'aal2',id(21));assert.match((await admin(db,'overview')).error,/restricted/)
  await actor(db,OP);assert.equal((await admin(db,'overview')).accounts,3)
  await db.exec(`update private.platform_operators set active=false`);assert.match((await admin(db,'cases')).error,/restricted/)
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from private.platform_operators'),/permission denied/);await assert.rejects(db.query("update private.platform_operators set active=true"),/permission denied/)
 }finally{await db.close()}
})
test('support cases isolate reporters and tenants, preserve stable retries, and never expose internal notes',async()=>{
 const db=await setup();try{
  await createCase(db);assert.equal((await createCase(db)).case.id,CASE)
  assert.equal((await db.query<any>('select count(*)::int n from private.support_cases')).rows[0].n,1)
  await actor(db,OTHER);assert.match((await support(db,X,'detail',{id:CASE})).error,/unavailable/);assert.match((await support(db,B,'list')).error,/access/)
  await actor(db,OP);const input={id:CASE,request_id:id(40),version:1,status:'in_progress',priority:'high',audience:'internal',body:'Investigating internal configuration.'}
  const first=await admin(db,'update_case',input);assert.equal(first.case.version,2);assert.equal((await admin(db,'update_case',input)).case.version,2)
  assert.equal((await admin(db,'update_case',{...input,request_id:id(41)})).conflict,true)
  await actor(db,CUSTOMER);const own=await support(db,B,'detail',{id:CASE});assert.equal(own.messages.length,0);assert.equal(own.case.status,'in_progress')
  await actor(db,OP);await admin(db,'update_case',{...input,request_id:id(42),version:2,audience:'customer',body:'Please retry your reminder.',status:'resolved'})
  await actor(db,CUSTOMER);const visible=await support(db,B,'detail',{id:CASE});assert.equal(visible.messages.length,1);assert.equal(visible.messages[0].body,'Please retry your reminder.')
  const reply={id:CASE,request_id:id(43),body:'It still fails.'};assert.equal((await support(db,B,'reply',reply)).case.status,'open');const retry=await support(db,B,'reply',reply);assert.equal(retry.messages.length,2)
 }finally{await db.close()}
})
test('overview, masked accounts and bounded audit contain no customer business contents or fabricated revenue',async()=>{
 const db=await setup();try{await actor(db,OP);const r=await admin(db,'accounts',{search:'customer'});assert.equal(r.total,1);assert.equal(r.rows[0].email,'c***@example.test');assert.equal(r.rows[0].password,undefined)
  assert.equal((await admin(db,'overview')).billing,'Live billing not activated');assert.equal((await admin(db,'cases')).total,0)
  const events=await admin(db,'audit');assert.ok(events.rows.length>0);assert.equal(events.rows[0].actor,undefined)
  assert.match((await admin(db,'drop_database')).error,/Unknown/)
 }finally{await db.close()}
})
