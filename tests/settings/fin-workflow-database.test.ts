import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,ids,actor} from '../scheduling/fixture'
const migration=await readFile('supabase/migrations/20261104203418_fin_contextual_workflows.sql','utf8')
const baseline=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
const fn=(name:string)=>{const i=baseline.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');return baseline.slice(i,baseline.indexOf('$function$;',i)+12)}
async function setup(){const db=await fixture();await db.exec('reset role');await db.exec(`alter table businesses add column if not exists created_by_user_id uuid;alter table businesses add column if not exists business_description text;alter table businesses add column if not exists services_offered text;alter table businesses add column if not exists service_area text;alter table businesses add column if not exists team_roles text;update businesses set created_by_user_id='${ids.owner}' where id='${ids.business}';`)
 for(const table of ['customers','properties','invoices','estimates','jobs','reminders','change_orders'])await db.exec(`alter table ${table} enable row level security;create policy fin_scope on ${table} to authenticated using(exists(select 1 from business_members m where m.business_id=${table}.business_id and m.user_id=auth.uid())) with check(exists(select 1 from business_members m where m.business_id=${table}.business_id and m.user_id=auth.uid()));`)
 for(const name of ['public.create_job_atomic','public.create_scheduled_job','public.update_draft_document','public.set_job_status_atomic'])await db.exec(fn(name))
 for(const table of ['change_order_items','payments']){const match=baseline.match(new RegExp('create table "public"\\."'+table+'" \\(([\\s\\S]*?)\\);','i'))!;await db.exec('create table public.'+table+' ('+match[1]+');alter table '+table+' add primary key(id);grant select,insert,update,delete on '+table+' to authenticated;')}
 for(const name of ['private.valid_payment_links','public.recalc_change_order','private.commerce_change_item_guard','public.record_manual_payment','private.commerce_payment_guard','private.commerce_paid_recalc'])await db.exec(fn(name))
 const owner=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8');const a=owner.indexOf('create function private.guard_invoice_destinations(');await db.exec(owner.slice(a,owner.indexOf('end $$;',a)+7))
 await db.exec(`create function private.is_primary_owner(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer as $$select b='${ids.business}'::uuid and actor='${ids.owner}'::uuid$$;
 create trigger change_item_guard before insert or update or delete on change_order_items for each row execute function private.commerce_change_item_guard();create trigger change_items_recalc after insert or update or delete on change_order_items for each row execute function public.recalc_change_order();
 create trigger payment_guard before insert or update or delete on payments for each row execute function private.commerce_payment_guard();create trigger payment_recalc after insert or update or delete on payments for each row execute function private.commerce_paid_recalc();`)
 await db.exec(await readFile('supabase/migrations/20261102231643_document_workflow_and_contact_import.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261102194320_historical_document_dates.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261103130223_invoice_job_handoff.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261104180222_customer_with_service_address.sql','utf8'))
 await db.exec(migration);await db.exec(await readFile('supabase/migrations/20261104203831_fin_reminder_review_snapshot.sql','utf8'));await db.exec('set role authenticated');return db}
const row=async(db:any,resource:string,id:string)=>(await db.query('select fin_lookup_records($1,$2) x',[ids.business,{resource,id,order:'oldest'}])).rows[0].x.rows[0]
const step=(operation:string,fields:any={},target:string|null=null,customer:string|null=null,record?:any)=>({operation,fields,target,customer,request_id:crypto.randomUUID(),label:'Reviewed test',...(record?{record,expected:record.updated_at||JSON.stringify(record)}:{})})
async function plan(db:any,steps:any[],thread=crypto.randomUUID(),request=crypto.randomUUID()){
 await db.query('select fin_begin_turn($1,$2,$3,$4)',[ids.business,thread,request,'Test request'])
 const reply=(await db.query('select fin_finish_turn($1,$2,$3,$4) x',[ids.business,thread,request,{answer:'Ready for review',steps,sources:[],limits:[],as_of:new Date().toISOString()}])).rows[0].x
 return {thread,request,plan:reply.plan}
}
const execute=(db:any,p:any,approved=true,b=ids.business)=>db.query('select fin_execute_review($1,$2,$3,$4,$5) x',[b,p.thread,p.plan.id,p.plan.version,approved])
const items=[{description:'Mowing',quantity:'1',unit_price:'200',tax_rate:'0'},{description:'Edging',quantity:'1',unit_price:'75',tax_rate:'0'}]
test('targeted search reaches old records, exact totals span pages, and foreign account/role/module access fails',async()=>{const db=await setup();try{
 await db.query(`insert into customers(business_id,first_name,last_name,created_at) select $1,'Person','Name '||n,now()-n*interval '1 day' from generate_series(1,60)n`,[ids.business])
 const search=(await db.query<any>('select fin_lookup_records($1,$2) x',[ids.business,{resource:'customers',query:'Name 60',order:'oldest'}])).rows[0].x;assert.equal(search.rows.length,1);assert.equal(search.rows[0].last_name,'Name 60')
 const list=(await db.query<any>('select fin_lookup_records($1,$2) x',[ids.business,{resource:'customers',order:'oldest'}])).rows[0].x;assert.equal(list.matching_count,61);assert.equal(list.rows.length,25);assert.equal(list.complete,false)
 await db.query(`insert into invoices(business_id,customer_id,issue_date) select $1,$2,current_date-n from generate_series(1,30)n`,[ids.business,ids.customer])
 const invoices=(await db.query<any>('select fin_lookup_records($1,$2) x',[ids.business,{resource:'invoices',order:'oldest'}])).rows[0].x;assert.equal(invoices.matching_count,30);assert.equal(invoices.rows.length,25);assert.equal(Number(invoices.total),0)
 await assert.rejects(db.query('select fin_lookup_records($1,$2)',[ids.other,{resource:'customers'}]),/available/)
 await actor(db,ids.worker);await assert.rejects(db.query('select fin_lookup_records($1,$2)',[ids.business,{resource:'invoices'}]),/available/)
 await actor(db,ids.owner);await db.query("update business_members set access_modules=array['jobs'] where user_id=$1",[ids.owner]);await assert.rejects(db.query('select fin_lookup_records($1,$2)',[ids.business,{resource:'invoices'}]),/available/)
 }finally{await db.close()}})
test('a reviewed multi-step customer and invoice saves once, preserves separate lines and cannot run without approval',async()=>{const db=await setup();try{
 const p=await plan(db,[step('create_customer',{first_name:'Jane',last_name:'Review',email:'jane@example.test'}),step('create_invoice',{items},null,'$step:0')]);assert.equal((await db.query('select count(*) n from invoices')).rows[0].n,0)
 await assert.rejects(execute(db,p,false),/confirm/)
 const a=(await execute(db,p)).rows[0].x;assert.deepEqual((await execute(db,p)).rows[0].x,a);assert.equal(a.steps.length,2)
 assert.equal((await db.query('select count(*) n from invoices')).rows[0].n,1);assert.equal((await db.query('select total from invoices')).rows[0].total,'275.00');assert.equal((await db.query('select count(*) n from invoice_items')).rows[0].n,2)
 }finally{await db.close()}})
test('later-step failure rolls back every earlier step',async()=>{const db=await setup();try{
 const p=await plan(db,[step('create_customer',{first_name:'Rollback'}),step('create_invoice',{items:[{...items[0],quantity:'-1'}]},null,'$step:0')]);await assert.rejects(execute(db,p));assert.equal((await db.query("select count(*) n from customers where first_name='Rollback'")).rows[0].n,0);assert.equal((await db.query('select count(*) n from invoices')).rows[0].n,0)
 }finally{await db.close()}})
test('cross-account IDs, conversations and approval forgery are rejected; cancelled/superseded/expired plans cannot execute',async()=>{const db=await setup();try{
 const c=await row(db,'customers',ids.customer);const p=await plan(db,[step('archive_customer',{},'customers:'+ids.customer,null,c)])
 await actor(db,ids.outsider);await assert.rejects(execute(db,p),/confirm|unavailable/);await assert.rejects(db.query('select fin_begin_turn($1,$2,$3,$4)',[ids.other,p.thread,crypto.randomUUID(),'stolen']),/unavailable/)
 await actor(db,ids.owner);await assert.rejects(plan(db,[step('archive_customer',{},'customers:'+ids.outsider,null,c)]),/unavailable/)
 await db.query('select fin_begin_turn($1,$2,$3,$4)',[ids.business,p.thread,crypto.randomUUID(),'Actually leave that customer active']);await assert.rejects(execute(db,p),/changed/)
 const p2=await plan(db,[step('archive_customer',{},'customers:'+ids.customer,null,c)]);await db.query('select fin_cancel_review($1,$2,$3)',[ids.business,p2.thread,p2.plan.id]);await assert.rejects(execute(db,p2),/changed/)
 const p3=await plan(db,[step('archive_customer',{},'customers:'+ids.customer,null,c)]);await db.exec('reset role');await db.query("update private.fin_reviews set expires_at=now()-interval '1 second' where id=$1",[p3.plan.id]);await db.exec('set role authenticated');await assert.rejects(execute(db,p3),/expired/)
 await db.exec('reset role;set role anon');await assert.rejects(execute(db,p3),/permission denied/)
 }finally{await db.close()}})
test('changed record/permissions are rechecked at execution; yes alone never executes',async()=>{const db=await setup();try{
 const c=await row(db,'customers',ids.customer);const p=await plan(db,[step('archive_customer',{},'customers:'+ids.customer,null,c)])
 const yes=(await db.query<any>('select fin_begin_turn($1,$2,$3,$4) x',[ids.business,p.thread,crypto.randomUUID(),'yes'])).rows[0].x;assert.equal(yes.cached.plan.id,p.plan.id);assert.equal((await row(db,'customers',ids.customer)).archived,false)
 await db.query("update customers set updated_at=now()+interval '1 second' where id=$1",[ids.customer]);await assert.rejects(execute(db,p),/changed/)
 const cp=await plan(db,[step('create_invoice',{items},null,'customers:'+ids.customer)]);await db.query("update customers set updated_at=now()+interval '2 seconds' where id=$1",[ids.customer]);await assert.rejects(execute(db,cp),/customer changed/);
 const newer=await row(db,'customers',ids.customer);const p2=await plan(db,[step('archive_customer',{},'customers:'+ids.customer,null,newer)]);await db.query("update business_members set role='viewer' where user_id=$1",[ids.owner]);await assert.rejects(execute(db,p2),/confirm/)
 }finally{await db.close()}})
test('invoice scheduling uses existing conflict checks and delivery is review-only',async()=>{const db=await setup();try{
 const start=new Date(Date.now()+7*86400000);start.setUTCHours(14,0,0,0);const f={title:'Mowing',starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString()}
 const p=await plan(db,[step('create_invoice',{items},null,'customers:'+ids.customer),step('schedule_invoice',f,'$step:0'),step('review_delivery',{channel:'email'},'$step:0')])
 const result=(await execute(db,p)).rows[0].x;assert.equal(result.steps[2].status,'awaiting_send_review');assert.equal((await db.query('select count(*) n from jobs')).rows[0].n,1);assert.equal((await db.query('select count(*) n from messages')).rows[0].n,0)
 const p2=await plan(db,[step('create_invoice',{items},null,'customers:'+ids.customer),step('schedule_invoice',f,'$step:0')]);await assert.rejects(execute(db,p2),/booked/);assert.equal((await db.query('select count(*) n from invoices')).rows[0].n,1)
 }finally{await db.close()}})
test('knowledge changes require the primary owner and reject conflicting edits; unknown fields are rejected',async()=>{const db=await setup();try{
 await assert.rejects(plan(db,[step('create_customer',{first_name:'No',business_id:ids.other})]),/Unsupported/)
 const p=await plan(db,[step('save_business_knowledge',{knowledge_field:'services_offered',knowledge_value:'Landscaping'})]);await execute(db,p);assert.equal((await db.query('select services_offered from businesses where id=$1',[ids.business])).rows[0].services_offered,'Landscaping')
 const next=await plan(db,[step('save_business_knowledge',{knowledge_field:'services_offered',knowledge_value:'Painting'})]);await db.query("update businesses set services_offered='Roofing' where id=$1",[ids.business]);await assert.rejects(execute(db,next),/knowledge changed/)
 }finally{await db.close()}})

test('permission changes discard saved conversation and reject an in-flight reply and pending review',async()=>{const db=await setup();try{
 const p=await plan(db,[step('create_invoice',{items},null,'customers:'+ids.customer)])
 const r=crypto.randomUUID();await db.query('select fin_begin_turn($1,$2,$3,$4)',[ids.business,p.thread,r,'Find unpaid invoices'])
 await db.query("update business_members set access_modules=array['jobs'] where user_id=$1",[ids.owner])
 await assert.rejects(db.query('select fin_finish_turn($1,$2,$3,$4)',[ids.business,p.thread,r,{answer:'old finance data',steps:[]}]),/Permissions changed/)
 await assert.rejects(execute(db,p),/Permissions changed/)
 const next=(await db.query<any>('select fin_begin_turn($1,$2,$3,$4) x',[ids.business,p.thread,crypto.randomUUID(),'Find my jobs'])).rows[0].x
 assert.deepEqual(next.history,[]);assert.equal(next.cached,null)
 }finally{await db.close()}})

test('customer address, job edits/scheduling/cancel and reminders execute through guarded account records',async()=>{const db=await setup();try{
 let p=await plan(db,[step('create_customer',{first_name:'With Address',address_line1:'123 Test Road',city:'Chesapeake'}),step('create_job',{title:'Mowing'},null,'$step:0'),step('create_reminder',{description:'Follow up',starts_at:new Date(Date.now()+86400000).toISOString()},null,'$step:0')]);let result=(await execute(db,p)).rows[0].x;const cid=result.steps[0].id,jid=result.steps[1].id,rid=result.steps[2].id;assert.equal((await db.query('select count(*) n from properties where customer_id=$1',[cid])).rows[0].n,1)
 const c=await row(db,'customers',cid),j=await row(db,'jobs',jid),r=await row(db,'reminders',rid);const start=new Date(Date.now()+14*86400000);start.setUTCHours(15,0,0,0)
 p=await plan(db,[step('update_customer',{email:'saved@example.test'},'customers:'+cid,null,c),step('update_job',{description:'Bring mower'},'jobs:'+jid,null,j),step('schedule_job',{starts_at:start.toISOString(),ends_at:new Date(+start+3600000).toISOString()},'jobs:'+jid,null,j),step('complete_reminder',{},'reminders:'+rid,null,r)]);await execute(db,p);assert.equal((await row(db,'customers',cid)).email,'saved@example.test');assert.equal((await row(db,'jobs',jid)).status,'scheduled');assert.equal((await row(db,'reminders',rid)).status,'completed')
 const pending=await plan(db,[step('complete_reminder',{},'reminders:'+rid,null,await row(db,'reminders',rid))]);await db.query("update reminders set note='Changed after review' where id=$1",[rid]);await assert.rejects(execute(db,pending),/record changed/);
 const next=await row(db,'jobs',jid);await execute(db,await plan(db,[step('cancel_job',{},'jobs:'+jid,null,next)]));assert.equal((await row(db,'jobs',jid)).status,'canceled')
 }finally{await db.close()}})
test('draft revisions, approved conversion, change orders and payments preserve exact financial records',async()=>{const db=await setup();try{
 let p=await plan(db,[step('create_estimate',{items},null,'customers:'+ids.customer)]);const eid=(await execute(db,p)).rows[0].x.steps[0].id;let e=await row(db,'estimates',eid)
 await execute(db,await plan(db,[step('update_estimate',{items:[...items,{description:'Materials',quantity:'1',unit_price:'25',tax_rate:'0'}]},'estimates:'+eid,null,e)]));e=await row(db,'estimates',eid);assert.equal(Number(e.total),300)
 await assert.rejects(execute(db,await plan(db,[step('convert_estimate',{},'estimates:'+eid,null,e)])),/approved/)
 await db.query("update estimates set status='accepted' where id=$1",[eid]);e=await row(db,'estimates',eid);const iid=(await execute(db,await plan(db,[step('convert_estimate',{},'estimates:'+eid,null,e)]))).rows[0].x.steps[0].id;let inv=await row(db,'invoices',iid)
 await execute(db,await plan(db,[step('update_invoice',{items:[...items,{description:'Materials',quantity:'1',unit_price:'50',tax_rate:'0'}]},'invoices:'+iid,null,inv)]));inv=await row(db,'invoices',iid);assert.equal(Number(inv.total),325)
 const co=(await execute(db,await plan(db,[step('create_change_order',{title:'Additional work',items:[items[1]]},'invoices:'+iid,null,inv)]))).rows[0].x.steps[0].id;assert.equal((await row(db,'change_orders',co)).source_invoice_id,iid);assert.equal(Number((await row(db,'change_orders',co)).total),75)
 await db.query("update invoices set status='sent' where id=$1",[iid]);inv=await row(db,'invoices',iid);p=await plan(db,[step('record_payment',{amount:'100',payment_method:'cash'},'invoices:'+iid,null,inv)]);await execute(db,p);await execute(db,p);assert.equal((await db.query('select count(*) n from payments')).rows[0].n,1);assert.equal(Number((await row(db,'invoices',iid)).balance_due),225)
 inv=await row(db,'invoices',iid);await assert.rejects(execute(db,await plan(db,[step('void_invoice',{},'invoices:'+iid,null,inv)])),/payments/)
 const fresh=(await execute(db,await plan(db,[step('create_invoice',{items},null,'customers:'+ids.customer)]))).rows[0].x.steps[0].id;inv=await row(db,'invoices',fresh);await execute(db,await plan(db,[step('void_invoice',{},'invoices:'+fresh,null,inv)]));assert.equal((await row(db,'invoices',fresh)).status,'void')
 }finally{await db.close()}})
