import test from 'node:test'
import assert from 'node:assert/strict'
import {accountDatabase} from './fin-account-fixture'
import {ids,actor} from '../scheduling/fixture'
import {accountCatalog} from '../../supabase/functions/fin-workflow/catalog'
const lookup=async(db:any,resource:string,id?:string)=>(await db.query('select fin_lookup_records($1,$2) x',[ids.business,{resource,id}])).rows[0].x;
async function review(db:any,resource:string,values:any={},id?:string,operation='update_account_record',customer?:string){
 const record=id?(await lookup(db,resource,id)).rows[0]:null;const thread=crypto.randomUUID(),request=crypto.randomUUID();
 await db.query('select fin_begin_turn($1,$2,$3,$4)',[ids.business,thread,request,'Update my account']);
 const step={operation,target:id?resource+':'+id:null,customer:customer?'customers:'+customer:null,fields:{resource,values},label:'Account edit',request_id:crypto.randomUUID(),...(record?{record,expected:record._version}:{})};
 const response=(await db.query('select fin_finish_turn($1,$2,$3,$4) x',[ids.business,thread,request,{answer:'Review',steps:[step],sources:[],limits:[]}])).rows[0].x;return {thread,...response.plan};
}
const execute=(db:any,p:any,approved=true)=>db.query('select fin_execute_review($1,$2,$3,$4,$5) x',[ids.business,p.thread,p.id,p.version,approved]);
test('every catalog resource queries safely; capabilities and lookup deny foreign and restricted accounts',async()=>{const db=await accountDatabase();try{
 for(const resource of Object.keys(accountCatalog.resources)){const data=await lookup(db,resource);assert.ok(Array.isArray(data.rows),resource)}
 const caps=(await db.query<any>('select fin_account_capabilities($1) x',[ids.business])).rows[0].x;assert.equal(Object.keys(caps.resources).length,25);assert.equal(caps.resources.business_profile.can_write,true);
 await assert.rejects(db.query('select fin_lookup_records($1,$2)',[ids.other,{resource:'business_profile'}]),/available/);
 await actor(db,ids.worker);const limited=(await db.query<any>('select fin_account_capabilities($1) x',[ids.business])).rows[0].x;assert.equal(limited.resources.customers.can_write,false);assert.equal(limited.resources.document_settings,undefined);assert.equal(limited.resources.invoices,undefined);await assert.rejects(lookup(db,'team_members'),/available/);
 }finally{await db.close()}});
test('profile and document edits require confirmation, are idempotent, and detect stale values',async()=>{const db=await accountDatabase();try{
 const p=await review(db,'business_profile',{phone:'555-0100',business_description:'Landscaping and lawn care'},ids.business);assert.notEqual((await lookup(db,'business_profile',ids.business)).rows[0].phone,'555-0100');await assert.rejects(execute(db,p,false),/confirm/);await execute(db,p);await execute(db,p);assert.equal((await lookup(db,'business_profile',ids.business)).rows[0].phone,'555-0100');
 const next=await review(db,'business_profile',{phone:'555-0101'},ids.business);await db.query('update businesses set phone=$1 where id=$2',['555-0102',ids.business]);await assert.rejects(execute(db,next),/record changed/);
 await execute(db,await review(db,'document_settings',{default_tax_rate:5,payment_instructions:'Pay on completion'},ids.business));assert.equal(Number((await lookup(db,'document_settings',ids.business)).rows[0].default_tax_rate),5);
 await assert.rejects(review(db,'document_settings',{default_tax_rate:null},ids.business),/cannot be cleared/);await assert.rejects(review(db,'business_profile',{created_by_user_id:ids.worker},ids.business),/read-only/);
 }finally{await db.close()}});
