import assert from 'node:assert/strict'
import test from 'node:test'
import {journeyTermsFixture,B,C,I,J,O,U,user,invoice,value} from './journey-terms-fixture.ts'
import {estimatePaymentMessage,withoutPaymentTerms} from '../../src/lib/estimatePaymentTerms.ts'
import {invoiceActionPolicy} from '../../src/lib/invoiceActions.ts'
async function quote(db:any,days:number|null=15){await invoice(db);await user(db);return value(db,'select public.create_document($1,$2,$3,$4) value',[B,'estimate',crypto.randomUUID(),{customer_id:C,customer_message:'Scope and site access.',payment_terms_days:days,items:[{description:'Fixed-price work',quantity:1,unit_price:2400,tax_rate:0}]}])}
test('structured payment terms are visible once in the agreed message, idempotent, editable only while draft and copied to a revised draft',async()=>{
 const db=await journeyTermsFixture();try{
  let q=await quote(db);assert.equal(q.payment_terms_days,15);assert.equal(q.customer_message,estimatePaymentMessage('Scope and site access.','15'));assert.equal(withoutPaymentTerms(q.customer_message,15),'Scope and site access.')
  q=await value(db,'select public.update_draft_document($1,$2,$3,$4,$5) value',[B,'estimate',q.id,q.updated_at,{customer_id:C,customer_message:'Revised scope.',payment_terms_days:30,items:[{description:'Fixed-price work',quantity:1,unit_price:2400,tax_rate:0}]}]);assert.equal(q.payment_terms_days,30);assert.equal(q.customer_message.match(/Invoice payment terms:/g).length,1)
  await db.exec('reset role');await db.query("update public.estimates set status='declined' where id=$1",[q.id]);await assert.rejects(()=>db.query('update public.estimates set payment_terms_days=7 where id=$1',[q.id]),/Issued payment terms/)
  await user(db);const request=crypto.randomUUID(),revision=await value(db,'select public.create_revised_estimate($1,$2) value',[q.id,request]);assert.equal(await value(db,'select payment_terms_days value from public.estimates where id=$1',[revision.estimate_id]),30)
  await db.query('update public.estimates set payment_terms_days=7 where id=$1',[revision.estimate_id]);await value(db,'select public.create_revised_estimate($1,$2) value',[q.id,request]);assert.equal(await value(db,'select payment_terms_days value from public.estimates where id=$1',[revision.estimate_id]),7,'retry preserves edits to the existing revision')
 }finally{await db.close()}
})
test('a final invoice derives its due date from its actual issue date; missing terms require review without inventing a global default',async()=>{
 const db=await journeyTermsFixture();try{
  const q=await quote(db);await db.exec('reset role');await db.query("update public.estimates set status='accepted',job_id=$1 where id=$2",[J,q.id]);const id=crypto.randomUUID()
  await db.query("insert into public.invoices(id,business_id,customer_id,job_id,estimate_id,issue_date) values($1,$2,$3,$4,$5,current_date-1)",[id,B,C,J,q.id]);assert.equal(await value(db,'select (due_date=issue_date+15) value from public.invoices where id=$1',[id]),true)
  await assert.rejects(()=>db.query('update public.invoices set due_date=issue_date+7 where id=$1',[id]),/conflicts with the approved/)
  const q2=await quote(db,null);await db.exec('reset role');const missing=crypto.randomUUID();await db.query('insert into public.invoices(id,business_id,customer_id,job_id,estimate_id) values($1,$2,$3,$4,$5)',[missing,B,C,J,q2.id]);assert.equal(await value(db,'select due_date value from public.invoices where id=$1',[missing]),null)
  await assert.rejects(()=>db.query('select private.require_final_invoice_due_date($1,$2)',[B,missing]),/Choose the final invoice/);await assert.rejects(()=>db.query("update public.invoices set status='sent' where id=$1",[missing]),/Choose the final invoice/)
  const p=invoiceActionPolicy({status:'draft',balance_due:2400,due_date:null,job_id:J,estimate_id:q2.id,journey_terms_review_required:true},{today:'2026-11-14',canManage:true,paymentState:'clear',recovery:false});assert.equal(p.primary,'edit');assert.equal(p.secondary,null)
  await db.query('update public.invoices set job_id=$1,estimate_id=$2 where id=$3',[J,q2.id,I]);await db.query('select private.require_final_invoice_due_date($1,$2)',[B,I]);assert.equal(await value(db,'select journey_terms_review_required value from public.invoices where id=$1',[I]),false)
  await assert.rejects(()=>db.query('update public.invoices set journey_terms_review_required=false where id=$1',[missing]),/review scope/)
 }finally{await db.close()}
})
test('only an explicitly required deposit blocks a first booking; settlement clears it and refunds do not cancel arranged visits',async()=>{
 const db=await journeyTermsFixture();try{
  const q=await quote(db,null);await db.exec('reset role');await db.query("update public.estimates set status='accepted',job_id=$1 where id=$2",[J,q.id]);await db.query('update public.jobs set source_estimate_id=$1 where id=$2',[q.id,J]);await user(db)
  const id=await value(db,'select public.create_estimate_deposit_with_booking_rule($1,$2,null,true) value',[q.id,500]);assert.equal(await value(db,'select booking_required value from public.invoices where id=$1',[id]),true)
  await db.exec('reset role');await assert.rejects(()=>db.query('select private.assert_booking_deposit($1)',[q.id]),/required deposit/)
  const appointment=crypto.randomUUID();await assert.rejects(()=>db.query("insert into public.appointments(id,business_id,customer_id,job_id,starts_at,ends_at,status) values($1,$2,$3,$4,now()+interval '1 day',now()+interval '25 hours','confirmed')",[appointment,B,C,J]),/required deposit/)
  await db.query("update public.invoices set status='sent' where id=$1",[id]);await assert.rejects(()=>db.query('update public.invoices set booking_required=false where id=$1',[id]),/Issued deposit/)
  await db.query("insert into public.payments(business_id,invoice_id,amount,status,paid_at,method) values($1,$2,500,'succeeded',now(),'cash')",[B,id]);await db.query('select private.assert_booking_deposit($1)',[q.id]);await db.query("insert into public.appointments(id,business_id,customer_id,job_id,starts_at,ends_at,status) values($1,$2,$3,$4,now()+interval '1 day',now()+interval '25 hours','confirmed')",[appointment,B,C,J])
  await db.query("update public.payments set status='refunded' where invoice_id=$1",[id]);await db.query('select private.assert_booking_deposit($1)',[q.id]);assert.equal(await value(db,'select status value from public.appointments where id=$1',[appointment]),'confirmed')
  await db.query("update public.appointments set status='canceled' where id=$1",[appointment]);await assert.rejects(()=>db.query("update public.appointments set status='confirmed' where id=$1",[appointment]),/required deposit/)
 }finally{await db.close()}
})
test('ordinary requested deposits keep booking open, and office users cannot change another tenant’s deposit requirement',async()=>{
 const db=await journeyTermsFixture();try{
  const q=await quote(db,null);await db.exec('reset role');await db.query("update public.estimates set status='accepted',job_id=$1 where id=$2",[J,q.id]);await db.query('update public.jobs set source_estimate_id=$1 where id=$2',[q.id,J]);await user(db)
  const deposit=await value(db,'select public.create_estimate_deposit($1,$2,null) value',[q.id,500]);await db.exec('reset role');await db.query('select private.assert_booking_deposit($1)',[q.id]);await user(db);const facts=await value(db,'select public.get_job_management($1,$2) value',[B,J]);assert.equal(facts.journey.deposit,'not_required');assert.equal(facts.journey.depositInvoiceId,deposit)
  await user(db,crypto.randomUUID());await assert.rejects(()=>value(db,'select public.create_estimate_deposit_with_booking_rule($1,$2,null,true) value',[q.id,500]),/Billing access/)
 }finally{await db.close()}
})
