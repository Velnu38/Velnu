import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,ids,actor} from './fixture';
const call=async(db:any,name:string,args:unknown[]=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
async function setup(){const db=await fixture(true);try{await db.exec('reset role');
 const base=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8');
 for(const fn of ['public.create_document']){const start=base.indexOf('CREATE OR REPLACE FUNCTION '+fn+'(');await db.exec(base.slice(start,base.indexOf('$function$;',start)+12));}
 let workflow=await readFile('supabase/migrations/20261103001002_recurring_invoices_and_next_steps.sql','utf8');await db.exec(workflow.slice(0,workflow.indexOf('create extension if not exists pg_cron')));
 // Apply the deployed tier-aware function replacements, not simplified equivalents.
 const included=await readFile('supabase/migrations/20261106155000_included_tier_access.sql','utf8');
 for(const name of ['private.create_recurring_invoice','private.process_recurring_plan','private.set_recurring_invoice_status']){const a=included.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');await db.exec(included.slice(a,included.indexOf('$function$;',a)+12));}
 await db.exec("alter table invoices add column deposit_estimate_id uuid,add column deposit_source_invoice_id uuid,add column deposit_credit numeric default 0;");
 await db.exec(await readFile('supabase/migrations/20261110173000_recurring_owner_controls.sql','utf8'));
 await db.exec('set role authenticated');
 const source=crypto.randomUUID();await db.query('insert into invoices(id,business_id,customer_id) values($1,$2,$3)',[source,ids.business,ids.customer]);await db.query("insert into invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate) values($1,$2,'Service',1,100,5)",[source,ids.business]);
 const today=(await db.query<any>("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
 const options={title:'Repeat review',cadence:'monthly',first_date:today,end_date:'',due_days:7,schedule_visit:false};return {db,source,options};
 }catch(e){await db.close();throw e;}}
test('monthly anchors preserve month ends and leap years; recurring drafts and request retries never send or charge',async()=>{const {db,source,options}=await setup();try{
 const request=crypto.randomUUID();const saved=await call(db,'create_recurring_invoice',[source,request,options]);assert.equal(saved.id,request);assert.equal(saved.status,'active');assert.equal((await call(db,'create_recurring_invoice',[source,request,options])).id,request);
 await assert.rejects(call(db,'create_recurring_invoice',[source,request,{...options,title:'Changed'}]),/different/);
 await db.exec('reset role');const dates=(await db.query<any>("select private.recurring_date('2028-01-31','monthly',1)::text feb,private.recurring_date('2028-01-31','monthly',2)::text march")).rows[0];assert.deepEqual(dates,{feb:'2028-02-29',march:'2028-03-31'});
 await db.query('select private.process_recurring_plan($1)',[request]);await db.query('select private.process_recurring_plan($1)',[request]);
 const rows=(await db.query<any>('select invoice_id from private.recurring_invoice_occurrences where plan_id=$1 and invoice_id is not null',[request])).rows;assert.equal(rows.length,1);
 const invoice=(await db.query<any>('select status,total from invoices where id=$1',[rows[0].invoice_id])).rows[0];assert.equal(invoice.status,'draft');assert.equal(Number(invoice.total),105);assert.equal((await db.query<any>('select count(*)::int n from messages')).rows[0].n,0);
 }finally{await db.close();}});
test('pause prevents generation, resume skips missed dates, stored timezone survives company timezone changes; unsupported skip/cancel remain explicit gaps',async()=>{const {db,source,options}=await setup();try{
 const request=crypto.randomUUID();await call(db,'create_recurring_invoice',[source,request,options]);await call(db,'set_recurring_invoice_status',[request,'paused']);
 await db.exec('reset role');await db.query("update private.recurring_invoice_plans set anchor_date=current_date-60,next_date=current_date-60,next_index=0 where id=$1",[request]);await db.query('select private.process_recurring_plan($1)',[request]);assert.equal((await db.query<any>('select count(*)::int n from private.recurring_invoice_occurrences where plan_id=$1',[request])).rows[0].n,2);
 await db.query("update businesses set timezone='Pacific/Auckland' where id=$1",[ids.business]);await db.exec('set role authenticated');await call(db,'set_recurring_invoice_status',[request,'active']);
 const page=await call(db,'get_recurring_invoice_page',[ids.business]);assert.equal(page.items[0].timezone,'America/New_York');assert.ok(page.items[0].next_date>=options.first_date);
 for(const unsupported of ['skipped','canceled','ended'])await assert.rejects(call(db,'set_recurring_invoice_status',[request,unsupported]),/pause or resume/);
 }finally{await db.close();}});
test('recurrence rejects foreign/worker access and deposit-adjusted templates without changing financial records',async()=>{const {db,source,options}=await setup();try{
 const request=crypto.randomUUID();await actor(db,ids.outsider);await assert.rejects(call(db,'create_recurring_invoice',[source,request,options]),/owner billing/);await actor(db,ids.worker);await assert.rejects(call(db,'create_recurring_invoice',[source,request,options]),/owner billing/);await actor(db,ids.owner);
 await db.exec('reset role');await db.query('update invoices set deposit_credit=30 where id=$1',[source]);await db.exec('set role authenticated');await assert.rejects(call(db,'create_recurring_invoice',[source,request,options]),/without deposit credits/);
 }finally{await db.close();}});
