import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {journeyFixture,invoice} from './journey-fixture.ts'
export {B,C,I,J,O,U,user,invoice,value} from './journey-fixture.ts'
function block(source:string,marker:string,end='end $$;'){const a=source.indexOf(marker),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,marker);return source.slice(a,b+end.length)}
export async function journeyTermsFixture(){
 const db=await journeyFixture(true)
 try{
  // Install the real source definitions needed by the additive wrappers. Guard
  // tests below do not stand in for full scheduling or managed-platform replay.
  await db.exec(`reset role;alter function public.create_document(uuid,text,uuid,jsonb) set schema private;
    create function public.create_document(target_business_id uuid,document_kind text,request_id uuid,payload jsonb) returns jsonb language sql security invoker as $$select private.create_document(target_business_id,document_kind,request_id,payload)$$;
    grant execute on function private.create_document(uuid,text,uuid,jsonb) to authenticated;
    alter table public.estimates add column if not exists customer_reference text;
    alter table public.invoices add column if not exists customer_reference text;
    alter table public.invoice_items add column if not exists source_estimate_line_id uuid,add column if not exists source_change_order_id uuid;`)
  const references=await readFile('supabase/migrations/20261110140500_customer_document_references.sql','utf8')
  await db.exec(block(references,'CREATE OR REPLACE FUNCTION public.update_draft_document(', '$function$;'))
  const lifecycle=await readFile('supabase/migrations/20261108011707_record_action_consistency.sql','utf8')
  await db.exec(block(lifecycle,'create table private.record_action_requests(',');'))
  await db.exec(block(lifecycle,'create function public.create_revised_estimate('))
  const deposit=await readFile('supabase/migrations/20261106131110_estimate_deposit_final_balance.sql','utf8')
  await db.exec(block(deposit,'create function private.guard_deposit_invoice('))
  await db.exec(`create trigger a_deposit_invoice_guard before insert or update on public.invoices for each row execute function private.guard_deposit_invoice();`)
  await db.exec(block(deposit,'create function public.create_estimate_deposit('))
  const approved=await readFile('supabase/migrations/20261109184432_approved_job_management_handoff.sql','utf8')
  await db.exec(block(approved,'create or replace function private.book_estimate_job('))
  const live=await readFile('supabase/migrations/20261108003415_live_customer_scheduling.sql','utf8')
  await db.exec(block(live,'create function private.approve_scheduling_offer('))
  await db.exec(block(live,'create or replace function private.customer_schedule_offer('))
  await invoice(db) // A real pre-migration draft must retain its earlier review contract.
  await db.exec(await readFile('supabase/migrations/20261114000300_journey_booking_and_payment_terms.sql','utf8'))
  return db
 }catch(error){await db.close();throw error}
}
