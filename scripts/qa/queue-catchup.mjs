import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {ownedReplayContainer,cleanupSyntheticFixture} from './synthetic-restore.mjs'

export const QUEUE_LIMITS=Object.freeze({workspaces:300,dispatchers:4,claimCeiling:2400,timeoutMs:120000,providerDelayMs:10})
export function ownedQueueTarget(value,projectId){
 ownedReplayContainer(projectId)
 const url=new URL(value)
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='54322'||url.pathname!=='/postgres'||url.username!=='postgres'||url.search||url.hash)throw Error('Queue catch-up requires the owned local replay database')
 return url.href
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const percentile=(values,f)=>{const sorted=[...values].sort((a,b)=>a-b);return Math.round(sorted[Math.max(0,Math.ceil(sorted.length*f)-1)]||0)}

// Measures real queue preparation/claim/finish functions through independent
// PostgreSQL service-role sessions. Provider delivery is a fixed local delay.
// This does not execute the hosted Edge worker or its cron cadence.
export async function verifyQueueCatchup(db,localUrl,{projectId}){
 const connectionString=ownedQueueTarget(localUrl,projectId)
 assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(Number(db.connectionParameters.port),54322)
 const initial=(await db.query("select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from storage.objects) files,current_setting('cron.launch_active_jobs') cron,not exists(select 1 from vault.secrets) empty_vault,not exists(select 1 from private.tier_worker_config where enabled or endpoint is not null) delivery_disabled")).rows[0]
 assert.deepEqual(initial,{users:0,businesses:0,files:0,cron:'off',empty_vault:true,delivery_disabled:true})
 const actors=[],peers=Array.from({length:QUEUE_LIMITS.dispatchers},()=>new pg.Client({connectionString,statement_timeout:15000,connectionTimeoutMillis:5000})),dispatches=new Set(),claimTimes=[]
 let claims=0,skipped=0,uncertain=null,report
 try{
  await db.query('begin')
  for(let n=0;n<QUEUE_LIMITS.workspaces;n++){
   const a={user:randomUUID(),business:randomUUID(),customer:randomUUID(),appointment:randomUUID()};actors.push(a)
   await db.query("insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values($1,'authenticated','authenticated',$2,now(),now(),now())",[a.user,'queue-'+n+'@example.test'])
   await db.query("insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values($1,'2026-11-06-v5',true,true,true)",[a.user])
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a.user])
   await db.query("insert into public.businesses(id,name,created_by_user_id,timezone) values($1,'Synthetic queue catch-up',$2,'America/New_York')",[a.business,a.user])
   await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro') on conflict(business_id) do update set plan='pro',valid_until=null",[a.business])
   await db.query("insert into public.customers(id,business_id,first_name,email,preferred_contact) values($1,$2,'Synthetic reminder','queue-recipient@example.test','email')",[a.customer,a.business])
   await db.query("insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'synthetic-owner@example.test') on conflict(business_id) do update set email_active=true,reply_to=excluded.reply_to",[a.business])
   await db.query("insert into private.appointment_reminder_rules(business_id,actor_id,enabled,lead_hours,channel) values($1,$2,true,48,'email')",[a.business,a.user])
   await db.query("insert into public.appointments(id,business_id,customer_id,title,starts_at,ends_at,status,created_at) values($1,$2,$3,'Synthetic queue arrival',now()+interval '24 hours',now()+interval '25 hours','confirmed',now()-interval '3 days')",[a.appointment,a.business,a.customer])
  }
  await db.query('commit')
  await Promise.all(peers.map(async c=>{await c.connect();await c.query('set role service_role')}))
  const prepareStart=performance.now();let prepared=0,prepareCalls=0
  while(prepared<QUEUE_LIMITS.workspaces){
   assert.ok(++prepareCalls<=7,'Preparation must progress within bounded batches')
   const n=(await peers[0].query('select public.prepare_due_appointment_reminders() n')).rows[0].n
   assert.ok(n>0&&n<=50);prepared+=n
  }
  assert.equal((await peers[0].query('select public.prepare_due_appointment_reminders() n')).rows[0].n,0)
  const preparationMs=Math.round(performance.now()-prepareStart)
  const before=(await db.query("select count(*)::int queued,round(extract(epoch from now()-min(due_at)))::int oldestLagSeconds from private.appointment_reminder_queue where status='queued'")).rows[0]
  assert.equal(before.queued,300);assert.ok(before.oldestlagseconds>=86400)
  const start=performance.now(),deadline=Date.now()+QUEUE_LIMITS.timeoutMs
  const results=await Promise.allSettled(peers.map(async c=>{
   for(;;){
    assert.ok(Date.now()<deadline,'Queue catch-up deadline exceeded')
    const due=(await c.query('select * from public.list_due_appointment_reminders(true,false)')).rows
    if(!due.length)return
    assert.ok(due.length<=25)
    for(const row of due){
     assert.ok(++claims<=QUEUE_LIMITS.claimCeiling,'Queue claim ceiling exceeded')
     const begin=performance.now(),value=(await c.query('select public.claim_appointment_reminder($1,false) value',[row.id])).rows[0].value
     claimTimes.push(performance.now()-begin)
     if(value.status!=='claimed'){assert.ok(['sending','accepted','uncertain'].includes(value.status));skipped++;continue}
     assert.ok(!dispatches.has(row.id),'A queue occurrence was dispatched twice');dispatches.add(row.id)
     const ambiguous=uncertain===null;if(ambiguous)uncertain=row.id
     await sleep(QUEUE_LIMITS.providerDelayMs)
     await c.query('select public.finish_appointment_reminder($1,$2,$3)',[row.id,ambiguous?'uncertain':'accepted',ambiguous?null:randomUUID()])
    }
   }
  }))
  for(const result of results)if(result.status==='rejected')throw result.reason
  const catchupMs=Math.round(performance.now()-start)
  assert.equal(dispatches.size,300)
  const after=(await db.query("select (select count(*)::int from private.appointment_reminder_queue where status='queued') queued,(select count(*)::int from private.appointment_reminder_queue where status='sending') sending,(select count(*)::int from private.appointment_reminder_queue where status='accepted') accepted,(select count(*)::int from private.appointment_reminder_queue where status='uncertain') uncertain,(select count(*)::int from private.tier_operations where feature='email') reservations,(select count(*)::int from public.messages) messages")).rows[0]
  assert.deepEqual(after,{queued:0,sending:0,accepted:299,uncertain:1,reservations:300,messages:299})
  assert.equal((await peers[0].query('select public.claim_appointment_reminder($1,false) value',[uncertain])).rows[0].value.status,'uncertain')
  assert.equal((await peers[0].query('select public.prepare_due_appointment_reminders() n')).rows[0].n,0)
  assert.equal((await peers[0].query('select * from public.list_due_appointment_reminders(true,false)')).rows.length,0)
  report={scope:'isolated PostgreSQL reminder queue with simulated provider outcomes',limits:QUEUE_LIMITS,prepared,prepareCalls,preparationMs,before,catchupMs,claims,overlappingClaimsSkipped:skipped,claimP95Ms:percentile(claimTimes,.95),claimP99Ms:percentile(claimTimes,.99),after,duplicateDispatches:0,uncertainRetained:true,externalProviderRequests:0,limitations:['Synthetic database identities; genuine JWT acceptance is measured separately.','Four local SQL dispatcher loops; hosted Edge runtime, cron cadence and real delivery are not measured.','An uncertain synthetic outcome remains for reconciliation and is never resent.']}
 }finally{
  await db.query('rollback').catch(()=>{})
  await Promise.all(peers.map(c=>c.end().catch(()=>{})))
  await cleanupSyntheticFixture(db,{projectId,expectedUsers:actors.map(a=>a.user),expectedBusinesses:actors.map(a=>a.business)})
 }
 const cleanup=(await db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from private.appointment_reminder_queue) queued,(select count(*)::int from public.messages) messages')).rows[0]
 assert.deepEqual(cleanup,{users:0,businesses:0,queued:0,messages:0})
 return {...report,cleanup}
}
