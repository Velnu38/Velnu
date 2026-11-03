import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const migration=await readFile('supabase/migrations/20261103213450_ten_pro_test_accounts.sql','utf8')
const uid=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
async function setup(){const db=new PGlite();await db.exec(`
 create role authenticated;create role anon;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key);
 create table public.user_plan_preferences(user_id uuid primary key references auth.users,selected_tier text);
 create table public.businesses(id uuid primary key,created_by_user_id uuid);
 create table private.business_entitlements(business_id uuid primary key,plan text,valid_until timestamptz,updated_at timestamptz default now());
 create table private.workspace_feature_flags(name text primary key,enabled boolean);
 grant usage on schema private to authenticated;
 `);await db.exec(migration);return db}
test('private testing admits exactly ten logins, rejects the eleventh atomically and preserves login-independent Pro entitlement without expiry',async()=>{
 const db=await setup();try{
  await db.exec("update private.workspace_feature_flags set enabled=true where name='ten_pro_test_accounts'")
  for(let n=1;n<=10;n++)await db.query('insert into auth.users values($1)',[uid(n)])
  await assert.rejects(db.query('insert into auth.users values($1)',[uid(11)]),/limited to 10/)
  assert.equal((await db.query<any>('select count(*)::int n from auth.users')).rows[0].n,10)
  assert.equal((await db.query<any>("select count(*)::int n from user_plan_preferences where selected_tier='pro'")).rows[0].n,10)
  await db.query('insert into public.businesses values($1,$2)',[uid(100),uid(1)])
  const entitlement=(await db.query<any>('select * from private.business_entitlements')).rows[0]
  assert.equal(entitlement.plan,'pro');assert.equal(entitlement.valid_until,null)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from private.test_account_slots'),/permission denied/)
  await assert.rejects(db.query('update private.workspace_feature_flags set enabled=false'),/permission denied/)
  await db.exec('reset role')
  // A deleted login releases one slot. Confirmation/password resets do not insert another user.
  await db.query('delete from user_plan_preferences where user_id=$1',[uid(10)])
  await db.query('delete from auth.users where id=$1',[uid(10)])
  await db.query('insert into auth.users values($1)',[uid(11)])
  assert.equal((await db.query<any>('select count(*)::int n from private.test_account_slots')).rows[0].n,10)
 }finally{await db.close()}
})
test('disabled configuration never caps production signups or grants Pro to arbitrary workspaces',async()=>{
 const db=await setup();try{
  for(let n=1;n<=11;n++)await db.query('insert into auth.users values($1)',[uid(n)])
  await db.query('insert into public.businesses values($1,$2)',[uid(100),uid(1)])
  assert.equal((await db.query<any>('select count(*)::int n from private.test_account_slots')).rows[0].n,0)
  assert.equal((await db.query<any>('select count(*)::int n from private.business_entitlements')).rows[0].n,0)
 }finally{await db.close()}
})
