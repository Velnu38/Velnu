import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('worker health reports stalled work, recovers, and retains service-only aggregate access',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
   create table private.finviant_email_outbox(status text,created_at timestamptz);
   create table private.finviant_payment_events(state text);
   create table private.calendar_sync_queue(dead boolean,available_at timestamptz);
   create table private.calendar_integrations(auto_sync boolean,state text);
   create table private.appointment_reminder_queue(status text,due_at timestamptz,updated_at timestamptz);
   create table private.recurring_invoice_plans(status text,next_date date,timezone text,last_error text);
   create function public.finviant_ops_health() returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
   revoke all on function public.finviant_ops_health() from public,anon,authenticated;
   grant execute on function public.finviant_ops_health() to service_role;`)
  await db.exec(await readFile('supabase/migrations/20261110134000_worker_health_coverage.sql','utf8'))
  const health=async()=>(await db.query<{health:Record<string,unknown>}>('select public.finviant_ops_health() health')).rows[0].health
  const empty=await health()
  assert.equal(empty.database,'reachable')
  assert.ok(empty.checked_at)
  assert.ok(Object.entries(empty).filter(([k])=>!['database','checked_at'].includes(k)).every(([,v])=>v===0))
  await db.exec(`insert into private.calendar_sync_queue values(false,now()-interval '1 hour'),(false,now()+interval '1 hour'),(true,now());
   insert into private.calendar_integrations values(true,'reconnect_required'),(false,'reconnect_required'),(true,'connected');
   insert into private.appointment_reminder_queue values('queued',now()-interval '1 hour',now()),('queued',now()+interval '1 hour',now()),('uncertain',now(),now()),('blocked',now()-interval '1 day',now()),('failed',now(),now()),('failed',now(),now()-interval '2 days');
   insert into private.recurring_invoice_plans values('active',current_date-1,'UTC',null),('active',current_date+1,'UTC',null),('paused',current_date-1,'UTC',null),('paused',current_date-1,'UTC','Private provider error'),('ended',current_date-1,'UTC','Private provider error');`)
  const bad=await health()
  for(const [key,value] of Object.entries({calendar_queued:2,calendar_stale:1,calendar_dead:1,calendar_reconnect_required:1,appointment_queued:2,appointment_stale:1,appointment_uncertain:1,appointment_blocked:1,appointment_failed_last_day:1,recurring_overdue:1,recurring_needs_review:1}))assert.equal(bad[key],value,key)
  assert.doesNotMatch(JSON.stringify(bad),/Private provider error/)
  await db.exec('set role service_role')
  assert.deepEqual(Object.keys(await health()).sort(),Object.keys(empty).sort())
  await assert.rejects(db.exec('select * from private.calendar_integrations'),{code:'42501'})
  await db.exec('reset role')
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role)
   await assert.rejects(health(),{code:'42501'})
   await db.exec('reset role')
  }
  await db.exec(`delete from private.calendar_sync_queue;update private.calendar_integrations set state='connected';
   update private.appointment_reminder_queue set status='accepted';update private.recurring_invoice_plans set next_date=current_date+1,last_error=null;`)
  assert.deepEqual({...await health(),checked_at:empty.checked_at},empty)
 }finally{await db.close()}
})
