import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture,ids,actor,estimate} from './fixture'
test('category filters paginate all matching rows, retain totals and enforce access',async()=>{
 const db=await fixture()
 try{
  await db.exec('reset role;')
  await db.exec(await readFile('supabase/migrations/20261106115546_attention_category_filters.sql','utf8'))
  await db.exec('set role authenticated;')
  for(let n=0;n<7;n++)await estimate(db)
  await db.query("insert into reminders(business_id,kind,due_at) values($1,'custom',now()-interval '1 hour')",[ids.business])
  const page=async(filter:string,n=1)=>(await db.query<any>('select get_dashboard_attention_page($1,$2,5,$3) r',[ids.business,n,filter])).rows[0].r
  const all=await page('attention');assert.equal(all.total,8)
  const first=await page('schedule'),second=await page('schedule',2)
  assert.equal(first.total,7);assert.equal(first.items.length,5);assert.equal(second.items.length,2)
  assert.ok([...first.items,...second.items].every(i=>i.kind==='approved'))
  assert.equal(new Set([...first.items,...second.items].map(i=>i.data.id)).size,7)
  assert.equal((await page('follow_up')).items[0].kind,'reminder')
  for(const filter of ['invoice','overdue'])assert.equal((await page(filter)).total,0)
  assert.deepEqual(first.category_counts,{schedule:7,invoice:0,overdue:0,follow_up:1})
  await actor(db,ids.outsider)
  for(const filter of ['schedule','invoice','overdue','follow_up'])await assert.rejects(()=>page(filter),/access/)
 }finally{await db.close()}
})
