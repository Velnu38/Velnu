import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { B, C, O, U, fixture, user } from './fixture.ts'

const estimate = '88888888-8888-4888-8888-000000000001'
const site = '88888888-8888-4888-8888-000000000002'
const otherSite = '88888888-8888-4888-8888-000000000003'
const request = '88888888-8888-4888-8888-000000000004'
const otherCustomer = '88888888-8888-4888-8888-000000000005'
const token = 'ab'.repeat(32)

async function setup() {
  const db = await fixture()
  await db.exec(`create table properties(id uuid, business_id uuid, customer_id uuid, unique(id,business_id));
    create table business_settings(business_id uuid, payment_links jsonb, payment_instructions text);
    grant select on properties,business_settings to authenticated;
    alter table estimates add column if not exists property_id uuid;
    create function private.can_write_business(uuid) returns boolean language sql
      as $$ select private.fin_access($1,'invoices',true) $$;`)
  const original = await readFile('supabase/migrations/20261102231643_document_workflow_and_contact_import.sql','utf8')
  const start = original.indexOf('CREATE OR REPLACE FUNCTION public.create_document(')
  await db.exec(original.slice(start, original.indexOf('end$function$;',start) + 'end$function$;'.length))
  const files = await import('node:fs/promises')
  const migration = (await files.readdir('supabase/migrations')).find(name => name.endsWith('_streamlined_workflow_handoffs.sql'))!
  await db.exec(await readFile('supabase/migrations/' + migration,'utf8'))
  await db.query("insert into customers(id,business_id,first_name,email,phone) values($1,$2,'Jordan','jordan@example.test','+17575550123'),($3,$2,'Other',null,null)",[C,B,otherCustomer])
  await db.query('insert into properties(id,business_id,customer_id) values($1,$2,$3),($4,$2,$5)',[site,B,C,otherSite,otherCustomer])
  return db
}

async function createEstimate(db: PGlite) {
  await db.query("insert into estimates(id,business_id,customer_id,estimate_number,subtotal,total) values($1,$2,$3,'EST-1',125,125)",[estimate,B,C])
  await db.query("insert into estimate_items(business_id,estimate_id,description,quantity,unit_price) values($1,$2,'Mowing',1,125)",[B,estimate])
  await user(db)
  await db.query("select prepare_personal_document($1,'estimate',$2,$3)",[B,estimate,token])
}
const share = (db:PGlite) => db.query<{ document: { approval_token: string | null; status: string } }>('select get_shared_document($1) document',[token])

test('invoice creation preserves the selected customer location and reuses the same invoice on retry',async () => {
  const db = await setup()
  try {
    await user(db)
    const payload = { customer_id:C, property_id:site, items:[{description:'Mowing',quantity:1,unit_price:125,tax_rate:0}] }
    const create = (p:object,id:string) => db.query<{document:{id:string;property_id:string}}>("select create_document($1,'invoice',$2,$3) document",[B,id,JSON.stringify(p)])
    const created = (await create(payload,request)).rows[0].document
    assert.equal(created.property_id,site)
    assert.equal((await create(payload,request)).rows[0].document.id,created.id)
    assert.equal((await db.query<{property_id:string}>('select property_id from invoices where id=$1',[created.id])).rows[0].property_id,site)
    await assert.rejects(create({...payload,property_id:otherSite},'88888888-8888-4888-8888-000000000006'),/belonging to this customer/)
    assert.equal((await db.query<{count:number}>('select count(*)::int from invoices')).rows[0].count,1)
  } finally { await db.close() }
})

test('only an explicit owner share enables approval and later delivery confirmation stays independent',async () => {
  const db = await setup()
  try {
    await createEstimate(db)
    assert.equal((await share(db)).rows[0].document.approval_token,null)
    await user(db,O)
    await assert.rejects(db.query('select release_personal_approval($1,$2)',[B,token]),/Share unavailable/)
    await user(db,U)
    await db.query('select release_personal_approval($1,$2)',[B,token])
    const released = (await share(db)).rows[0].document
    assert.ok(released.approval_token)
    assert.equal(released.status,'draft')
    await db.exec('reset role')
    assert.equal((await db.query<{count:number}>('select count(*)::int from messages')).rows[0].count,0)
    const approve = () => db.query<{result:{already_consumed:boolean}}>("select consume_document_approval(encode(sha256(convert_to($1,'UTF8')),'hex'),'approved','Customer Name','test',true) result",[released.approval_token])
    assert.equal((await approve()).rows[0].result.already_consumed,false)
    assert.equal((await approve()).rows[0].result.already_consumed,true)
    await user(db)
    await db.query("select confirm_personal_document_sent($1,$2,'email')",[B,token])
    await db.query("select confirm_personal_document_sent($1,$2,'email')",[B,token])
    assert.equal((await share(db)).rows[0].document.status,'accepted')
    await db.exec('reset role')
    assert.equal((await db.query<{count:number}>("select count(*)::int from messages where provider='personal_app'")).rows[0].count,1)
  } finally { await db.close() }
})

test('editing the quote after sharing makes the previous approval unusable',async () => {
  const db = await setup()
  try {
    await createEstimate(db)
    await db.query('select release_personal_approval($1,$2)',[B,token])
    const released = (await share(db)).rows[0].document
    await db.exec('reset role')
    await db.query('update estimate_items set description=$1 where estimate_id=$2',['Different work',estimate])
    await assert.rejects(share(db),/This document changed/)
    await assert.rejects(db.query("select consume_document_approval(encode(sha256(convert_to($1,'UTF8')),'hex'),'approved','Customer Name','test',true)",[released.approval_token]),/DOCUMENT_NOT_APPROVABLE/)
  } finally { await db.close() }
})
