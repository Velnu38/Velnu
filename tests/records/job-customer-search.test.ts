import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {executionFixture,ids,actor} from '../operations/execution-fixture.ts'
const search=async(db:any,q='',selected:string|null=null,b=ids.business)=>(await db.query('select public.search_job_customers($1,$2,$3) value',[b,q,selected])).rows[0].value
async function user(db:any,id=ids.owner){await db.exec('reset role');await actor(db,id);await db.exec('set role authenticated')}
test('job customer suggestions stay bounded beyond 50,000 records, normalize names/phone, and resolve only an authorized active selection',async()=>{
 const db=await executionFixture();try{
  await db.exec('reset role;revoke all on function private.require_record_module(uuid,text,boolean) from public,authenticated');await db.exec(await readFile('supabase/migrations/20261110195932_job_customer_search.sql','utf8'))
  await db.query("insert into customers(business_id,first_name,last_name) select $1,'Synthetic','Contact '||n from generate_series(1,50001)n",[ids.business])
  const special=(await db.query("insert into customers(business_id,first_name,last_name,company,email,phone,notes) values($1,'José','Muñoz','100% Repairs','jose@example.test','(757) 555-9876','Private internal note') returning id",[ids.business])).rows[0].id
  await db.query("insert into customers(business_id,first_name,archived) values($1,'Archived search sentinel',true)",[ids.business])
  const other=(await db.query("insert into customers(business_id,first_name) values($1,'Foreign sentinel') returning id",[ids.other])).rows[0].id
  await user(db);const all=await search(db);assert.equal(all.items.length,8);assert.equal(all.selected,null);assert.ok(JSON.stringify(all).length<4000)
  for(const term of ['jose munoz','Muñoz José','jose@example','100%','7575559876']){const result=await search(db,term);assert.equal(result.items.length,1,term);assert.equal(result.items[0].id,special);assert.equal('notes' in result.items[0],false)}
  assert.equal((await search(db,'does not match',special)).selected.id,special);assert.equal((await search(db,'does not match',special)).items.length,0)
  assert.equal((await search(db,'Archived search sentinel')).items.length,0);assert.equal((await search(db,'Foreign',other)).selected,null)
  await assert.rejects(()=>search(db,'x'.repeat(201)),(e:any)=>e.code==='22023');await user(db,ids.outsider);await assert.rejects(()=>search(db),(e:any)=>e.code==='42501')
  await user(db,ids.worker);assert.equal((await search(db,'100%')).items[0].id,special)
  await db.exec('reset role');await db.query("update business_members set access_modules='{}' where user_id=$1",[ids.worker]);await user(db,ids.worker);await assert.rejects(()=>search(db),(e:any)=>e.code==='42501')
  await db.exec('reset role;set role anon');await assert.rejects(()=>search(db),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
