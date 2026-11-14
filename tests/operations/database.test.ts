import assert from 'node:assert/strict'
import test from 'node:test'
import {operationsFixture,B,C,J,W,U,O,I,invoice,user,value,service} from './fixture.ts'
const task='cccccccc-cccc-4ccc-8ccc-cccccccccccc',request='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const manage=(db:any,action:string,p:Record<string,unknown>)=>value(db,'select public.manage_job_workspace($1,$2,$3,$4) value',[B,J,action,JSON.stringify(p)])
test('job checklist is tenant scoped, optimistic and does not grant account access',async()=>{const db=await operationsFixture();try{
 await user(db,U);let result=await manage(db,'add_task',{id:task,title:'Check site',worker_id:W});assert.equal(result.tasks.length,1);assert.equal((await manage(db,'add_task',{id:task,title:'Check site',worker_id:W})).tasks.length,1)
 await assert.rejects(()=>manage(db,'add_task',{id:task,title:'Different'}),/different/)
 await manage(db,'complete_task',{id:task,version:1,completed:true});await assert.rejects(()=>manage(db,'complete_task',{id:task,version:1,completed:false}),/changed/)
 await db.exec("reset role;insert into auth.users values('ffffffff-ffff-4fff-8fff-ffffffffffff')");await user(db,'ffffffff-ffff-4fff-8fff-ffffffffffff');await assert.rejects(()=>value(db,'select public.get_job_workspace($1,$2) value',[B,J]),/access/)
 await assert.rejects(()=>manage(db,'add_task',{id:request,title:'Attack'}),/access/)
 await user(db,U);await assert.rejects(()=>db.query('select * from private.job_tasks'),/permission denied/)
 await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from public.business_members where user_id=$1',[W]),0)
 }finally{await db.close()}})
test('financial job costs require separate permission; retries and invalid numbers do not duplicate',async()=>{const db=await operationsFixture();try{
 await user(db,U);await manage(db,'save_budget',{version:0,revenue:500,cost:200,hours:3});await assert.rejects(()=>manage(db,'save_budget',{version:0,revenue:999,cost:999,hours:3}),/changed/)
 const p={request_id:request,worked_on:'2026-11-01',minutes:90,hourly_cost:20,worker_id:W,note:'Installation'};await manage(db,'add_time',p);let result=await manage(db,'add_time',p);assert.equal(result.time.length,1);assert.equal(Number(result.time[0].minutes)*Number(result.time[0].hourly_cost)/60,30)
 await assert.rejects(()=>manage(db,'add_time',{...p,minutes:120}),/different/)
 await assert.rejects(()=>manage(db,'add_time',{...p,request_id:task,minutes:-1}),/check constraint/)
 await db.exec(`reset role;update public.business_members set role='technician',access_modules=array['jobs'] where business_id='${B}' and user_id='${U}';`);await user(db,U)
 result=await value(db,'select public.get_job_workspace($1,$2) value',[B,J]);assert.equal(result.financial_access,false);assert.equal('time' in result,false);assert.equal('recorded_expenses' in result,false);await assert.rejects(()=>manage(db,'add_time',p),/Financial/)
 }finally{await db.close()}})
test('receivables use remaining issued balances, exclude draft/void and keep aging exclusive',async()=>{const db=await operationsFixture();try{
 await invoice(db);await db.exec(`update public.invoices set status='sent',amount_paid=25,due_date=current_date-35 where id='${I}';`);await user(db,U)
 const result=await value(db,'select public.get_financial_overview($1) value',[B]);assert.equal(Number(result.receivables.outstanding),75);assert.equal(Number(result.receivables.overdue),75);assert.equal(result.aging.length,1);assert.equal(result.aging[0].bucket,'31–60 days')
 await db.exec(`reset role;update public.invoices set status='void' where id='${I}';`);await user(db,U);assert.equal(Number((await value(db,'select public.get_financial_overview($1) value',[B])).receivables.outstanding),0)
 await user(db,'ffffffff-ffff-4fff-8fff-ffffffffffff');await assert.rejects(()=>value(db,'select public.get_financial_overview($1) value',[B]),/access/)
 }finally{await db.close()}})