test('customer address create and updates preserve customer/account references and reject stale related rows',async()=>{const db=await accountDatabase();try{
 const p=await review(db,'properties',{address_line1:'55 New Lane',city:'Chesapeake'},undefined,'create_account_record',ids.customer);const made=(await execute(db,p)).rows[0].x.steps[0];assert.equal((await lookup(db,'properties',made.id)).rows[0].customer_id,ids.customer);
 await execute(db,await review(db,'properties',{access_notes:'Use side gate'},made.id));assert.equal((await lookup(db,'properties',made.id)).rows[0].access_notes,'Use side gate');
 await assert.rejects(review(db,'properties',{address_line1:null},made.id),/cannot be cleared|address/);
 }finally{await db.close()}});
test('manual ledger creation, edits and removals are atomic and preserve amount constraints',async()=>{const db=await accountDatabase();try{
 const p=await review(db,'bookkeeping_entries',{entry_date:'2026-11-04',direction:'expense',amount:125.25,category:'Materials',description:'Mulch'},undefined,'create_account_record');const id=(await execute(db,p)).rows[0].x.steps[0].id;
 const all=await lookup(db,'bookkeeping_entries');assert.equal(Number(all.expense_total),125.25);assert.equal(Number(all.income_total),0);
 await execute(db,await review(db,'bookkeeping_entries',{notes:'Paid by cash',amount:130},id));assert.equal(Number((await lookup(db,'bookkeeping_entries',id)).rows[0].amount),130);
 await assert.rejects(review(db,'bookkeeping_entries',{amount:-1},id),/number/);await execute(db,await review(db,'bookkeeping_entries',{},id,'remove_account_record'));assert.equal((await lookup(db,'bookkeeping_entries',id)).rows.length,0);
 }finally{await db.close()}});
test('calendar and time-off changes validate dates and preserve immutable linked work',async()=>{const db=await accountDatabase();try{
 const start='2027-01-05T15:00:00Z',end='2027-01-05T16:00:00Z';const p=await review(db,'appointments',{title:'Site visit',starts_at:start,ends_at:end},undefined,'create_account_record',ids.customer);const id=(await execute(db,p)).rows[0].x.steps[0].id;
 await execute(db,await review(db,'appointments',{notes:'Bring tape measure'},id));await assert.rejects(execute(db,await review(db,'appointments',{ends_at:'2027-01-05T14:00:00Z'},id)),/End time/);
 const blocked=await review(db,'worker_time_off',{user_id:ids.worker,starts_at:start,ends_at:end,note:'Dentist'},undefined,'create_account_record');const bid=(await execute(db,blocked)).rows[0].x.steps[0].id;
 await execute(db,await review(db,'worker_time_off',{note:'Appointment moved',ends_at:'2027-01-05T17:00:00Z'},bid));assert.equal((await lookup(db,'worker_time_off',bid)).rows[0].note,'Appointment moved');
 await execute(db,await review(db,'worker_time_off',{},bid,'remove_account_record'));assert.equal((await lookup(db,'worker_time_off',bid)).rows.length,0);
 await execute(db,await review(db,'scheduling_preferences',{buffer_minutes:30},ids.business));assert.equal((await lookup(db,'scheduling_preferences',ids.business)).rows[0].buffer_minutes,30);
 }finally{await db.close()}});
test('team edits cannot change the primary owner; role changes invalidate pending reviews',async()=>{const db=await accountDatabase();try{
 await assert.rejects(execute(db,await review(db,'team_members',{role:'office'},ids.owner)),/owner cannot/);
 await execute(db,await review(db,'team_members',{role:'viewer',access_modules:['jobs','calendar']},ids.worker));assert.equal((await lookup(db,'team_members',ids.worker)).rows[0].role,'viewer');
 const pending=await review(db,'customers',{notes:'Approved note'},ids.customer);await actor(db,ids.worker);await assert.rejects(execute(db,pending),/confirm|unavailable/);await assert.rejects(review(db,'customers',{notes:'Unauthorized'},ids.customer),/perform|denied/);
 }finally{await db.close()}});
