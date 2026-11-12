// Actual service code; synthetic in-memory HTTP only. No sockets or credentials.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {performance} from 'node:perf_hooks'
await mkdir('.qa-build',{recursive:true})
const modules={jobs:'jobs',invoices:'invoices',estimates:'estimates',history:'customerDetail',reminders:'invoiceReminderHistory'}
const app={}
for(const [key,file] of Object.entries(modules)){
 const outfile=`.qa-build/profile-${key}.mjs`
 await build({entryPoints:[`src/services/${file}.ts`],outfile,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://profile.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-only'})}})
 app[key]=await import(`../../${outfile}`)
}
const B='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222'
let size=0,calls=[],bytes=0,restricted=false
const original=globalThis.fetch
const row=(i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,business_id:B,customer_id:C,created_at:'2026-11-01T00:00:00Z',issue_date:'2026-11-01',scheduled_start:null,customers:[],properties:[]})
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),u=new URL(req.url),table=u.pathname.split('/').at(-1)
 assert.equal(u.origin,'https://profile.invalid','External network forbidden')
 const reply=(value,total)=>{const body=JSON.stringify(value);bytes+=Buffer.byteLength(body);return new Response(body,{headers:{'content-type':'application/json',...(total===undefined?{}:{'content-range':`0-0/${total}`})}})}
 calls.push(table)
 if(u.pathname.includes('/rpc/')){
  const p=await req.json();assert.equal(p.p_business,B)
  if(table==='get_job_directory_page')return reply({items:Array.from({length:Math.min(size,25)},(_,i)=>row(i)),total:size,page:0,page_size:25,counts:{all:size}})
  if(table==='get_invoice_reminder_history'){assert.equal(p.p_invoice,C);assert.equal(p.p_limit,20);return reply({invoice_id:C,items:Array.from({length:Math.min(size,20)},(_,i)=>({id:row(i).id,created_at:row(i).created_at,channel:'email',recipient:null,source:'automatic',initiator:'System',status:'queued',attempts:0,detail:null,events:[]})),has_more:size>20,last_attempt:null,last_success:null})}
  assert.equal(table,'get_job_workflow_context');assert.ok(p.p_jobs.length<=200)
  return reply(p.p_jobs.map(job_id=>({job_id,active_appointment:null,invoice:null})))
 }
 assert.equal(req.method,'GET');assert.equal(u.searchParams.get('business_id'),'eq.'+B)
 if(table==='customers'){assert.equal(u.searchParams.get('id'),'eq.'+C);return reply({id:C})}
 if(table==='properties'){assert.equal(u.searchParams.get('customer_id'),'eq.'+C);return reply([])}
 assert.equal(restricted,false,'Restricted history must not query jobs or billing')
 assert.equal(u.searchParams.get('customer_id'),'eq.'+C)
 assert.match(req.headers.get('prefer'),/count=exact/)
 assert.equal(u.searchParams.get('order'),'id.asc');assert.equal(u.searchParams.get('limit'),'500')
 const offset=Number(u.searchParams.get('offset')||0)
 return reply(Array.from({length:Math.max(0,Math.min(500,size-offset))},(_,i)=>row(offset+i)),size)
}
const results=[]
try{
 for(size of [25,500,5000]){
  const scenarios={
   jobs:async()=>assert.equal((await app.jobs.listJobs(B,C)).length,size),
   invoices:async()=>assert.equal((await app.invoices.listInvoices(B,C)).length,size),
   estimates:async()=>assert.equal((await app.estimates.listEstimates(B,C)).length,size),
   customer_history:async()=>{const r=await app.history.getCustomerDetail(B,C);for(const k of ['jobs','invoices','estimates'])assert.equal(r[k].length,size)},
   job_directory:async()=>assert.equal((await app.jobs.getJobDirectoryPage(B,{filter:'all',search:'',page:0,customerId:C})).items.length,Math.min(size,25)),
   reminder_history:async()=>assert.equal((await app.reminders.getInvoiceReminderHistory(B,C)).items.length,Math.min(size,20)),
  }
  for(const [name,run] of Object.entries(scenarios)){
   await run() // warm imports; measurement is local JS/serialization, not DB latency
   const times=[];let requests,responseBytes
   for(let n=0;n<5;n++){calls=[];bytes=0;const start=performance.now();await run();times.push(performance.now()-start);requests=calls.length;responseBytes=bytes}
   times.sort((a,b)=>a-b)
   results.push({name,rowsPerCollection:size,requests,responseBytes,localMedianMs:+times[2].toFixed(2),localMaxMs:+times[4].toFixed(2),samples:5})
  }
 }
 restricted=true;calls=[];await app.history.getCustomerDetail(B,C,{billing:false,jobs:false});assert.deepEqual(calls.sort(),['customers','properties'])
 const report={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Actual service modules, controlled synthetic HTTP responses; request shape/payload and local JS timings only. No SQL execution, real RLS, hosted capacity, network latency or provider evidence.',externalRequests:0,tenantAndCustomerFiltersChecked:true,restrictedHistoryChecked:true,results}
 await mkdir('tmp/query-profile',{recursive:true});await writeFile('tmp/query-profile/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{globalThis.fetch=original}
