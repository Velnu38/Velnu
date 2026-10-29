/** Eight-hour infrastructure campaign. Never requires service-role credentials.
 * Modes are explicitly logged: live staging reads / live unauthenticated guards /
 * actual application services with a simulated database transport. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { FUNCTIONS, TENANT } from './generate-profiles.mjs'
const target = JSON.parse(readFileSync(new URL('./target.json',import.meta.url)))
assert.equal(target.projectRef,'xvybcmyoblfgzokaifsx','Runner is staging-only')
assert.equal(new URL(target.url).hostname,target.projectRef+'.supabase.co')
assert.notEqual(target.projectRef,target.productionProjectRef)
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')))
const seconds=Number(args.seconds??14400), phase=Number(args.phase??1), interval=Number(args.interval??300)
assert.ok(Number.isFinite(seconds)&&seconds>=0&&seconds<=18000)
assert.ok(Number.isFinite(interval)&&interval>=1)
const file='STRESS_TEST_LOGS.json', network=globalThis.fetch.bind(globalThis)
const started=performance.now()
const log=existsSync(file)&&args.resume==='true'?JSON.parse(readFileSync(file)): {
 schema_version:1,campaign:'Finviant staging QA',target:target.projectRef,requested_active_seconds:28800,
 started_at:new Date().toISOString(),status:'running',active_seconds:0,phases:[],cycles:[],errors:[],
 modes:{dataset:'live Supabase REST read',services:'real app modules; isolated simulated database transport',edges:'live staging unauthenticated guard probes',browser:'reported separately by GitHub Actions'},
 limits:{endpoint_requests_per_second:2,endpoint_concurrency:1,cycle_interval_seconds:interval,production_writes:0,customer_sends:0},
 totals:{profiles_checked:0,passed:0,failed:0,expected_rejections:0,live_requests:0,edge_probes:0},per_function:{}
}
const previousActive=log.active_seconds
function flush(){log.updated_at=new Date().toISOString();writeFileSync(file+'.tmp',JSON.stringify(log,null,2)+'\n');renameSync(file+'.tmp',file)}
function failure(scope,error,extra={}){log.errors.push({time:new Date().toISOString(),phase,scope,category:error?.name==='TimeoutError'?'timeout':error?.name==='AssertionError'?'assertion':error?.name==='TypeError'?'runtime':'exception',message:String(error?.message??error),stack:error?.stack,...extra});log.totals.failed++;flush()}
process.on('uncaughtException',e=>{failure('uncaughtException',e);log.status='failed';flush();process.exit(1)})
process.on('unhandledRejection',e=>{failure('unhandledRejection',e);log.status='failed';flush();process.exit(1)})
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{log.status='interrupted';log.active_seconds=previousActive+(performance.now()-started)/1000;flush();process.exit(130)})
async function request(path,options={}){
 log.totals.live_requests++
 const response=await network(target.url+path,{...options,headers:{apikey:target.publishableKey,...options.headers},signal:AbortSignal.timeout(12000)})
 return response
}
async function profiles(){
 const all=[]
 for(let offset=0;offset<1000;offset+=100){
  const response=await request('/rest/v1/finviant_qa_profiles?dataset_id=eq.'+target.dataset+'&select=dataset_id,scenario_id,function_name,batch,profile&order=scenario_id.asc&offset='+offset+'&limit=100')
  assert.equal(response.status,200,'Live fixture read failed: '+response.status)
  const page=await response.json();assert.ok(Array.isArray(page));assert.equal(page.length,100,'Incomplete fixture page');all.push(...page)
 }
 assert.equal(new Set(all.map(x=>x.scenario_id)).size,1000)
 assert.ok(all.every(x=>x.dataset_id===target.dataset&&x.profile.synthetic===true))
 for(const fn of FUNCTIONS)assert.equal(all.filter(x=>x.function_name===fn).length,100,fn+' must have exactly 100 profiles')
 log.dataset={count:all.length,sha256:createHash('sha256').update(JSON.stringify(all)).digest('hex'),functions:Object.fromEntries(FUNCTIONS.map(fn=>[fn,100]))}
 return all
}
mkdirSync('.qa-build',{recursive:true})
await build({entryPoints:['scripts/qa/entry.ts'],outfile:'.qa-build/campaign.mjs',bundle:true,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://qa.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'qa-isolated-only'})}})
const app=await import('../../.qa-build/campaign.mjs')
function roundDiv(n,d){return (n+d/2n)/d}
function golden(items){let sub=0n,tax=0n;for(const item of items){const q=BigInt(Math.round(item.quantity*100)),p=BigInt(Math.round(item.unit_price*100)),t=BigInt(Math.round((item.tax_rate??0)*100));const line=roundDiv(q*p,100n);sub+=line;tax+=roundDiv(line*t,10000n)}return {subtotal:Number(sub)/100,tax_amount:Number(tax)/100,total:Number(sub+tax)/100}}
async function scenario(row){
 const test=row.profile.test, fn=row.function_name, input=test.input, calls=[]
 const original=globalThis.fetch
 const reply=(data,count=0,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','content-range':'0-'+Math.max(0,count-1)+'/'+count}})
 globalThis.fetch=async(resource,init)=>{
  const req=new Request(resource,init),url=new URL(req.url)
  assert.equal(url.hostname,'qa.invalid','Service attempted external access')
  const table=url.pathname.split('/').at(-1);calls.push({table,method:req.method})
  if(input?.fault==='timeout')return reply({message:'Simulated database unavailable',code:'QA503'},0,503)
  if(url.pathname.includes('/rpc/')){
   const payload=await req.json();assert.equal(payload.target_business_id,TENANT,'Tenant missing from RPC')
   if(table==='get_dashboard_invoice_totals'){
    if(input.fault==='missing-total')return reply(null)
    return reply({open_invoices:input.count,outstanding_balance:input.fault==='bad-amount'?'invalid':input.fault==='null-amount'?null:input.balance})
   }
   if(table==='record_manual_payment'){assert.equal(payload.payment_amount,input.amount);assert.equal(payload.invoice_id,input.invoice_id);return reply({id:'qa-payment',amount:payload.payment_amount,status:'succeeded'})}
   assert.ok(['create_document','create_change_order_document'].includes(table))
   assert.equal(payload.payload.customer_id,input.customer_id)
   assert.deepEqual(payload.payload.items,input.items.map(x=>({...x,description:x.description.trim(),tax_rate:x.tax_rate??0})))
   return reply({id:'qa-document',status:'draft',...golden(input.items),amount_paid:0,balance_due:golden(input.items).total})
  }
  if(req.method==='POST'){assert.equal(table,'bookkeeping_entries');const body=await req.json();assert.equal(body.business_id,TENANT);assert.equal(body.amount,input.amount);return reply(null)}
  assert.equal(url.searchParams.get('business_id'),'eq.'+TENANT,'Tenant filter missing')
  if(fn==='getDashboardSnapshot')return req.method==='HEAD'?new Response(null,{headers:{'content-range':'*/0'}}):reply([])
  assert.ok(['payments','bookkeeping_entries','quickbooks_transactions'].includes(table))
  const size=table==='payments'?0:input.size,offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000)
  const amount=input.fault==='bad-amount'?'invalid':input.fault==='null-amount'?null:input.amount
  const rows=Array.from({length:Math.max(0,Math.min(limit,size-offset))},(_,i)=>({id:'qa-'+(offset+i),entry_date:'2028-02-29',txn_date:'2028-02-29',paid_at:'2028-02-29T12:00:00Z',direction:'expense',amount,description:row.profile.owner.name,category:'QA',currency:'USD',source_type:'Purchase'}))
  const response=reply(rows,size);if(input.fault==='missing-count')response.headers.delete('content-range');return response
 }
 try{
  let result,error
  try{
   if(fn==='parseQuickInvoice')result=app[fn](input)
   else if(fn==='assistantMonthlyTotal')result=app[fn](input.tier,input.choices)
   else if(fn==='addManualEntry')result=await app[fn](input)
   else if(['listVelnuWorkbook','listQuickBooksWorkbook','getDashboardSnapshot'].includes(fn))result=await app[fn](TENANT)
   else result=await app[fn](TENANT,input)
  }catch(e){error=e}
  if(test.expect==='reject'){
   assert.ok(error,'Invalid input was accepted')
   assert.notEqual(error.name,'TypeError','Malformed input caused unhandled type operation')
   if(!['listVelnuWorkbook','listQuickBooksWorkbook','getDashboardSnapshot'].includes(fn))assert.equal(calls.length,0,'Invalid input reached the transport')
   log.totals.expected_rejections++;return
  }
  if(error)throw error
  if(fn==='parseQuickInvoice')assert.equal(result.amount,test.expect==='empty'?'':test.amount)
  else if(fn==='assistantMonthlyTotal'){
   const unique=new Set(input.choices);const prices=input.tier==='basic'?[9.99,14.99]:input.tier==='pro'?[7.99,11.99]:[0,0]
   assert.ok(Math.abs(result-((unique.has('scheduling_assistant')?prices[0]:0)+(unique.has('bookkeeping_assistant')?prices[1]:0)))<1e-9)
  } else if(fn.startsWith('create')){assert.equal(result.total,golden(input.items).total);assert.equal(calls.length,1)}
  else if(fn==='recordPayment'){assert.equal(result.amount,input.amount);assert.equal(calls.length,1)}
  else if(fn==='addManualEntry')assert.equal(calls.length,1)
  else if(fn.includes('Workbook')){assert.equal(result.length,input.size);assert.ok(result.every(x=>x.amount===input.amount));assert.equal(new Set(result.map(x=>x.id)).size,input.size)}
  else if(fn==='getDashboardSnapshot'){assert.equal(result.outstandingBalance,input.balance);assert.equal(result.openInvoices,input.count);assert.equal(calls.length,7)}
 }finally{globalThis.fetch=original}
}
const endpoints=['ai-command','execute-ai-action','create-approval-link','customer-approval','email-recovery-worker','reliability-health','send-document-email','send-invoice-email','transcribe-voice','resend-events','stripe-events','quickbooks']
async function guards(rows,count){
 for(const endpoint of endpoints){
  for(let i=0;i<count;i++){
   const row=rows[i%rows.length]
   try{
    // No valid session, approval token, provider signature, or operator credential.
    const r=await request('/functions/v1/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({business_id:'00000000-0000-0000-0000-000000000000',action:'status',scenario_id:row.scenario_id,profile:row.profile,token:'invalid-qa-token'})})
    log.totals.edge_probes++
    const text=await r.text()
    assert.ok([400,401,403,404,405,413,503].includes(r.status),'Unexpected unauthenticated status '+r.status)
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|sk-proj-|sb_secret_|BEGIN PRIVATE KEY/.test(text),'Secret material in error response')
    log.edge_coverage??={};const entry=log.edge_coverage[endpoint]??={attempts:0,statuses:{}};entry.attempts++;entry.statuses[r.status]=(entry.statuses[r.status]??0)+1
   }catch(e){failure('live-edge',e,{endpoint,scenario_id:row.scenario_id})}
   await delay(500)
  }
  flush()
 }
}
try{
 let rows=await profiles()
 await guards(rows,Number(args['edge-count']??(phase===1?100:1)))
 let cycle=0
 do{
  const cycleStart=performance.now(),entry={phase,cycle:++cycle,started_at:new Date().toISOString(),passed:0,failed:0}
  if(cycle>1)rows=await profiles()
  for(const row of rows){
   const counts=log.per_function[row.function_name]??={attempts:0,passed:0,failed:0};counts.attempts++;log.totals.profiles_checked++
   try{await scenario(row);counts.passed++;entry.passed++;log.totals.passed++}catch(e){counts.failed++;entry.failed++;failure('application-service',e,{scenario_id:row.scenario_id,function:row.function_name})}
  }
  entry.elapsed_ms=Math.round(performance.now()-cycleStart);log.cycles.push(entry);log.active_seconds=previousActive+(performance.now()-started)/1000;flush()
  console.log(JSON.stringify({phase,cycle,passed:entry.passed,failed:entry.failed,active_seconds:Math.round(log.active_seconds)}))
  const remaining=seconds*1000-(performance.now()-started)
  if(remaining<=0)break
  await delay(Math.min(remaining,Math.max(1,interval*1000-(performance.now()-cycleStart))))
 }while(performance.now()-started<seconds*1000)
 log.active_seconds=previousActive+(performance.now()-started)/1000
 log.phases.push({phase,started_at:new Date(Date.now()-(performance.now()-started)).toISOString(),completed_at:new Date().toISOString(),active_seconds:(performance.now()-started)/1000})
 log.status=log.totals.failed?'completed_with_failures':log.active_seconds>=28800?'completed':'phase_completed'
 flush();if(log.totals.failed)process.exitCode=1
}catch(e){failure('campaign-setup-or-dataset',e);log.status='failed';log.active_seconds=previousActive+(performance.now()-started)/1000;flush();process.exitCode=1}
