import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222'
async function fixture(){
 const db=new PGlite()
 await db.exec('create role anon;create role authenticated;create role service_role;create schema private;')
 await db.exec((await readFile('supabase/migrations/20261110165000_shared_provider_burst_limits.sql','utf8')).split('-- Fail closed on schema drift')[0])
 for(const table of ['finviant_email_outbox','managed_sms','business_card_sms'])await db.exec(`create table private.${table}(id int primary key,business_id uuid,actor_id uuid,status text,attempts int default 0);`)
 await db.exec('create table private.appointment_reminder_queue(id int primary key,business_id uuid,channel text,snapshot jsonb,status text);')
 await db.exec((await readFile('supabase/migrations/20261112212813_abuse_cost_backpressure.sql','utf8')).split('-- Keep original authorization')[0])
 return db
}
test('daily ceilings fail atomically, cannot be reset by clients, and recover on the next UTC day',async()=>{
 const db=await fixture()
 try{
  for(const [resource,cap] of Object.entries({ai:7200,receipt:3600,upload:18000,pdf:7200,email:6000,sms:3000})){
   await db.query("insert into private.provider_daily_attempts values($1,(clock_timestamp() at time zone 'UTC')::date,$2)",[resource,cap-1])
   await db.query('select private.reserve_provider_burst($1,$2,$3)',[resource,B,A])
   const before=(await db.query('select * from private.provider_burst_buckets order by resource,scope')).rows
   await assert.rejects(db.query('select private.reserve_provider_burst($1,$2,$3)',[resource,B,A]),(error:any)=>{
    assert.equal(JSON.parse(error.message).code,'FINVIANT_DAILY_LIMIT');const retry=Number(JSON.parse(error.detail).headers['Retry-After']);assert.ok(retry>0&&retry<=86400);return true
   })
   assert.deepEqual((await db.query('select * from private.provider_burst_buckets order by resource,scope')).rows,before)
  }
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role)
   for(const sql of ["select private.reserve_daily_provider_attempt('ai')",'select * from private.provider_daily_attempts','delete from private.provider_daily_attempts'])await assert.rejects(db.exec(sql),{code:'42501'})
   await db.exec('reset role')
  }
  await db.exec("update private.provider_daily_attempts set period=period-1")
  await db.query("select private.reserve_provider_burst('email',$1,$2)",[B,A])
  assert.equal((await db.query("select attempts from private.provider_daily_attempts where resource='email'")).rows[0].attempts,1)
 }finally{await db.close()}
})
test('all messaging claims share a budget, denied claims retain queued state, and acknowledged retries spend nothing',async()=>{
 const db=await fixture()
 try{
  for(const table of ['finviant_email_outbox','managed_sms','business_card_sms']){
   const resource=table==='finviant_email_outbox'?'email':'sms',cap=resource==='email'?6000:3000
   await db.exec('truncate private.provider_burst_buckets,private.provider_daily_attempts')
   await db.query(`insert into private.${table}(id,business_id,actor_id,status) values(1,$1,$2,'queued')`,[B,A])
   await db.query("insert into private.provider_daily_attempts values($1,(clock_timestamp() at time zone 'UTC')::date,$2)",[resource,cap])
   await assert.rejects(db.exec(`update private.${table} set status='sending',attempts=attempts+1 where id=1`),{code:'PGRST'})
   assert.deepEqual((await db.query(`select status,attempts from private.${table}`)).rows,[{status:'queued',attempts:0}])
   await db.exec('update private.provider_daily_attempts set attempts=0')
   await db.exec(`update private.${table} set status='sending',attempts=attempts+1 where id=1;update private.${table} set status='accepted' where id=1;update private.${table} set status='accepted' where id=1;`)
   assert.equal((await db.query('select attempts from private.provider_daily_attempts')).rows[0].attempts,1)
  }
  await db.exec('truncate private.provider_burst_buckets,private.provider_daily_attempts')
  await db.query(`insert into private.appointment_reminder_queue values(1,$1,'email',jsonb_build_object('actor_id',$2::text),'queued')`,[B,A])
  await db.exec("update private.appointment_reminder_queue set status='sending' where id=1")
  assert.equal((await db.query("select attempts from private.provider_daily_attempts where resource='email'")).rows[0].attempts,1)
 }finally{await db.close()}
})
