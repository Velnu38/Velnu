import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {recordFixture,asUser,ids} from './record-action-fixture'

test('reference persists through atomic create/edit, retry, issued snapshots and converted invoices',async()=>{
 const db=await recordFixture()
 try{
  await db.exec('reset role')
  // Bring this focused historical fixture to the existing pre-change columns.
  await db.exec(`alter table public.invoices add column if not exists property_id uuid;
   alter table public.invoice_items add column if not exists source_change_order_id uuid;
   alter table public.invoice_items add column if not exists source_estimate_line_id uuid;
   alter table public.invoices add column if not exists work_completed boolean default false;
   alter table public.estimates add column if not exists work_completed boolean default false;
   alter function public.create_document(uuid,text,uuid,jsonb) set schema private;`)
  const historical=await readFile('supabase/migrations/20261107023520_streamlined_workflow_handoffs.sql','utf8')
  const start=historical.indexOf('create or replace function public.create_document('),end=historical.indexOf('-- Making a reviewed quote',start)
  await db.exec(historical.slice(start,end))
  await db.exec(await readFile('supabase/migrations/20261110140500_customer_document_references.sql','utf8'))
  await asUser(db)
  const input={customer_id:ids.customer,customer_reference:'PO-11',items:[{description:'Service',quantity:2,unit_price:50,tax_rate:5}]},request=randomUUID()
  const create=async(payload=input)=>(await db.query<any>("select public.create_document($1,'invoice',$2,$3) value",[ids.business,request,payload])).rows[0].value
  const first=await create();assert.equal(first.customer_reference,'PO-11');assert.equal(Number(first.total),105)
  assert.equal((await create()).id,first.id)
  await assert.rejects(create({...input,customer_reference:'PO-DIFFERENT'}),{code:'23505'})
  const edited=(await db.query<any>("select public.update_draft_document($1,'invoice',$2,$3,$4) value",[ids.business,first.id,first.updated_at,{...input,customer_reference:'PO-12'}])).rows[0].value
  assert.equal(edited.customer_reference,'PO-12');assert.equal((await create()).customer_reference,'PO-12','retry must not revert later edits')
  await db.query("update invoices set status='sent' where id=$1",[first.id])
  await assert.rejects(db.query("update invoices set customer_reference='tampered' where id=$1",[first.id]),{code:'23514'})
  await db.exec('reset role')
  const snapshot=(await db.query<any>("select private.customer_document_snapshot($1,'invoice',$2) value",[ids.business,first.id])).rows[0].value
  assert.equal(snapshot.customer_reference,'PO-12')
  await asUser(db,ids.outsider)
  await assert.rejects(db.query("select public.update_draft_document($1,'invoice',$2,$3,$4)",[ids.business,first.id,edited.updated_at,input]))
  await asUser(db)
  for(const reference of ['x'.repeat(121),'bad\nvalue'])await assert.rejects(db.query("select public.create_document($1,'invoice',$2,$3)",[ids.business,randomUUID(),{...input,customer_reference:reference}]),{code:'23514'})
  const estimate=(await db.query<any>("select public.create_document($1,'estimate',$2,$3) value",[ids.business,randomUUID(),{...input,customer_reference:'PO-EST'}])).rows[0].value
  await db.query("update estimates set status='accepted' where id=$1",[estimate.id])
  const converted=(await db.query<any>('select public.convert_estimate_to_invoice($1,null) value',[estimate.id])).rows[0].value
  assert.equal((await db.query<any>('select customer_reference from invoices where id=$1',[converted])).rows[0].customer_reference,'PO-EST')
 }finally{await db.close()}
})
