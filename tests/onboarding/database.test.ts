import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile('supabase/migrations/20261108203002_streamlined_business_onboarding.sql','utf8')
const guard=await readFile('supabase/migrations/20261108203653_onboarding_owner_role_guard.sql','utf8')
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',old='44444444-4444-4444-8444-444444444444'
async function fixture(){const db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;create schema auth;grant usage on schema private,auth to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create table public.businesses(id uuid primary key,created_by_user_id uuid,name text,email text,phone text);
 create table public.business_members(business_id uuid,user_id uuid,role text);
 insert into auth.users values('${owner}',now()),('${other}',now());
 insert into public.businesses values('${old}','${owner}','Old business',null,null);insert into public.business_members values('${old}','${owner}','owner');`);await db.exec(sql);await db.exec(guard);await db.exec(`insert into public.businesses values('${id}','${owner}','New business',null,null);insert into public.business_members values('${id}','${owner}','owner');set role authenticated;select set_config('test.uid','${owner}',false);`);return db}
async function status(db:PGlite,channel:string|null=null,complete=false,business=id){return (await db.query<any>('select public.business_onboarding_status($1,$2,$3) result',[business,channel,complete])).rows[0].result}
test('new setup resumes, validates selected contact channels, completes idempotently and preserves existing businesses',async()=>{const db=await fixture();try{
 assert.equal((await status(db,null,false,old)).required,false)
 assert.equal((await status(db)).required,true)
 await assert.rejects(status(db,'email'),/reply email/)
 await db.exec(`reset role;update businesses set email='office@example.test' where id='${id}';set role authenticated`)
 assert.equal((await status(db,'email')).channels,'email')
 assert.equal((await status(db)).required,true)
 await assert.rejects(status(db,'both',true),/mobile/)
 await db.exec(`reset role;update businesses set phone='7575550123' where id='${id}';set role authenticated`)
 assert.equal((await status(db,'both',true)).completed,true)
 assert.equal((await status(db)).required,false)
 assert.equal((await status(db,'both',true)).completed,true)
 }finally{await db.close()}})
test('raw APIs reject outsiders, unverified users and anonymous reads',async()=>{const db=await fixture();try{
 await db.exec(`select set_config('test.uid','${other}',false)`);await assert.rejects(status(db),/Not authorized/)
 await db.exec(`reset role;insert into business_members values('${id}','${other}','office');set role authenticated`)
 assert.equal((await status(db)).required,false);await assert.rejects(status(db,'text'),/owner/)
 await db.exec(`reset role;update auth.users set email_confirmed_at=null where id='${other}';set role authenticated`);await assert.rejects(status(db),/Verify/)
 await assert.rejects(db.exec('select * from private.business_onboarding'),/permission denied/)
 await db.exec('reset role;set role anon');await assert.rejects(status(db),/permission denied/)
 }finally{await db.close()}})
