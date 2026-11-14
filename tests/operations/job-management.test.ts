import assert from 'node:assert/strict'
import test from 'node:test'
import {managementFixture,B,C,J,U,O,W,user,value} from './management-fixture.ts'
const M='cccccccc-cccc-4ccc-8ccc-cccccccccccc',T='dddddddd-dddd-4ddd-8ddd-dddddddddddd',R='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const manage=(db:any,action:string,p:Record<string,unknown>,business=B,job=J)=>value(db,'select public.manage_job_management($1,$2,$3,$4) value',[business,job,action,JSON.stringify(p)])
const workspace=(db:any)=>value(db,'select public.get_job_management($1,$2) value',[B,J])
test('materials persist, reject stale writes, separate estimated costs from actual expenses and record actor history',async()=>{
 const db=await managementFixture();try{await user(db,U)
 const p={id:M,version:0,name:'Pavers',quantity:120,unit:'pieces',supplier:'Local supplier',status:'needed',estimated_cost:250}
 let data=await manage(db,'save_material',p);assert.equal(data.materials.length,1);assert.equal(Number(data.materials[0].estimated_cost),250);assert.equal(data.activity[0].actor,'You')
 data=await manage(db,'save_material',p);assert.equal(data.materials.length,1);assert.equal(data.activity.length,1,'retry does not duplicate audit events')
 data=await manage(db,'save_material',{...p,version:1,status:'ordered'});assert.equal(data.materials[0].version,2)
 await assert.rejects(()=>manage(db,'save_material',{...p,version:1,status:'received'}),/changed/)
 await assert.rejects(()=>manage(db,'save_material',{...p,id:T,name:'Bad',quantity:0}),/check constraint/)
 await assert.rejects(()=>manage(db,'save_material',{...p,id:T,status:'invalid'}),/check constraint/)
 const signals=await value(db,'select public.get_job_management_signals($1,$2) value',[B,[J]]);assert.equal(signals[0].materials_needed,1)
 await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from public.bookkeeping_entries'),0)
 await user(db,U);await manage(db,'remove_material',{id:M,version:2});assert.equal((await workspace(db)).materials.length,0)
 }finally{await db.close()}
})
test('tasks support worker, due date and priority edits; reusable templates apply once without copying assignments or completion',async()=>{
 const db=await managementFixture();try{await user(db,U)
 let data=await value(db,'select public.manage_job_workspace($1,$2,$3,$4) value',[B,J,'add_task',JSON.stringify({id:T,title:'Prepare base',worker_id:W,due_on:'2026-11-01',priority:'high'})]);assert.equal(data.tasks[0].priority,'high')
 await manage(db,'edit_task',{id:T,version:1,title:'Prepare and compact base',due_on:'2026-11-02',worker_id:W,priority:'normal'})
 await assert.rejects(()=>manage(db,'edit_task',{id:T,version:1,title:'Stale',priority:'normal'}),/changed/)
 data=await manage(db,'save_template',{id:M,name:'Patio prep'});assert.equal(data.templates[0].count,1)
 data=await manage(db,'apply_template',{template_id:M,request_id:R});assert.equal(data.tasks.length,2);assert.equal(data.tasks[1].worker_id,null);assert.equal(data.tasks[1].due_on,null);assert.equal(data.tasks[1].completed,false)
 assert.equal((await manage(db,'apply_template',{template_id:M,request_id:R})).tasks.length,2)
 data=await manage(db,'remove_template',{id:M});assert.equal(data.templates.length,0);assert.equal(data.tasks.length,2)
 }finally{await db.close()}
})
test('management reads and mutations enforce tenant, module and role permissions; private tables and anonymous RPCs stay inaccessible',async()=>{
 const db=await managementFixture();try{await user(db,U);await manage(db,'save_material',{id:M,version:0,name:'Sand',quantity:2,status:'needed',estimated_cost:50})
 await db.exec(`reset role;update public.business_members set role='technician',access_modules=array['jobs'] where user_id='${O}'`);await user(db,O)
 let data=await workspace(db);assert.equal(data.financial_access,false);assert.equal(data.billing_access,false);assert.equal(data.calendar_access,false);assert.equal('estimated_cost' in data.materials[0],false);assert.equal('documents' in data,false);assert.equal('time' in data,false)
 await assert.rejects(()=>manage(db,'save_material',{id:M,version:1,name:'Sand',quantity:3,status:'ordered',estimated_cost:55}),/Financial/)
 await assert.rejects(()=>manage(db,'save_template',{id:T,name:'Attack'}),/Office/)
 await db.exec(`reset role;update public.business_members set role='viewer' where user_id='${O}'`);await user(db,O)
 await assert.rejects(()=>manage(db,'save_material',{id:T,version:0,name:'Blocked',quantity:1,status:'needed'}),/editing access/)
 await assert.rejects(()=>db.query('select * from private.job_materials'),/permission/)
 await user(db,'ffffffff-ffff-4fff-8fff-ffffffffffff');await assert.rejects(()=>workspace(db),/access/)
 await user(db,U);await assert.rejects(()=>value(db,'select public.get_job_management_signals($1,$2) value',[B,[J,T]]),/access/)
 await assert.rejects(()=>value(db,'select public.get_job_management($1,$2) value',[T,J]),/access/)
 await db.exec('reset role;set role anon');await assert.rejects(()=>workspace(db),/permission/)
 }finally{await db.close()}
})
test('finishing a visit keeps the same job open and preserves visit history; future and changed visits cannot finish',async()=>{
 const db=await managementFixture();try{
 await db.exec(`reset role;update jobs set status='in_progress',scheduled_start=now()-interval '2 hours',scheduled_end=now()-interval '1 hour' where id='${J}';insert into appointments(id,business_id,job_id,customer_id,title,starts_at,ends_at,status) select '${M}',business_id,id,customer_id,title,scheduled_start,scheduled_end,'confirmed' from jobs where id='${J}';`);await user(db,U)
 await db.query('select public.finish_job_visit($1,$2,$3)',[B,J,M]);await db.query('select public.finish_job_visit($1,$2,$3)',[B,J,M]);let data=await workspace(db);assert.equal(data.visits[0].status,'completed')
 await db.exec('reset role');let job=(await db.query('select * from jobs where id=$1',[J])).rows[0];assert.equal(job.status,'in_progress');assert.equal(job.scheduled_start,null)
 await db.exec(`update jobs set scheduled_start=now()+interval '2 hours',scheduled_end=now()+interval '3 hours' where id='${J}';insert into appointments(id,business_id,job_id,customer_id,title,starts_at,ends_at,status) select '${T}',business_id,id,customer_id,title,scheduled_start,scheduled_end,'confirmed' from jobs where id='${J}';`);await user(db,U)
 await assert.rejects(()=>db.query('select public.finish_job_visit($1,$2,$3)',[B,J,T]),/future/)
 assert.equal((await workspace(db)).visits.length,2)
 }finally{await db.close()}
})
