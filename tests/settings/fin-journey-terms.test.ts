import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {accountDatabase} from './fin-account-fixture.ts'
import {ids} from '../scheduling/fixture.ts'
test('Fin reviews and saves explicit estimate terms through the canonical document API once, and authorized lookup returns them',async()=>{
 const db=await accountDatabase()
 try{
  await db.exec(`reset role;alter table public.invoices add column if not exists deposit_estimate_id uuid;
   alter function public.create_document(uuid,text,uuid,jsonb) set schema private;
   create function public.create_document(target_business_id uuid,document_kind text,request_id uuid,payload jsonb) returns jsonb language sql security invoker as $$select private.create_document(target_business_id,document_kind,request_id,payload)$$;
   grant execute on function private.create_document(uuid,text,uuid,jsonb) to authenticated;`)
  const terms=await readFile('supabase/migrations/20261114000300_journey_booking_and_payment_terms.sql','utf8')
  await db.exec(terms.slice(0,terms.indexOf('alter function public.update_draft_document')))
  await db.exec(await readFile('supabase/migrations/20261114000400_fin_reviewed_estimate_terms.sql','utf8'))
  await db.exec('set role authenticated')
  const thread=crypto.randomUUID(),request=crypto.randomUUID(),stepId=crypto.randomUUID()
  await db.query('select public.fin_begin_turn($1,$2,$3,$4)',[ids.business,thread,request,'Create a $200 estimate, Net 15.'])
  const reply=(await db.query<{value:any}>('select public.fin_finish_turn($1,$2,$3,$4) value',[ids.business,thread,request,{answer:'Review the estimate and payment terms.',steps:[{operation:'create_estimate',request_id:stepId,target:null,customer:'customers:'+ids.customer,fields:{items:[{description:'Work',quantity:'1',unit_price:'200',tax_rate:'0'}],payment_terms_days:'15'},label:'Create estimate'}],sources:[],limits:[],as_of:new Date().toISOString()}])).rows[0].value
  assert.equal((await db.query('select count(*)::int n from public.estimates')).rows[0].n,0)
  const args=[ids.business,thread,reply.plan.id,reply.plan.version,true]
  await db.query('select public.fin_execute_review($1,$2,$3,$4,$5)',args);await db.query('select public.fin_execute_review($1,$2,$3,$4,$5)',args)
  const rows=(await db.query<{id:string;payment_terms_days:number;customer_message:string}>('select id,payment_terms_days,customer_message from public.estimates')).rows
  assert.equal(rows.length,1);assert.equal(rows[0].payment_terms_days,15);assert.match(rows[0].customer_message,/Invoice payment terms: Net 15 days/)
  const lookup=(await db.query<{value:any}>('select public.fin_lookup_records($1,$2) value',[ids.business,{resource:'estimates',id:rows[0].id,order:'oldest'}])).rows[0].value
  assert.equal(lookup.rows[0].payment_terms_days,15)
 }finally{await db.close()}
})
