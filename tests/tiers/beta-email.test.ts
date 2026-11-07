import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import type {PGlite} from '@electric-sql/pglite'
import {B,U,O,C,I,fixture,invoice,plan} from './fixture'

const owner='owner@example.test'
const otherBusiness='77777777-7777-4777-8777-777777777777'

async function setup(){
 const db=await fixture()
 await db.exec('reset role;alter table auth.users add column email text,add column email_confirmed_at timestamptz')
 await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2',[owner,U])
 await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2',['other@example.test',O])
 const migrations=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_private_beta_email_delivery.sql'))
 assert.equal(migrations.length,1)
 await db.exec(await readFile('supabase/migrations/'+migrations[0],'utf8'))
 await db.exec("insert into private.workspace_feature_flags(name,enabled) values('ten_pro_test_accounts',true) on conflict(name) do update set enabled=true;update private.workspace_feature_flags set enabled=true where name='private_beta_email_delivery'")
 assert.equal((await db.query<{enabled:boolean}>('select private.enroll_private_beta_email($1) enabled',[B])).rows[0].enabled,true)
 await invoice(db)
 await db.query('update customers set email=$1 where id=$2',['delivered@resend.dev',C])
 return db
}

function payload(to:unknown=['delivered@resend.dev'],extra:Record<string,unknown>={}){
 return {from:'Finviant Office <noreply@finviant.com>',to,subject:'Isolated beta test',text:'Fixture only',...extra}
}
async function queue(db:PGlite,value:unknown,business=B){
 const id=crypto.randomUUID()
 const result=await db.query<{payload:Record<string,unknown>}>(`insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload)
 values($1,$2,$3,'invoice',$4,$5::jsonb) returning payload`,[id,business,U,I,JSON.stringify(value)])
 return {id,payload:result.rows[0].payload}
}
async function allowed(db:PGlite,id:string){
 await db.exec('set role service_role')
 try{return (await db.query<{allowed:boolean}>('select public.private_beta_email_recipient_allowed($1) allowed',[id])).rows[0].allowed}
 finally{await db.exec('reset role')}
}

test('beta emails require exact approved envelopes and stamp the approved reply address',async()=>{
 const db=await setup();try{
  const first=await queue(db,payload(['DELIVERED@RESEND.DEV',owner],{cc:['bounced@resend.dev'],bcc:['complained@resend.dev'],reply_to:['attacker@example.test']}))
  assert.deepEqual(first.payload.reply_to,[owner]);assert.equal(await allowed(db,first.id),true)
  for(const to of [
   ['delivered@resend.dev.attacker.test'],['delivered+alias@resend.dev'],['anything@resend.dev'],
   ['Tester <delivered@resend.dev>'],[owner+'\r\nBcc:attacker@example.test'],
   ['delivered@resend.dev','customer@example.test'],[],null,'delivered@resend.dev',[null],[123],[{}],
  ])await assert.rejects(()=>queue(db,payload(to)),/BETA_EMAIL_RECIPIENT_NOT_APPROVED/)
  for(const extra of [{cc:['customer@example.test']},{bcc:['customer@example.test']},{cc:null},{bcc:'delivered@resend.dev'},{cc:[true]}]){
   await assert.rejects(()=>queue(db,payload(undefined,extra)),/BETA_EMAIL_RECIPIENT_NOT_APPROVED/)
  }
  await assert.rejects(()=>queue(db,null),/BETA_EMAIL_RECIPIENT_NOT_APPROVED/)
  assert.equal((await db.query<{used:number}>("select used from private.tier_usage where business_id=$1 and feature='email'",[B])).rows[0].used,2)
 }finally{await db.close()}
})

test('recipient approval is business scoped and rechecked after a request is frozen',async()=>{
 const db=await setup();try{
  await db.query('insert into businesses(id,name,created_by_user_id) values($1,$2,$3)',[otherBusiness,'Other fixture',O])
  await db.query('insert into private.private_beta_email_recipients(business_id,email) values($1,$2)',[otherBusiness,'other-customer@example.test'])
  await assert.rejects(()=>queue(db,payload(['other-customer@example.test'])),/BETA_EMAIL_RECIPIENT_NOT_APPROVED/)
  const approved=await queue(db,payload([owner]));assert.equal(await allowed(db,approved.id),true)
  await db.query('update private.private_beta_email_recipients set active=false where business_id=$1 and email=$2',[B,owner])
  assert.equal(await allowed(db,approved.id),false)
  await db.query('update private.private_beta_email_recipients set active=true where business_id=$1 and email=$2',[B,owner])
  await db.query("update private.finviant_email_outbox set payload=jsonb_set(payload,'{bcc}','[\"hidden@example.test\"]') where id=$1",[approved.id])
  assert.equal(await allowed(db,approved.id),false)
  for(const reply of [['attacker@example.test'],[owner,'attacker@example.test'],owner,null]){
   await db.query("update private.finviant_email_outbox set payload=jsonb_set(payload-'bcc','{reply_to}',$2::jsonb) where id=$1",[approved.id,JSON.stringify(reply)])
   assert.equal(await allowed(db,approved.id),false)
  }
  assert.equal(await allowed(db,crypto.randomUUID()),false)
 }finally{await db.close()}
})