test('Square reservations reject wrong amount/merchant/location; callbacks post once; refunds preserve dated gross cash',async()=>{const db=await operationsFixture(true);try{
 await invoice(db);await db.exec(`reset role;update public.invoices set status='sent',sent_at=now() where id='${I}';insert into private.square_connections(business_id,merchant_id,location_id,location_name,currency,environment,token_envelope,token_expires_at) values('${B}','M_TEST','L_TEST','Test','USD','sandbox','{}',now()+interval '30 days');`)
 await service(db);const reserve=await value(db,'select public.square_service($1,$2) value',['reserve_pos',JSON.stringify({business_id:B,actor_id:U,invoice_id:I,request_id:request,state_hash:'aa'.repeat(32)})]);assert.equal(reserve.state,'ready');const op=reserve.operation
 await value(db,'select public.square_service($1,$2) value',['attach',JSON.stringify({operation_id:op.id,order_id:'ORDER_TEST'})]);
 const p={operation_id:op.id,merchant_id:'M_TEST',location_id:'L_TEST',environment:'sandbox',order_id:'ORDER_TEST',payment_id:'PAYMENT_TEST',amount_minor:10000,currency:'USD',status:'COMPLETED',created_at:new Date().toISOString(),event_id:'evt_test',refunds:[],processing_fee_minor:320}
 const apply=(p:any)=>value(db,'select public.apply_square_payment($1) value',[JSON.stringify(p)])
 await assert.rejects(()=>apply({...p,amount_minor:9999}),/verification/);await assert.rejects(()=>apply({...p,merchant_id:'WRONG'}),/verification/);await assert.rejects(()=>apply({...p,location_id:'WRONG'}),/verification/)
 assert.equal((await apply(p)).state,'paid');assert.equal((await apply(p)).duplicate,true);await apply({...p,event_id:'evt_other'})
 await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from public.payments'),1);assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'paid');assert.equal(await value(db,'select count(*)::int value from public.bookkeeping_entries'),1)
 await service(db);await apply({...p,event_id:'refund_event',refunds:[{id:'REFUND_TEST',amount_minor:2500,refunded_at:new Date().toISOString()}]});await apply({...p,event_id:'refund_again',refunds:[{id:'REFUND_TEST',amount_minor:2500,refunded_at:new Date().toISOString()}]})
 await db.exec('reset role');assert.equal(Number(await value(db,'select amount_paid value from public.invoices where id=$1',[I])),75);await user(db,U)
 const cash=(await db.query('select * from public.list_invoice_cash_activity($1)',[B])).rows;assert.equal(cash.length,2);assert.equal(Number(cash.find((r:any)=>r.direction==='income').amount),100);assert.equal(Number(cash.find((r:any)=>r.direction==='expense').amount),25)
 await assert.rejects(()=>value(db,'select public.apply_square_payment($1) value',[JSON.stringify(p)]),/permission denied/)
 }finally{await db.close()}})
test('surcharge preference is owner only, capped and cannot enable unverified collection',async()=>{const db=await operationsFixture(true);try{
 await user(db,U);const p=await value(db,'select public.square_payment_settings($1,true,300) value',[B]);assert.equal(p.fee_requested,true);assert.equal(p.fee_active,false)
 await assert.rejects(()=>value(db,'select public.square_payment_settings($1,true,301) value',[B]),/check constraint/);await user(db,O);await assert.rejects(()=>value(db,'select public.square_payment_settings($1,true,300) value',[B]),/owner/)
 }finally{await db.close()}})

test('copying an issued paid invoice makes a fresh draft without payment or sharing history',async()=>{const db=await operationsFixture();try{
 await invoice(db);await db.exec(`update public.invoices set status='paid',amount_paid=100,sent_at=now(),paid_at=now() where id='${I}';`);await user(db,U)
 const draft=await value(db,'select public.copy_document_to_draft($1,$2,$3,$4) value',[B,'invoice',I,request]);assert.notEqual(draft.id,I);assert.equal(draft.status,'draft');assert.equal(Number(draft.amount_paid),0);assert.equal(draft.sent_at,null);assert.equal(draft.estimate_id,null);assert.equal(Number(draft.total),100)
 const again=await value(db,'select public.copy_document_to_draft($1,$2,$3,$4) value',[B,'invoice',I,request]);assert.equal(again.id,draft.id)
 await db.exec('reset role');assert.equal(await value(db,'select status value from invoices where id=$1',[I]),'paid');assert.equal(await value(db,'select count(*)::int value from payments'),0)
 }finally{await db.close()}})
