import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
await build({entryPoints:['src/services/customerDetail.ts'],outfile:'.qa-build/customerHistory.mjs',bundle:true,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://qa.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'qa-only'})}})
const {getCustomerDetail}=await import('../../.qa-build/customerHistory.mjs')
const B='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222'
async function fixture(options,run){
 const original=globalThis.fetch,calls=[]
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url),table=url.pathname.split('/').at(-1);calls.push(table)
  assert.equal(url.hostname,'qa.invalid');assert.equal(url.searchParams.get('business_id'),'eq.'+B)
  const reply=(data,count=0)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json','content-range':`0-0/${count}`}})
  if(table==='customers'){assert.equal(url.searchParams.get('id'),'eq.'+C);return reply({id:C})}
  assert.equal(url.searchParams.get('customer_id'),'eq.'+C)
  if(table==='properties')return reply([])
  assert.match(req.headers.get('prefer'),/count=exact/)
  assert.equal(url.searchParams.get('order'),'id.asc');assert.equal(url.searchParams.get('limit'),'500')
  const offset=Number(url.searchParams.get('offset')||0),total=table==='invoices'?537:table==='estimates'?503:26
  if(options.fail===table)return new Response(JSON.stringify({message:'History unavailable'}),{status:503,headers:{'content-type':'application/json'}})
  if(table!=='jobs'){assert.match(url.searchParams.get('select'),/created_at/);assert.match(url.searchParams.get('select'),/updated_at/)}
  return reply(Array.from({length:Math.min(500,total-offset)},(_,n)=>({id:`${table}-${String(n+offset).padStart(4,'0')}`,created_at:new Date(Date.UTC(2026,0,1,0,n+offset)).toISOString(),customer_id:C})),total)
 }
 try{await run(calls)}finally{globalThis.fetch=original}
}
test('customer history reaches beyond 20 and 500 records with stable tenant/customer filters and creation timestamps',()=>fixture({},async calls=>{
 const detail=await getCustomerDetail(B,C)
 assert.equal(detail.invoices.length,537);assert.equal(detail.estimates.length,503);assert.equal(detail.jobs.length,26)
 assert.equal(detail.invoices[0].id,'invoices-0536');assert.equal(detail.invoices.at(-1).id,'invoices-0000')
 assert.equal(calls.filter(t=>t==='invoices').length,2);assert.equal(calls.filter(t=>t==='estimates').length,2)
}))
test('restricted customer history does not request billing or job records',()=>fixture({},async calls=>{
 const detail=await getCustomerDetail(B,C,{billing:false,jobs:false});assert.deepEqual(detail.invoices,[]);assert.deepEqual(detail.estimates,[]);assert.deepEqual(detail.jobs,[])
 assert.deepEqual(calls.sort(),['customers','properties'])
}))
test('failed customer history is an error rather than an incomplete record list',()=>fixture({fail:'invoices'},async()=>{
 await assert.rejects(getCustomerDetail(B,C),error=>error.message==='History unavailable')
}))