test('connected calendars are user scoped and omit credentials; support and reference lookups enforce account boundaries',async()=>{const db=await accountDatabase();try{
 await db.exec('reset role');await db.query(`insert into private.calendar_integrations(business_id,user_id,provider,account_id,email,credentials) values($1,$2,'google','a','owner@example.test','{"secret":"must never leave"}'),($1,$3,'google','b','worker@example.test','{"secret":"must never leave"}')`,[ids.business,ids.owner,ids.worker]);
 await db.query(`insert into private.support_cases(id,business_id,reporter_id,title,description) values(gen_random_uuid(),$1,$2,'Owner issue','Owner description'),(gen_random_uuid(),$1,$3,'Worker issue','Worker description')`,[ids.business,ids.owner,ids.worker]);
 const foreign=crypto.randomUUID();await db.query(`insert into properties(id,business_id,customer_id,address_line1) values($1,$2,$3,'Foreign address')`,[foreign,ids.other,ids.outsider]);await db.exec('set role authenticated');
 const calendars=await lookup(db,'calendar_connections');assert.equal(calendars.rows.length,1);assert.equal(calendars.rows[0].email,'owner@example.test');assert.ok(!JSON.stringify(calendars).includes('must never leave'));assert.equal((await lookup(db,'properties',foreign)).rows.length,0);
 assert.equal((await lookup(db,'support_cases')).rows.length,1);await actor(db,ids.worker);assert.equal((await lookup(db,'calendar_connections')).rows[0].email,'worker@example.test');assert.equal((await lookup(db,'support_cases')).rows.length,1);
 await actor(db,ids.owner);await assert.rejects(review(db,'bookkeeping_entries',{entry_date:'2026-11-04',direction:'expense',amount:25,category:'Work',description:'Foreign link',job_id:foreign},undefined,'create_account_record'),/unavailable/);
 }finally{await db.close()}});
test('related records and line-item changes invalidate review; search/detail snapshots are consistent',async()=>{const db=await accountDatabase();try{
 const jid=(await db.query<any>(`insert into jobs(business_id,customer_id,title) values($1,$2,'Mowing') returning id`,[ids.business,ids.customer])).rows[0].id;
 const plan=await review(db,'jobs',{property_id:ids.site},jid);await db.query(`update properties set access_notes='New access instructions' where id=$1`,[ids.site]);await assert.rejects(execute(db,plan),/related record changed/);
 const iid=(await db.query<any>(`insert into invoices(business_id,customer_id,issue_date) values($1,$2,current_date) returning id`,[ids.business,ids.customer])).rows[0].id;
 await db.query(`insert into invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Mow',1,100,0,0)`,[iid,ids.business]);const list=(await lookup(db,'invoices')).rows[0],detail=(await lookup(db,'invoices',iid)).rows[0];assert.equal(list._version,detail._version);assert.equal(list.items,undefined);assert.equal(detail.items.length,1);
 const edit=await review(db,'invoices',{notes:'Updated'},iid);await db.query(`update invoice_items set description='Changed description' where invoice_id=$1`,[iid]);await assert.rejects(execute(db,edit),/record changed/);
 await db.query(`update invoices set status='sent' where id=$1`,[iid]);await assert.rejects(execute(db,await review(db,'invoices',{notes:'Overwrite issued'},iid)),/history/);
 }finally{await db.close()}});

test('Fin rejects clearing completed work when the linked job is completed',async()=>{const db=await accountDatabase();try{
 const job=(await db.query<any>(`insert into jobs(business_id,customer_id,title,status) values($1,$2,'Completed work','completed') returning id`,[ids.business,ids.customer])).rows[0].id;
 const invoice=(await db.query<any>(`insert into invoices(business_id,customer_id,job_id,work_completed) values($1,$2,$3,true) returning id`,[ids.business,ids.customer,job])).rows[0].id;
 await assert.rejects(execute(db,await review(db,'invoices',{work_completed:false},invoice)),/completed job/);assert.equal((await lookup(db,'invoices',invoice)).rows[0].work_completed,true);
 }finally{await db.close()}});
