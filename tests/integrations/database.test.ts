import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444',R='55555555-5555-4555-8555-555555555555'
const sql=await readFile('supabase/migrations/20261103194234_private_integration_testing.sql','utf8')
const smsSql=await readFile('supabase/migrations/20261104001810_require_sms_owner_mobile.sql','utf8')
async function setup(){const db=new PGlite();await db.exec(`
 create role authenticated;create role anon;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.businesses(id uuid primary key,created_by_user_id uuid,currency text,phone text);
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
 create table public.invoices(id uuid primary key,business_id uuid,invoice_number text,status text,balance_due numeric,created_at timestamptz default now());
 create function private.is_primary_owner(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.businesses where id=b and created_by_user_id=auth.uid())$$;
 grant usage on schema public,private,auth to authenticated,service_role;grant execute on function auth.uid() to authenticated;
 insert into public.businesses(id,created_by_user_id,currency,phone) values('${B}','${O}','USD','+17575550123');insert into auth.users values('${O}',now(),'17575550123',now(),'{}');insert into public.invoices values('${I}','${B}','INV-TEST','sent',12.50,now());
 `);await db.exec(sql);await db.exec(smsSql);await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${O}',false);`);return db}
test('database owner scope, immutable retries, invoice amount derivation, single outstanding checkout and isolated receipts',async()=>{
 const db=await setup();try{
  await db.exec(`select set_config('request.jwt.claim.sub','${X}',false)`);await assert.rejects(db.query('select public.get_integration_test_context($1)',[B]),/primary owner/)
  await db.exec(`select set_config('request.jwt.claim.sub','${O}',false)`)
  const reserve=()=>db.query<any>('select public.reserve_integration_test($1,$2,$3,$4) value',[B,R,'invoice',{invoice_id:I}])
  const first=(await reserve()).rows[0].value;assert.equal(first.fresh,true);assert.equal(first.input.amount_cents,1250)
  assert.equal((await reserve()).rows[0].value.fresh,false)
  await assert.rejects(db.query('select public.reserve_integration_test($1,$2,$3,$4)',[B,R,'sms',{phone:'+17575550123'}]),/another operation/)
  await assert.rejects(db.query('select public.reserve_integration_test($1,$2,$3,$4)',[B,X,'invoice',{invoice_id:I}]),/existing test/)
  await assert.rejects(db.query('select public.finish_integration_test($1,$2,$3,$4,$5)',[R,'open','cs_test_1','acct_merchant',{}]),/permission denied/)
  await db.exec('reset role;set role service_role')
  await db.query('select public.finish_integration_test($1,$2,$3,$4,$5)',[R,'open','cs_test_1','acct_merchant',{}])
  const event=(account='acct_merchant')=>db.query<any>('select public.record_integration_test_event($1,$2,$3,$4,$5,$6,$7) ok',['stripe','evt_1',R,'cs_test_1',account,'paid',{amount_cents:1250}])
  assert.equal((await event('acct_wrong')).rows[0].ok,false);assert.equal((await event()).rows[0].ok,true);assert.equal((await event()).rows[0].ok,true)
  await db.query('select public.finish_integration_test($1,$2,$3,$4,$5)',[R,'open','cs_test_1','acct_merchant',{}])
  await db.exec('reset role')
  assert.equal((await db.query<any>('select status from private.integration_test_operations')).rows[0].status,'paid')
  assert.equal((await db.query<any>('select count(*)::int n from private.integration_test_events')).rows[0].n,1)
  assert.equal(Number((await db.query<any>('select balance_due from public.invoices')).rows[0].balance_due),12.5)
  assert.equal((await db.query<any>('select count(*)::int n from private.integration_test_state')).rows[0].n,0)
 }finally{await db.close()}
})
test('early Twilio delivery survives late acceptance and its record cannot be forged by authenticated users',async()=>{
 const db=await setup();try{
  await db.query('select public.reserve_integration_test($1,$2,$3,$4)',[B,R,'sms',{phone:'+17575550123',consent:true}]);
  await assert.rejects(db.query('select * from private.integration_test_operations'),/permission denied/)
  await db.exec('reset role;set role service_role')
  const sid='SM'+'a'.repeat(32)
  await db.query('select public.record_integration_test_event($1,$2,$3,$4,$5,$6,$7)',['twilio',sid+':delivered',R,sid,null,'delivered',{}])
  await db.query('select public.finish_integration_test($1,$2,$3,$4,$5)',[R,'accepted',sid,null,{}])
  await db.exec('reset role');assert.equal((await db.query<any>('select status from private.integration_test_operations')).rows[0].status,'delivered')
 }finally{await db.close()}
})

test('SMS requires the primary owner Auth-confirmed phone; profile text, JWT claims and unverified Auth phones cannot bypass it',async()=>{
 const db=await setup();try{
  const status=async()=>(await db.query<any>('select public.get_sms_setup_status($1) value',[B])).rows[0].value
  assert.deepEqual(await status(),{owner_mobile_verified:true,phone_last4:'0123',customer_sms_enabled:false})
  await db.exec(`reset role;update auth.users set phone_confirmed_at=null,raw_user_meta_data='{"phone_verified":true}';set role authenticated;`)
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({phone_verified:true,phone:'+17575550123'})])
  assert.equal((await status()).owner_mobile_verified,false);assert.equal((await status()).phone_last4,null)
  assert.equal((await db.query<any>('select public.get_integration_test_context($1) value',[B])).rows[0].value.sms_owner_verified,false)
  await assert.rejects(db.query('select public.reserve_integration_test($1,$2,$3,$4)',[B,R,'sms',{phone:'+17575550123',consent:true}]),/Verify the primary owner mobile/)
  await assert.rejects(db.query("update auth.users set phone_confirmed_at=now()"),/permission denied/)
  await db.exec(`select set_config('request.jwt.claim.sub','${X}',false)`);await assert.rejects(status(),/primary business owner/)
  await db.exec(`select set_config('request.jwt.claim.sub','${O}',false)`)
  // Unverified mobile never blocks a non-SMS invoice test or email sign-in.
  assert.equal((await db.query<any>('select public.reserve_integration_test($1,$2,$3,$4) value',[B,R,'invoice',{invoice_id:I}])).rows[0].value.fresh,true)
 }finally{await db.close()}
})