test('expense reimbursement creates one reviewed draft, preserves costs, and statements exclude drafts',async()=>{const db=await operationsFixture();try{
 await invoice(db);await db.exec(`update public.invoices set status='sent',amount_paid=25,sent_at=now() where id='${I}';insert into bookkeeping_entries(id,business_id,created_by,entry_date,direction,amount,currency,category,description,job_id) values('${task}','${B}','${U}',current_date,'expense',45,'USD','Materials','Cabinet hardware','${J}');`);await user(db,U)
 const bill=()=>value(db,'select public.bill_expense_to_draft($1,$2,$3,$4) value',[B,task,C,request]);const first=await bill();assert.ok(first.id);await db.exec('reset role');await db.query('insert into public.record_photos(business_id,expense_id,storage_path) values($1,$2,$3)',[B,task,B+'/receipt.jpg']);await db.query("insert into storage.objects values($1,'finviant-record-photos')",[B+'/receipt.jpg']);await user(db,U);assert.equal(await value(db,'select private.can_remove_unbilled_receipt($1) value',[B+'/receipt.jpg']),false);assert.equal((await bill()).id,first.id);assert.equal((await bill()).existing,true)
 const statement=await value(db,'select public.get_customer_statement($1,$2) value',[B,C]);assert.equal(statement.invoice_count,1);assert.equal(Number(statement.outstanding),75);assert.equal(statement.invoices[0].id,I)
 await db.exec('reset role');assert.equal(Number(await value(db,'select amount value from bookkeeping_entries where id=$1',[task])),45);assert.equal(await value(db,'select count(*)::int value from invoices'),2)
 await db.query("update public.invoices set status='void' where id=$1",[first.id]);assert.equal(await value(db,'select count(*)::int value from private.expense_invoice_drafts'),0);await user(db,U);assert.equal(await value(db,'select private.can_remove_unbilled_receipt($1) value',[B+'/receipt.jpg']),true);const replacement=await value(db,'select public.bill_expense_to_draft($1,$2,$3,$4) value',[B,task,C,task]);assert.notEqual(replacement.id,first.id);assert.equal(replacement.status,'draft');
 await user(db,'ffffffff-ffff-4fff-8fff-ffffffffffff');await assert.rejects(()=>bill(),/access/)
 }finally{await db.close()}})

test('existing Stripe settlement/refunds remain accurate after the Square migration',async()=>{const db=await operationsFixture(true);try{
 await invoice(db);await db.exec(`reset role;update public.invoices set status='sent',sent_at=now() where id='${I}';insert into private.customer_payment_merchants(business_id,stripe_account_id,enabled,verified_at,verification_reference) values('${B}','acct_fixture',true,now(),'fixture-proof');`)
 const token='cd'.repeat(32),revision='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';await db.query('insert into private.payment_test_context values($1,$2)',[token,JSON.stringify({kind:'invoice',business_id:B,document_id:I,revision_id:revision,publication_ready:true,superseded:false,action_state:'payment_due',currency:'USD',action_expires_at:null})]);await service(db)
 const c=await value(db,'select public.reserve_customer_checkout($1,$2) value',[token,request]);assert.ok(c.id)
 await value(db,"select public.apply_customer_payment_event('evt_fixture','acct_fixture',$1,'cs_test_fixture','pi_fixture',10000,'usd',false,'paid',now(),'card') value",[c.id]);await value(db,"select public.apply_customer_payment_refund('evt_refund','acct_fixture',$1,'pi_fixture',false,'usd',$2) value",[c.id,JSON.stringify([{id:'re_fixture',amount_minor:2500,refunded_at:new Date().toISOString()}])])
 await db.exec('reset role');assert.equal(Number(await value(db,'select amount_paid value from invoices where id=$1',[I])),75);assert.equal(await value(db,'select status value from invoices where id=$1',[I]),'partial')
 await user(db,U);const rows=(await db.query('select * from public.list_invoice_cash_activity($1)',[B])).rows;assert.equal(rows.length,2);assert.equal(Number(rows.find((r:any)=>r.direction==='income').amount),100);assert.equal(Number(rows.find((r:any)=>r.direction==='expense').amount),25)
 }finally{await db.close()}})
