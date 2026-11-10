import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {cleanupSyntheticFixture,ownedReplayContainer} from './synthetic-restore.mjs'

export const COMMERCE_LIMITS=Object.freeze({workspaces:20,connections:20,statementMs:15000})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
// Separate real PostgreSQL sessions. Never accepts a hosted connection or provider.
export async function verifyCommerceConcurrency(db,connectionString,{projectId}){
 ownedReplayContainer(projectId)
 const url=new URL(connectionString)
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'54322');assert.equal(url.pathname,'/postgres');assert.equal(url.search,'')
 const initial=(await db.query("select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from storage.objects) files,current_setting('cron.launch_active_jobs') cron,not exists(select 1 from vault.secrets) empty_vault")).rows[0]
 assert.deepEqual(initial,{users:0,businesses:0,files:0,cron:'off',empty_vault:true})
 const actors=[],peers=Array.from({length:20},()=>new pg.Client({connectionString,statement_timeout:COMMERCE_LIMITS.statementMs,connectionTimeoutMillis:5000})),times=[]
 let report,blocked=0
 try{
  await db.query('begin')
  for(let n=0;n<20;n++){
   const a={user:randomUUID(),business:randomUUID(),customer:randomUUID(),estimates:[]};actors.push(a)
   await db.query("insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values($1,'authenticated','authenticated',$2,now(),now(),now())",[a.user,'commerce-'+n+'@example.test'])
   await db.query("insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values($1,'2026-11-06-v5',true,true,true)",[a.user])
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a.user])
   await db.query("insert into public.businesses(id,name,created_by_user_id,timezone) values($1,'Synthetic concurrency',$2,'UTC')",[a.business,a.user])
   await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro') on conflict(business_id) do update set plan='pro',valid_until=null",[a.business])
   await db.query("insert into public.customers(id,business_id,first_name) values($1,$2,'Synthetic customer')",[a.customer,a.business])
   await db.query('set local role authenticated')
   await db.query('select public.save_scheduling_preferences($1,$2)',[a.business,{work_days:[1,2,3,4,5,6,7],start_minutes:480,end_minutes:1020,duration_minutes:60,buffer_minutes:0,notice_hours:0}])
   const payload={customer_id:a.customer,issue_date:new Date().toISOString().slice(0,10),items:[{description:'Synthetic work',quantity:1,unit_price:100,tax_rate:0}]}
   a.invoice=(await db.query("select public.create_document($1,'invoice',$2,$3) v",[a.business,randomUUID(),payload])).rows[0].v.id
   await db.query("update public.invoices set status='sent' where id=$1",[a.invoice])
   for(let k=0;k<2;k++){
    const id=(await db.query("select public.create_document($1,'estimate',$2,$3) v",[a.business,randomUUID(),payload])).rows[0].v.id
    await db.query("update public.estimates set status='accepted' where id=$1",[id]);a.estimates.push(id)
   }
   const date=new Date(Date.now()+14*86400000);date.setUTCHours(10,0,0,0)
   a.input={title:'Synthetic concurrency booking',workers:[a.user],starts_at:date.toISOString(),ends_at:new Date(date.getTime()+3600000).toISOString()}
   await db.query('reset role')
  }
  await db.query('commit')
  await Promise.all(peers.map(async c=>{await c.connect();c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid}))
  for(let offset=0;offset<actors.length;offset+=5){
   const group=actors.slice(offset,offset+5)
   await db.query('begin')
   for(const a of group){await db.query('select id from public.invoices where id=$1 for update',[a.invoice]);await db.query("select pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||$1,0))",[a.business])}
   const pending=peers.map(async(c,i)=>{
    const a=group[Math.floor(i/4)],kind=i%4
    await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[a.user]);await c.query('set role authenticated')
    const started=performance.now()
    try{return {ok:true,kind,value:(await (kind<2?c.query('select public.book_approved_estimate($1,$2) v',[a.estimates[kind],a.input]):c.query("select public.record_manual_payment($1,$2,$3,60,'cash','Synthetic race') v",[a.business,a.invoice,randomUUID()]))).rows[0].v}}
    catch(e){return {ok:false,kind,code:e.code,expected:kind<2?e.code==='23P01':e.code==='P0001'&&e.message==='Payment exceeds the remaining balance'}}
    finally{times.push(performance.now()-started)}
   })
   let waiting=0
   for(let n=0;n<200;n++){waiting=(await db.query("select count(distinct pid)::int n from pg_locks where pid=any($1::int[]) and not granted",[peers.map(c=>c.pid)])).rows[0].n;if(waiting===20)break;await sleep(10)}
   assert.equal(waiting,20,'All competing calls must overlap at database locks');blocked+=waiting
   await db.query('commit')
   const results=await Promise.all(pending)
   for(let i=0;i<5;i++){
    const rows=results.slice(i*4,i*4+4),a=group[i]
    for(const pair of [rows.slice(0,2),rows.slice(2)]){assert.equal(pair.filter(r=>r.ok).length,1);assert.equal(pair.filter(r=>!r.ok&&r.expected).length,1)}
    const winner=rows[0].ok?0:1,c=peers[i*4]
    assert.equal((await c.query('select public.book_approved_estimate($1,$2) v',[a.estimates[winner],a.input])).rows[0].v.already_booked,true)
    const request=randomUUID()
    const retry=await Promise.all([peers[i*4+2],peers[i*4+3]].map(p=>p.query("select public.record_manual_payment($1,$2,$3,40,'cash','Synthetic shared retry') v",[a.business,a.invoice,request])))
    assert.equal(retry[0].rows[0].v.id,retry[1].rows[0].v.id)
   }
  }
  for(const a of actors){
   const v=(await db.query('select status,total,amount_paid,balance_due,(select count(*)::int from public.payments where invoice_id=$1) payments,(select count(*)::int from public.appointments where business_id=$2) appointments from public.invoices where id=$1',[a.invoice,a.business])).rows[0]
   assert.equal(v.status,'paid');assert.equal(Number(v.total),100);assert.equal(Number(v.amount_paid),100);assert.equal(Number(v.balance_due),0);assert.equal(v.payments,2);assert.equal(v.appointments,1)
  }
  const sorted=times.sort((a,b)=>a-b)
  report={scope:'owned PostgreSQL concurrent owner booking/manual payment acceptance; no card provider',limits:COMMERCE_LIMITS,overlappingCalls:blocked,bookingWinners:20,bookingConflicts:20,paymentWinners:20,overpaymentRejections:20,sharedPaymentRetries:40,uniqueFinalPayments:40,appointments:20,duplicates:0,p95IncludingBarrierMs:Math.round(sorted[Math.ceil(sorted.length*.95)-1]),externalProviderRequests:0,limitations:['Synthetic SQL identities; genuine JWT acceptance is covered separately.','Timing includes the deliberate lock barrier, not a production latency estimate.','Customer confirmation, signed merchant callbacks and hosted concurrency remain separate.']}
 }finally{
  await db.query('rollback').catch(()=>{})
  await Promise.all(peers.map(c=>c.end().catch(()=>{})))
  await cleanupSyntheticFixture(db,{projectId,expectedUsers:actors.map(a=>a.user),expectedBusinesses:actors.map(a=>a.business)})
 }
 const cleanup=(await db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from public.businesses) businesses,(select count(*)::int from public.payments) payments')).rows[0]
 assert.deepEqual(cleanup,{users:0,businesses:0,payments:0});return {...report,cleanup}
}
