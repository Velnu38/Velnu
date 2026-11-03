import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,ids,actor,estimate} from './fixture'
const migration=await readFile('supabase/migrations/20261103130223_invoice_job_handoff.sql','utf8')
async function setup(){const db=await fixture();await db.exec('reset role;');await db.exec(migration);await db.exec('set role authenticated;');return db}
async function invoice(db:Awaited<ReturnType<typeof setup>>){const i=(await db.query<{id:string}>(`insert into invoices(business_id,customer_id) values($1,$2) returning id`,[ids.business,ids.customer])).rows[0].id;await db.query(`insert into invoice_items(business_id,invoice_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Mow and trim',2,50,5,0)`,[ids.business,i]);return i}
const request='88888888-8888-4888-8888-888888888888'
function input(){const s=new Date(Date.now()+7*86400000);s.setUTCHours(14,0,0,0);return {title:'Mow and trim',property_id:ids.site,workers:[ids.owner],starts_at:s.toISOString(),ends_at:new Date(+s+7200000).toISOString()}}
async function book(db:Awaited<ReturnType<typeof setup>>,i:string,p=input()){return (await db.query<{result:{job_id:string;already_created:boolean}}>('select book_invoice_job($1,$2,$3::jsonb) result',[i,request,JSON.stringify(p)])).rows[0].result}

test('invoice scheduling copies customer/scope once, creates an event, preserves issued financials and retries safely',async()=>{const db=await setup();try{
 const i=await invoice(db);await db.query("update invoices set status='sent',due_date=current_date+14 where id=$1",[i]);
 const before=(await db.query('select status,total,balance_due,customer_id,invoice_number from invoices where id=$1',[i])).rows[0];
 const context=(await db.query<{c:any}>('select get_invoice_job_context($1) c',[i])).rows[0].c;
 assert.equal(context.invoice.customer_id,ids.customer);assert.match(context.invoice.scope,/Mow and trim/);assert.equal(context.properties[0].id,ids.site);
 const result=await book(db,i);assert.equal(result.already_created,false);assert.deepEqual(await book(db,i),{job_id:result.job_id,already_created:true});
 const job=(await db.query('select customer_id,property_id,description,status from jobs where id=$1',[result.job_id])).rows[0];assert.equal(job.customer_id,ids.customer);assert.equal(job.property_id,ids.site);assert.match(String(job.description),/Mow and trim × 2/);assert.equal(job.status,'scheduled');
 assert.equal((await db.query('select count(*) n from appointments where job_id=$1',[result.job_id])).rows[0].n,1);
 assert.deepEqual((await db.query('select status,total,balance_due,customer_id,invoice_number from invoices where id=$1',[i])).rows[0],before);
 assert.equal((await db.query('select job_id from invoices where id=$1',[i])).rows[0].job_id,result.job_id);
 }finally{await db.close()}})

test('invoice created from an approved estimate keeps one job and links both records',async()=>{const db=await setup();try{
 const e=await estimate(db);const i=(await db.query<{id:string}>('select convert_estimate_to_invoice($1,null) id',[e])).rows[0].id;
 const result=await book(db,i);
 assert.equal((await db.query('select job_id from estimates where id=$1',[e])).rows[0].job_id,result.job_id);
 assert.equal((await db.query('select source_estimate_id from jobs where id=$1',[result.job_id])).rows[0].source_estimate_id,e);
 await db.exec('reset role;');await db.query('select complete_job_workflow($1,$2,false)',[result.job_id,ids.owner]);await db.exec('set role authenticated;');
 await db.query("update invoices set status='sent' where id=$1",[i]);
 assert.deepEqual((await db.query<{a:any}>('select get_workflow_next_actions($1) a',[ids.business])).rows[0].a.completed,[]);
 }finally{await db.close()}})

test('foreign addresses and occupied crew fail atomically without attaching a partial job',async()=>{const db=await setup();try{
 const a=await invoice(db),b=await invoice(db),p=input();await book(db,a,p);
 await assert.rejects(book(db,b,p),/booked/i);
 await assert.rejects(book(db,b,{...p,property_id:ids.outsider}),/address/i);
 assert.equal((await db.query('select job_id from invoices where id=$1',[b])).rows[0].job_id,null);
 assert.equal((await db.query('select count(*) n from jobs')).rows[0].n,1);
 }finally{await db.close()}})

test('invoice job access rejects other tenants, field roles, anonymous calls and void invoices',async()=>{const db=await setup();try{
 const i=await invoice(db);
 for(const user of [ids.outsider,ids.worker]){await actor(db,user);await assert.rejects(book(db,i),/access/i);await assert.rejects(db.query('select get_invoice_job_context($1)',[i]),/access/i)}
 await actor(db,ids.owner);await db.query("update invoices set status='void' where id=$1",[i]);await assert.rejects(book(db,i),/void/i);
 await db.exec('reset role;set role anon;');await assert.rejects(db.query('select book_invoice_job($1,$2,$3::jsonb)',[i,request,JSON.stringify(input())]),/permission denied/i);
 }finally{await db.close()}})


test('moving a legacy invoice event to a job replaces it once and conflict failure keeps the original event',async()=>{const db=await setup();try{
 const i=await invoice(db),p=input();
 await db.query(`insert into document_schedules(business_id,invoice_id,job_title,description,timezone,status,scheduled_start_time,scheduled_end_time) values($1,$2,'Legacy work','','America/New_York','scheduled',$3,$4)`,[ids.business,i,p.starts_at,p.ends_at]);
 const c=(await db.query<{c:any}>('select get_invoice_job_context($1) c',[i])).rows[0].c;assert.equal(new Date(c.schedule.starts_at).getTime(),Date.parse(p.starts_at));
 const j=await book(db,i,p);assert.ok(j.job_id);assert.equal((await db.query('select count(*) n from document_schedules where invoice_id=$1',[i])).rows[0].n,0);
 const other=await invoice(db);await db.query(`insert into document_schedules(business_id,invoice_id,job_title,description,timezone,status,scheduled_start_time,scheduled_end_time) values($1,$2,'Conflicting event','','America/New_York','scheduled',$3,$4)`,[ids.business,other,p.starts_at,p.ends_at]);
 await assert.rejects(book(db,other,p),/booked/i);assert.equal((await db.query('select count(*) n from document_schedules where invoice_id=$1',[other])).rows[0].n,1);
 }finally{await db.close()}})
