import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const B='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444'
async function fixture(){
 const db=new PGlite()
 await db.exec('create role anon;create role authenticated;create role service_role;create schema private;')
 const sql=await readFile('supabase/migrations/20261110165000_shared_provider_burst_limits.sql','utf8')
 await db.exec(sql.split('-- Fail closed on schema drift')[0])
 return db
}
test('shared provider buckets enforce all-or-nothing account bursts and recover with time',async()=>{
 const db=await fixture()
 try{
  const call=(b=B,a=A)=>db.query("select private.reserve_provider_burst('receipt',$1,$2)",[b,a])
  for(let i=0;i<6;i++)await call()
  const before=(await db.query('select * from private.provider_burst_buckets order by scope')).rows
  await assert.rejects(call(),error=>{
   const e=error as any;assert.equal(e.code,'PGRST')
   const body=JSON.parse(e.message),detail=JSON.parse(e.detail)
   assert.equal(body.code,'FINVIANT_BURST_LIMIT');assert.equal(detail.status,429)
   assert.ok(Number(detail.headers['Retry-After'])>=1&&Number(detail.headers['Retry-After'])<=10)
   assert.equal(e.message.includes(A),false);return true
  })
  assert.deepEqual((await db.query('select * from private.provider_burst_buckets order by scope')).rows,before)
  await call(C,D) // An unrelated tenant retains its own allowance.
  await assert.rejects(call(C,A),{code:'PGRST'}) // Same actor cannot evade by changing business.
  await db.exec("update private.provider_burst_buckets set theoretical_at=theoretical_at-interval '60 seconds'")
  await call()
 }finally{await db.close()}
})
test('business and global ceilings cover many actors and actors cannot read or reset counters',async()=>{
 const db=await fixture()
 try{
  const id=(n:number)=>'55555555-5555-4555-8555-'+String(n).padStart(12,'0')
  for(let i=0;i<12;i++)await db.query("select private.reserve_provider_burst('receipt',$1,$2)",[B,id(i)])
  await assert.rejects(db.query("select private.reserve_provider_burst('receipt',$1,$2)",[B,id(13)]),{code:'PGRST'})
  for(let i=12;i<60;i++)await db.query("select private.reserve_provider_burst('receipt',$1,$2)",[id(100+i),id(i)])
  await assert.rejects(db.query("select private.reserve_provider_burst('receipt',$1,$2)",[C,D]),{code:'PGRST'})
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role)
   await assert.rejects(db.query("select private.reserve_provider_burst('upload',$1,$2)",[B,A]),{code:'42501'})
   await assert.rejects(db.exec('select * from private.provider_burst_buckets'),{code:'42501'})
   await db.exec('reset role')
  }
  await assert.rejects(db.query("select private.reserve_provider_burst('other',$1,$2)",[B,A]),{code:'22023'})
  await assert.rejects(db.query("select private.reserve_provider_burst('upload',null,$1)",[A]),{code:'42501'})
 }finally{await db.close()}
})
