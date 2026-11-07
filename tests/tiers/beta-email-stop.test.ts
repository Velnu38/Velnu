import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import type {PGlite} from '@electric-sql/pglite'
import {B,U,I,fixture,invoice} from './fixture'

async function setup(){
 const db=await fixture();await invoice(db)
 await db.query('insert into private.managed_delivery_accounts(business_id,email_active) values($1,true)',[B])
 await db.exec(`create table private.finviant_delivery_events(event_id text primary key,provider_id text,event_type text,occurred_at timestamptz,received_at timestamptz)`)
 const bootstrap=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
 for(const name of ['finish_document_email','record_delivery_event','record_tagged_delivery_event']){
  const start=bootstrap.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(')
  const end=bootstrap.indexOf('$function$;',start)
  assert.ok(start>=0&&end>start);await db.exec(bootstrap.slice(start,end+12))
 }
 const migrations=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_stop_private_beta_email.sql'));assert.equal(migrations.length,1)
 await db.exec(await readFile('supabase/migrations/'+migrations[0],'utf8'))
 return db
}
async function prepare(db:PGlite){
 const id=crypto.randomUUID()
 await db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,id])
 const claim=(await db.query<{s:{lease:string,status:string}}>('select claim_document_email($1) s',[id])).rows[0].s
 assert.equal(claim.status,'claimed');return {id,lease:claim.lease}
}
async function stop(db:PGlite,id:string,lease:string,code='beta_recipient_not_approved'){
 await db.exec('set role service_role')
 try{return (await db.query<{stopped:boolean}>('select public.stop_private_beta_email($1,$2,$3) stopped',[id,lease,code])).rows[0].stopped}
 finally{await db.exec('reset role')}
}
async function state(db:PGlite,id:string){
 return (await db.query<any>('select status,attempts,lease_id,provider_id,last_code,payload from private.finviant_email_outbox where id=$1',[id])).rows[0]
}

test('only a leased first attempt can prove beta denial before provider contact',async()=>{
 const db=await setup();try{
  const op=await prepare(db),before=await state(db,op.id)
  assert.equal(await stop(db,op.id,op.lease),true)
  const after=await state(db,op.id)
  assert.deepEqual(after,{...before,status:'failed',lease_id:null,last_code:'beta_recipient_not_approved'})
  assert.equal((await db.query<any>('select status from messages where id=$1',[op.id])).rows[0].status,'failed')
  assert.equal((await db.query<any>('select claim_document_email($1) s',[op.id])).rows[0].s.status,'failed')
  assert.equal(await stop(db,op.id,op.lease),false)
 }finally{await db.close()}
})

test('a reclaimed uncertain send retains its identifier and stops automatic dispatch',async()=>{
 const db=await setup();try{
  const first=await prepare(db)
  await db.query("select finish_document_email($1,$2,'uncertain',null,'timeout')",[first.id,first.lease])
  await db.query("update private.finviant_email_outbox set next_attempt_at=now()-interval '1 second' where id=$1",[first.id])
  const reclaimed=(await db.query<any>('select claim_document_email($1) s',[first.id])).rows[0].s
  const before=await state(db,first.id);assert.equal(before.attempts,2)
  assert.equal(await stop(db,first.id,reclaimed.lease),false)
  const after=await state(db,first.id)
  assert.equal(after.status,'reconciliation_required');assert.equal(after.last_code,'beta_stop_unconfirmed');assert.equal(after.lease_id,null)
  assert.deepEqual(after.payload,before.payload);assert.equal(after.provider_id,null)
  assert.equal((await db.query<any>('select status from messages where id=$1',[first.id])).rows[0].status,'queued')
  assert.equal((await db.query<any>('select claim_document_email($1) s',[first.id])).rows[0].s.status,'reconciliation_required')
 }finally{await db.close()}
})

test('lost or expired leases cannot create a definitive stopped-send acknowledgement',async()=>{
 const db=await setup();try{
  const op=await prepare(db),before=await state(db,op.id)
  assert.equal(await stop(db,op.id,crypto.randomUUID()),false);assert.deepEqual(await state(db,op.id),before)
  assert.equal(await stop(db,op.id,op.lease,'other_failure'),false);assert.deepEqual(await state(db,op.id),before)
  await db.query("update private.finviant_email_outbox set lease_until=now()-interval '1 second' where id=$1",[op.id])
  assert.equal(await stop(db,op.id,op.lease),false);assert.deepEqual(await state(db,op.id),before)
 }finally{await db.close()}
})

test('late accepted and delivered webhooks retain provider truth instead of becoming beta failures',async()=>{
 const db=await setup();try{
  const op=await prepare(db),provider='provider-live-receipt'
  await db.query("select record_tagged_delivery_event($1,$2,'email.sent',now(),$3)",[crypto.randomUUID(),provider,op.id])
  assert.equal(await stop(db,op.id,op.lease),false)
  assert.equal((await state(db,op.id)).status,'accepted');assert.equal((await state(db,op.id)).provider_id,provider)
  await db.query("select record_tagged_delivery_event($1,$2,'email.delivered',now()+interval '1 second',$3)",[crypto.randomUUID(),provider,op.id])
  assert.equal(await stop(db,op.id,op.lease),false);assert.equal((await state(db,op.id)).status,'delivered')
  assert.equal((await db.query<any>('select status from messages where id=$1',[op.id])).rows[0].status,'delivered')
 }finally{await db.close()}
})

test('observed provider receipts pause an inconsistent claimed row without falsely failing the message',async()=>{
 const db=await setup();try{
  const op=await prepare(db),provider='provider-before-local-ack'
  await db.query("update public.messages set provider_message_id=$1,status='sent' where id=$2",[provider,op.id])
  await db.query("insert into private.finviant_delivery_events values($1,$2,'email.sent',now(),now())",[crypto.randomUUID(),provider])
  assert.equal(await stop(db,op.id,op.lease),false)
  assert.equal((await state(db,op.id)).status,'reconciliation_required')
  assert.equal((await db.query<any>('select status from messages where id=$1',[op.id])).rows[0].status,'sent')
 }finally{await db.close()}
})

test('only the service role can call the narrow stop wrapper',async()=>{
 const db=await setup();try{
  const op=await prepare(db)
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role)
   await assert.rejects(()=>db.query('select public.stop_private_beta_email($1,$2,$3)',[op.id,op.lease,'beta_recipient_not_approved']),/permission denied/)
   await assert.rejects(()=>db.query('select private.stop_private_beta_email($1,$2,$3)',[op.id,op.lease,'beta_recipient_not_approved']),/permission denied/)
   await db.exec('reset role')
  }
  assert.equal((await db.query<any>("select prosecdef from pg_proc where oid='public.stop_private_beta_email(uuid,uuid,text)'::regprocedure")).rows[0].prosecdef,false)
  assert.equal(await stop(db,op.id,op.lease,'beta_configuration_unavailable'),true)
 }finally{await db.close()}
})
