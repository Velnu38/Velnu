import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture,ids,actor } from './fixture.js'
const baseline=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
const owner=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8')
const workflowFiles=(await readdir('supabase/migrations')).filter(name=>name.endsWith('_document_workflow_and_contact_import.sql'));assert.equal(workflowFiles.length,1)
const workflow=await readFile('supabase/migrations/'+workflowFiles[0],'utf8')
function fn(text:string,name:string){const a=text.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');assert.ok(a>=0,'Function '+name+' exists');return text.slice(a,text.indexOf('$function$;',a)+12)}
async function setup(){const db=await fixture();await db.exec('reset role;');
  for(const table of ['change_order_items']){const match=baseline.match(new RegExp('create table "public"\\."'+table+'" \\(([\\s\\S]*?)\\);','i'))!;await db.exec('create table public.'+table+' ('+match[1]+');alter table '+table+' add primary key(id);')}
  await db.exec(fn(baseline,'private.valid_payment_links'))
  const a=owner.indexOf('create function private.guard_invoice_destinations('),b=owner.indexOf('end $$;',a)+7
  await db.exec(owner.slice(a,b))
  await db.exec(`create function private.is_primary_owner(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer as $$select b='${ids.business}'::uuid and actor='${ids.owner}'::uuid$$;
    grant select,insert,update,delete on change_orders,change_order_items to authenticated;`)
  await db.exec(fn(baseline,'public.recalc_change_order'))
  await db.exec(fn(baseline,'private.commerce_change_item_guard'))
  await db.exec('create trigger change_item_guard before insert or update or delete on change_order_items for each row execute function private.commerce_change_item_guard();create trigger change_items_recalc after insert or update or delete on change_order_items for each row execute function public.recalc_change_order();')
  await db.exec(workflow)
  const paymentTable=baseline.match(/create table "public"\."payments" \(([\s\S]*?)\);/i)!
  await db.exec('create table public.payments ('+paymentTable[1]+');alter table payments add primary key(id);grant select,insert,update on payments to authenticated;')
  for(const name of ['public.record_manual_payment','private.commerce_paid_recalc','private.commerce_payment_guard']) await db.exec(fn(baseline,name))
  await db.exec('create trigger payments_guard before insert or update or delete on payments for each row execute function private.commerce_payment_guard();create trigger payment_recalc after insert or update or delete on payments for each row execute function private.commerce_paid_recalc();')
  await db.exec(await readFile('supabase/migrations/20261106131110_estimate_deposit_final_balance.sql','utf8'))
  await db.exec('set role authenticated;');return db
}

async function approved(db:any){const id=randomUUID();await db.query("insert into estimates(id,business_id,customer_id) values($1,$2,$3)",[id,ids.business,ids.customer]);await db.query("insert into estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate) values($1,$2,'Work',2,50,5)",[id,ids.business]);await db.query("update estimates set status='accepted' where id=$1",[id]);return id}
async function deposit(db:any,e:string,amount=30){return (await db.query('select create_estimate_deposit($1,$2) id',[e,amount])).rows[0].id}
async function pay(db:any,id:string,amount:number,request=randomUUID()){return (await db.query("select record_manual_payment($1,$2,$3,$4,'cash','Received') r",[ids.business,id,request,amount])).rows[0].r}
async function final(db:any,e:string){return (await db.query('select convert_estimate_to_invoice($1) id',[e])).rows[0].id}
async function invoice(db:any,id:string){return (await db.query('select * from invoices where id=$1',[id])).rows[0]}
test('deposit, partial collection, final credit and final settlement preserve exact totals and do not double-count income',async()=>{
 const db=await setup();try{const e=await approved(db),d=await deposit(db,e);
 assert.equal(await deposit(db,e),d);await assert.rejects(()=>deposit(db,e,40),/different amount/);
 await assert.rejects(()=>pay(db,d,10),/Issue the invoice/);
 await db.query("update invoices set status='sent' where id=$1",[d]);
 const request=randomUUID();await pay(db,d,10,request);await pay(db,d,10,request);
 assert.equal(Number((await invoice(db,d)).amount_paid),10);
 await assert.rejects(()=>final(db,e),/Settle the deposit/);
 await pay(db,d,20);const f=await final(db,e);assert.equal(await final(db,e),f);
 const result=await invoice(db,f);assert.equal(Number(result.subtotal),100);assert.equal(Number(result.tax_amount),5);assert.equal(Number(result.deposit_credit),30);assert.equal(Number(result.total),75);assert.equal(Number(result.amount_paid),0);
 await db.query("update invoices set status='sent' where id=$1",[f]);await pay(db,f,75);
 assert.equal((await invoice(db,f)).status,'paid');assert.equal(Number((await db.query("select sum(amount) amount from payments where status='succeeded'")).rows[0].amount),105);
 await assert.rejects(()=>pay(db,f,1),/exceeds/);
 assert.equal((await db.query('select status from estimates where id=$1',[e])).rows[0].status,'converted');
 }finally{await db.close()}
});
test('deposit authorization, forged credits, invalid amounts and void replacement are guarded',async()=>{
 const db=await setup();try{const e=await approved(db);
 for(const amount of [0,-1,105,106,0.001])await assert.rejects(()=>deposit(db,e,amount),/deposit greater/);
 await actor(db,ids.outsider);await assert.rejects(()=>deposit(db,e),/Billing access/);await actor(db,ids.owner);
 const d=await deposit(db,e);await assert.rejects(()=>db.query('update invoices set deposit_credit=10 where id=$1',[d]),/immutable/);
 await assert.rejects(()=>db.query('insert into invoices(business_id,customer_id,estimate_id,deposit_credit) values($1,$2,$3,30)',[ids.business,ids.customer,e]),/credit must reference/);
 await db.query("update invoices set status='void' where id=$1",[d]);const f=await final(db,e);assert.equal(Number((await invoice(db,f)).total),105);
 await assert.rejects(()=>deposit(db,e),/accepted estimate|final invoice/i);
 }finally{await db.close()}
});
test('job completion credits deposits and includes approved additions exactly once',async()=>{
 const db=await setup();try{const e=await approved(db),d=await deposit(db,e);
 await db.query("update invoices set status='sent' where id=$1",[d]);await pay(db,d,30);
 const j=randomUUID();await db.query("insert into jobs(id,business_id,customer_id,title,status,source_estimate_id) values($1,$2,$3,'Work','in_progress',$4)",[j,ids.business,ids.customer,e]);await db.query('update estimates set job_id=$1 where id=$2',[j,e]);
 const c=randomUUID();await db.query("insert into change_orders(id,business_id,customer_id,estimate_id,job_id,title) values($1,$2,$3,$4,$5,'Extra work')",[c,ids.business,ids.customer,e,j]);await db.query("insert into change_order_items(change_order_id,business_id,description,quantity,unit_price,tax_rate) values($1,$2,'Extra',1,20,0)",[c,ids.business]);await db.query("update change_orders set status='approved' where id=$1",[c]);
 await db.exec('reset role;');const result=(await db.query('select complete_job_workflow($1,$2) r',[j,ids.owner])).rows[0].r as any;assert.equal(result.invoice_ready,true);const f=await invoice(db,result.invoice_id);assert.equal(Number(f.total),95);assert.equal(Number(f.deposit_credit),30);
 const retry=(await db.query('select complete_job_workflow($1,$2,true) r',[j,ids.owner])).rows[0].r as any;assert.equal(retry.invoice_id,f.id);assert.equal((await db.query('select count(*)::int n from invoices where estimate_id=$1',[e])).rows[0].n,1);
 }finally{await db.close()}
});
