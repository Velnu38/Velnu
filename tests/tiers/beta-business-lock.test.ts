import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,user,plan,B,U,O} from './fixture'
const V='99999999-9999-4999-8999-999999999999',W='88888888-8888-4888-8888-888888888888'
const migration=await readFile('supabase/migrations/20261108213818_beta_business_only_access.sql','utf8')
test('only the named administrator tests tiers; other current/future beta workspaces remain Pro despite stale overrides',async()=>{const db=await fixture();try{
 await db.exec(`reset role;alter table auth.users add column email text;alter table auth.users add column email_confirmed_at timestamptz;update auth.users set email='mbarone5@verizon.net',email_confirmed_at=now() where id='${U}';insert into private.platform_operators(user_id,active) values('${U}',true);insert into private.workspace_feature_flags(name,enabled) values('ten_pro_test_accounts',true) on conflict(name) do update set enabled=true;`)
 await db.exec(migration)
 for(const tier of ['free','basic','pro']){const usage:any=await plan(db,tier);assert.equal(usage.plan,tier);assert.equal(usage.can_test,true);assert.equal(usage.beta_locked,false)}
 await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${V}','tester@example.test',now());insert into public.businesses(id,name,created_by_user_id,email) values('${W}','External beta','${V}','tester@example.test');insert into public.business_members(business_id,user_id,role) values('${W}','${V}','owner');insert into private.test_account_slots(slot,user_id) values(2,'${V}');insert into private.tier_test_overrides(business_id,tier,actor_id) values('${W}','free','${V}');`)
 await user(db,V)
 const usage=(await db.query<any>('select public.get_plan_usage($1) u',[W])).rows[0].u
 assert.equal(usage.plan,'pro');assert.equal(usage.beta_locked,true);assert.equal(usage.can_test,false);assert.equal(usage.testing,false)
 for(const tier of ['free','basic','pro',null])await assert.rejects(db.query('select public.set_tier_test($1,$2)',[W,tier]),/authorized primary owner/)
 await assert.rejects(db.exec('select * from private.beta_tier_test_admins'),/permission denied/)
 await assert.rejects(db.query('select public.get_plan_usage($1)',[B]),/Not authorized/)
 await db.exec("reset role;update private.workspace_feature_flags set enabled=false where name='ten_pro_test_accounts'");assert.equal((await db.query<any>('select private.effective_plan($1) p',[W])).rows[0].p,'free')
 }finally{await db.close()}})