test('frozen sends stop when enrollment, verified owner, plan or sender readiness is revoked',async()=>{
 const db=await setup();try{
  const approved=await queue(db,payload());assert.equal(await allowed(db,approved.id),true)
  for(const flag of ['private_beta_email_delivery','ten_pro_test_accounts']){
   await db.query('update private.workspace_feature_flags set enabled=false where name=$1',[flag]);assert.equal(await allowed(db,approved.id),false)
   await db.query('update private.workspace_feature_flags set enabled=true where name=$1',[flag])
  }
  await db.query('delete from private.test_account_slots where user_id=$1',[U]);assert.equal(await allowed(db,approved.id),false)
  await db.query('insert into private.test_account_slots(slot,user_id) values(1,$1)',[U])
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[U]);assert.equal(await allowed(db,approved.id),false)
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[U])
  for(const tier of ['free','basic']){
   await plan(db,tier);await db.exec('reset role');assert.equal(await allowed(db,approved.id),false)
  }
  await plan(db,'pro');await db.exec('reset role')
  await db.query('update private.managed_delivery_accounts set email_active=false where business_id=$1',[B]);assert.equal(await allowed(db,approved.id),false)
  await db.query('update private.managed_delivery_accounts set email_active=true,reply_to=$1 where business_id=$2',['unapproved@example.test',B]);assert.equal(await allowed(db,approved.id),false)
  await db.query('update private.managed_delivery_accounts set reply_to=$1 where business_id=$2',[owner,B]);assert.equal(await allowed(db,approved.id),true)
 }finally{await db.close()}
})

test('disabled beta flag preserves the existing production queue behavior',async()=>{
 const db=await setup();try{
  await db.exec("update private.workspace_feature_flags set enabled=false where name='private_beta_email_delivery'")
  const normal=await queue(db,payload(['ordinary-customer@example.test'],{reply_to:['existing-reply@example.test']}))
  assert.deepEqual(normal.payload.reply_to,['existing-reply@example.test'])
  assert.equal(await allowed(db,normal.id),false)
 }finally{await db.close()}
})

test('normal document preparation rejects unapproved recipients before quota is reserved',async()=>{
 const db=await setup();try{
  await db.query('update customers set email=$1 where id=$2',['unapproved-customer@example.test',C])
  await assert.rejects(()=>db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,crypto.randomUUID()]),/BETA_EMAIL_RECIPIENT_NOT_APPROVED/)
  assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,0)
  assert.equal((await db.query("select * from private.tier_operations where feature='email'")).rows.length,0)
  await db.query('update customers set email=$1 where id=$2',['delivered@resend.dev',C])
  const id=crypto.randomUUID();await db.query("select prepare_document_email($1,$2,'invoice',$3,$4,'https://finviant.com')",[U,B,I,id])
  assert.equal(await allowed(db,id),true)
  const triggers=(await db.query<{tgname:string}>("select tgname from pg_trigger where tgrelid='private.finviant_email_outbox'::regclass and not tgisinternal order by tgname")).rows.map(x=>x.tgname)
  assert.ok(triggers.indexOf('beta_email_recipient_guard')<triggers.indexOf('enforce_managed_email'))
 }finally{await db.close()}
})

test('beta enrollment is admin-only and new registered workspaces preserve SMS configuration',async()=>{
 const db=await setup();try{
  await db.query("update private.managed_delivery_accounts set sms_active=true,sms_from='+17575550999',sms_reply_route='Original inbox' where business_id=$1",[B])
  await db.query('select private.enroll_private_beta_email($1)',[B])
  assert.deepEqual((await db.query('select email_active,sms_active,sms_from,sms_reply_route,reply_to from private.managed_delivery_accounts where business_id=$1',[B])).rows[0],{email_active:true,sms_active:true,sms_from:'+17575550999',sms_reply_route:'Original inbox',reply_to:owner})
  const operatorOnly=crypto.randomUUID()
  await db.query('insert into private.platform_operators(user_id,active) values($1,true)',[O])
  await db.query('insert into businesses(id,name,created_by_user_id) values($1,$2,$3)',[operatorOnly,'Operator without test slot',O])
  assert.equal((await db.query<{enabled:boolean}>('select private.enroll_private_beta_email($1) enabled',[operatorOnly])).rows[0].enabled,false)
  assert.equal((await db.query('select 1 from private.managed_delivery_accounts where business_id=$1',[operatorOnly])).rows.length,0)
  await db.query('insert into private.test_account_slots(slot,user_id) values(2,$1)',[O])
  await db.query('insert into businesses(id,name,created_by_user_id) values($1,$2,$3)',[otherBusiness,'New enrolled fixture',O])
  assert.deepEqual((await db.query('select email_active,sms_active,reply_to from private.managed_delivery_accounts where business_id=$1',[otherBusiness])).rows[0],{email_active:true,sms_active:false,reply_to:'other@example.test'})
  const unsigned=crypto.randomUUID();await db.query('update auth.users set email_confirmed_at=null where id=$1',[O])
  await db.query('insert into businesses(id,name,created_by_user_id) values($1,$2,$3)',[unsigned,'Unconfirmed fixture',O])
  assert.equal((await db.query('select 1 from private.managed_delivery_accounts where business_id=$1',[unsigned])).rows.length,0)
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role)
   await assert.rejects(()=>db.query('select private.enroll_private_beta_email($1)',[B]),/permission denied/)
   await assert.rejects(()=>db.query('select * from private.private_beta_email_recipients'),/permission denied/)
   if(role!=='service_role')await assert.rejects(()=>db.query('select public.private_beta_email_recipient_allowed($1)',[crypto.randomUUID()]),/permission denied/)
   await db.exec('reset role')
  }
  const definer=(await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where oid='public.private_beta_email_recipient_allowed(uuid)'::regprocedure")).rows[0].prosecdef
  assert.equal(definer,false)
 }finally{await db.close()}
})
