import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,ids,actor,estimate} from './fixture'
const page=async(db:any,n=1,filter='attention',size=5)=>(await db.query('select get_dashboard_attention_page($1,$2,$3,$4) r',[ids.business,n,size,filter])).rows[0].r

test('attention paging reaches every category beyond preview caps, with stable ties and exact filtered totals',async()=>{
 const db=await fixture();try{
  for(let n=0;n<23;n++)await estimate(db)
  // Bulk read fixtures use the service owner; ordinary writes have separate workflow coverage.
  await db.exec('reset role;')
  await db.query(`with sources as (
    insert into estimates(business_id,customer_id) select $1,$2 from generate_series(1,22) returning id
  ) insert into jobs(business_id,customer_id,title,status,source_estimate_id,completed_at)
    select $1,$2,'Finished work','completed',id,now() from sources`,[ids.business,ids.customer])
  await db.query(`insert into reminders(business_id,kind,due_at,note) select $1,'custom',now()-interval '1 day','Reminder '||n from generate_series(1,12)n`,[ids.business])
  // Prices are calculated through actual document items/guards.
  for(let n=0;n<14;n++){
   const i=(await db.query<{id:string}>('insert into invoices(business_id,customer_id) values($1,$2) returning id',[ids.business,ids.customer])).rows[0].id
   await db.query("insert into invoice_items(business_id,invoice_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Work',1,100,0,0)",[ids.business,i])
   await db.query("update invoices set status='sent',due_date='2000-01-01' where id=$1",[i])
  }
  for(let n=0;n<13;n++){
   const e=await estimate(db);await db.query("update estimates set status='sent',issue_date='2000-01-01' where id=$1",[e])
  }
  await db.query(`insert into change_orders(business_id,customer_id,job_id,title,status,issue_date) select $1,$2,(select id from jobs limit 1),'Change '||n,'sent','2000-01-01' from generate_series(1,11)n`,[ids.business,ids.customer])
  await db.exec('set role authenticated;')
  const first=await page(db),seen=new Set<string>();assert.equal(first.total,95);assert.equal(first.attention_count,95);assert.equal(first.approval_count,24)
  const byKind:Record<string,number>={}
  for(let n=1;n<=19;n++){
   const current=await page(db,n);assert.equal(current.page,n);assert.equal(current.items.length,5)
   assert.deepEqual(current,await page(db,n))
   for(const item of current.items){const key=item.kind+':'+item.data.id;assert.ok(!seen.has(key));seen.add(key);byKind[item.kind]=(byKind[item.kind]||0)+1}
  }
  assert.equal(seen.size,95);assert.deepEqual(byKind,{approved:23,completed:22,reminder:12,invoice:14,change_order:11,estimate:13})
  const approvals=await page(db,5,'approvals');assert.equal(approvals.total,24);assert.equal(approvals.items.length,4);assert.equal(approvals.attention_count,95)
  assert.ok(approvals.items.every((i:any)=>['estimate','change_order'].includes(i.kind)))
  await db.query("update reminders set status='completed' where business_id=$1",[ids.business])
  const clamped=await page(db,19);assert.equal(clamped.page,17);assert.equal(clamped.total,83);assert.equal(clamped.items.length,3)
 }finally{await db.close()}
})

test('attention paging enforces tenant/module access, argument bounds and scheduled eligibility',async()=>{
 const db=await fixture();try{
  const e=await estimate(db)
  await db.query(`insert into document_schedules(business_id,estimate_id,status,scheduled_start_time,scheduled_end_time) values($1,$2,'scheduled',now(),now()+interval '1 hour')`,[ids.business,e])
  assert.equal((await page(db)).total,0)
  await db.query("update document_schedules set status='cancelled'")
  assert.equal((await page(db)).total,1)
  await db.query("insert into reminders(business_id,kind,due_at) values($1,'custom',now()-interval '1 hour')",[ids.business])
  await db.query("update business_members set access_modules=array['billing'] where user_id=$1",[ids.owner])
  assert.equal((await page(db)).total,0) // Calendar/work rows are not disclosed without module access.
  await db.query("update business_members set access_modules=array['calendar','jobs'] where user_id=$1",[ids.owner])
  await assert.rejects(()=>page(db),/access/)
  for(const who of [ids.outsider,ids.worker]){await actor(db,who);await assert.rejects(()=>page(db),/access/)}
  await actor(db,ids.owner);await db.query("update business_members set access_modules=array['billing','calendar','jobs'] where user_id=$1",[ids.owner])
  for(const args of [[0,'attention',5],[1,'bad',5],[1,'attention',51],[1,'attention',0]])await assert.rejects(()=>page(db,...args as [number,string,number]),/Invalid attention page/)
  await db.exec('reset role;set role anon;');await assert.rejects(()=>page(db),/permission denied/)
 }finally{await db.close()}
})

test('only past-due sent balances enter attention, using the business date',async()=>{
 const db=await fixture();try{
  await db.query("update businesses set timezone='Pacific/Kiritimati' where id=$1",[ids.business])
  const i=(await db.query<{id:string}>('insert into invoices(business_id,customer_id) values($1,$2) returning id',[ids.business,ids.customer])).rows[0].id
  await db.query("insert into invoice_items(business_id,invoice_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Work',1,100,0,0)",[ids.business,i])
  await db.query("update invoices set due_date=(now() at time zone 'Pacific/Kiritimati')::date-1 where id=$1",[i])
  assert.equal((await page(db)).total,0) // Drafts never count as overdue invoices.
  await db.query("update invoices set status='sent',due_date=(now() at time zone 'Pacific/Kiritimati')::date where id=$1",[i])
  assert.equal((await page(db)).total,0)
  await db.query("update invoices set due_date=due_date-1 where id=$1",[i])
  assert.equal((await page(db)).total,1)
  await db.query("update invoices set status='void' where id=$1",[i]);assert.equal((await page(db)).total,0)
 }finally{await db.close()}
})
