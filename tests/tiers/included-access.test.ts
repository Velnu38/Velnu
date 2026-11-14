import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,plan,user,B,U,O} from './fixture'
test('single-user tiers suspend other team access without deleting memberships; Pro restores it',async()=>{const db=await fixture();try{
 const sql=await readFile('supabase/migrations/20261106155000_included_tier_access.sql','utf8');const functions=sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g)||[]
 for(const f of functions){if(/FUNCTION private.(execute_confirmed_action|create_recurring_invoice|process_recurring_plan|set_recurring_invoice_status)/.test(f))continue;await db.exec(f)}
 await db.query('insert into user_agreement_acceptances(user_id,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values($1,true,true,true)',[O])
 await db.exec("update user_agreement_acceptances set agreement_version='2026-11-06-v5'");
 await plan(db,'free');await user(db,O);assert.equal((await db.query<any>('select private.is_business_member($1) ok',[B])).rows[0].ok,false);assert.equal((await db.query<any>("select private.member_module_access($1,$2,'billing') ok",[B,O])).rows[0].ok,false)
 await plan(db,'pro');await user(db,O);assert.equal((await db.query<any>('select private.is_business_member($1) ok',[B])).rows[0].ok,true);assert.equal((await db.query('select * from business_members')).rows.length,2)
}finally{await db.close()}})
test('worker authentication is server-only and scheduling contains no credential literal',async()=>{const db=await fixture();try{
 await db.exec("create schema net;create schema cron;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;")
 const sql=(await readFile('supabase/migrations/20261106152226_tier_scheduler_activation.sql','utf8')).replace('create extension if not exists pg_net;','');await db.exec(sql)
 await user(db);await assert.rejects(()=>db.query('select * from private.tier_worker_config'),/permission denied/);await assert.rejects(()=>db.query('select authorize_tier_worker($1)',['a'.repeat(64)]),/permission denied/)
 await db.exec('reset role');assert.equal((await db.query<any>('select authorize_tier_worker($1) ok',['a'.repeat(64)])).rows[0].ok,false)
 assert.match(sql,/select private.dispatch_tier_worker\(\)/)
}finally{await db.close()}})
