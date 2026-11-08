import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,plan,user,invoice,B,U,O,C,I} from './fixture'

async function setup(){const db=await fixture();await db.exec(`reset role;
 create function public.has_workspace_access(b uuid,m text) returns boolean language sql as $$select private.member_module_access(b,auth.uid(),m)$$;
 create function private.can_write_business(b uuid) returns boolean language sql as $$select private.fin_access(b,'invoices',true)$$;
 alter table customers add column if not exists company text;
 alter table private.finviant_email_outbox add column if not exists customer_snapshot jsonb;
 `);await db.exec(await readFile('supabase/migrations/20261108155833_pro_value_workflow_release.sql','utf8'));return db}

test('Individual manual email is metered at 250 while scheduled tasks and non-document sends remain Pro',async()=>{const db=await setup();try{
 await plan(db,'basic');await db.exec('reset role');
 assert.equal((await db.query<any>("select private.tier_limit('basic','email') n")).rows[0].n,250);
 assert.equal((await db.query<any>("select private.tier_limit('pro','email') n")).rows[0].n,2000);
 const id=crypto.randomUUID();assert.equal((await db.query<any>("select private.manual_or_pro_email($1,'invoice',$2) ok",[B,id])).rows[0].ok,true);
 for(const kind of ['schedule','invoice_reminder'])assert.equal((await db.query<any>('select private.manual_or_pro_email($1,$2,$3) ok',[B,kind,id])).rows[0].ok,false);
 await db.query("insert into private.delivery_tasks(id,business_id,actor_id,kind,document_id,due_at) values($1,$2,$3,'invoice',$4,now())",[id,B,U,I]);
 assert.equal((await db.query<any>("select private.manual_or_pro_email($1,'invoice',$2) ok",[B,id])).rows[0].ok,false);
 await db.query("select private.reserve_tier_usage($1,$2,'email',250)",[B,id]);
 assert.equal((await db.query<any>("select private.reserve_tier_usage($1,$2,'email',250) reserved",[B,id])).rows[0].reserved,false);
 await assert.rejects(db.query("select private.reserve_tier_usage($1,$2,'email',1)",[B,crypto.randomUUID()]),/allowance reached/);
 await plan(db,'free');await db.exec('reset role');assert.equal((await db.query<any>("select private.manual_or_pro_email($1,'invoice',$2) ok",[B,id])).rows[0].ok,false);
 }finally{await db.close()}})

test('saved service items enforce tenant access, numeric bounds and preserve document lines on removal',async()=>{const db=await setup();try{
 await invoice(db);await user(db);const item=(await db.query<any>("insert into service_items(business_id,description,unit_price,tax_rate) values($1,'Mowing',75,5) returning id",[B])).rows[0];
 await assert.rejects(db.query("insert into service_items(business_id,description,unit_price) values($1,'mowing',80)",[B]),/duplicate key/);
 await assert.rejects(db.query("insert into service_items(business_id,description,unit_price) values($1,'Invalid',-1)",[B]),/check constraint/);
 await user(db,O);await db.exec('reset role');await db.query("update business_members set access_modules='{}' where business_id=$1 and user_id=$2",[B,O]);await user(db,O);
 assert.equal((await db.query('select * from service_items')).rows.length,0);
 await assert.rejects(db.query("insert into service_items(business_id,description,unit_price) values($1,'Unauthorized',1)",[B]),/row-level security/);
 await user(db);await db.query('update service_items set active=false where id=$1',[item.id]);assert.equal(Number((await db.query<any>('select unit_price from invoice_items where invoice_id=$1',[I])).rows[0].unit_price),100);
 await db.query("insert into service_items(business_id,description,unit_price) values($1,'Mowing',80)",[B]);
 await assert.rejects(db.query('update service_items set business_id=$1 where id=$2',[B,item.id]),/permission denied/);
 }finally{await db.close()}})

test('CSV customer import stores company, skips existing email and preserves replay identity',async()=>{const db=await setup();try{
 await user(db);const id=crypto.randomUUID(),rows=[{id,first_name:'Alex',last_name:'Morgan',company:'Morgan Services',email:'alex@example.test',phone:null}];
 const call=(rows:any[])=>db.query<any>('select import_customer_contacts($1,$2) result',[B,JSON.stringify(rows)]);
 assert.equal((await call(rows)).rows[0].result.imported,1);
 assert.equal((await call(rows)).rows[0].result.already_imported,1);
 assert.equal((await db.query<any>('select company from customers where id=$1',[id])).rows[0].company,'Morgan Services');
 assert.equal((await call([{...rows[0],id:crypto.randomUUID()}])).rows[0].result.skipped,1);
 await assert.rejects(call([{...rows[0],company:'Different Company'}]),/retry contains different/);
 await user(db,O);await assert.rejects(call([{...rows[0],id:crypto.randomUUID()}]),/primary account owner/);
 }finally{await db.close()}})
