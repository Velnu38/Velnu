import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
mkdirSync('.qa-build',{recursive:true});mkdirSync('qa-results',{recursive:true})
const modules={invoices:'services/invoices',estimates:'services/estimates',jobs:'services/jobs',customers:'services/customers',payments:'services/payments',validation:'lib/financialValidation',pages:'lib/businessRecords',finance:'lib/dashboardFinance',time:'lib/calendarTime',links:'lib/paymentLinks',access:'lib/workspaceAccess',crypto:'../server/calendar/crypto'}
const app={}
for(const [key,path] of Object.entries(modules)){
 const outfile=`.qa-build/volume-${key}.mjs`
 await build({entryPoints:[`src/${path}.ts`],outfile,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://qa.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'qa-isolated-only'})}})
 app[key]=await import(`../../${outfile}`)
}
const results=[]
async function group(name,n,fn){let pass=0,fail=0,errors=[];const start=performance.now();for(let i=0;i<n;i++){try{await fn(i);pass++}catch(e){fail++;if(errors.length<3)errors.push({input:i,error:e.message})}}results.push({name,inputs:n,pass,fail,elapsed_ms:Math.round(performance.now()-start),errors});console.log(name,pass,fail)}
let total=1100,mode='normal';const calls=[],workflowBatches=[]
globalThis.fetch=async(resource,init)=>{
 const req=new Request(resource,init),u=new URL(req.url);assert.equal(u.hostname,'qa.invalid');calls.push(u)
 const offset=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??500)
 if(u.pathname.includes('/rpc/')){const p=await req.json();if(u.pathname.endsWith('/get_job_workflow_context')){assert.equal(p.p_business,'workspace-test');assert.ok(Array.isArray(p.p_jobs)&&p.p_jobs.length>0&&p.p_jobs.length<=200);workflowBatches.push(p.p_jobs);return Response.json(p.p_jobs.map(job_id=>({job_id,active_appointment:null,invoice:null})))}assert.equal(p.target_business_id,'workspace-test');if(p.payload){assert.equal(p.payload.customer_id,'customer-test');return Response.json({id:'saved',...p.payload,total:100})}return Response.json({id:'saved',amount:p.payment_amount})}
 assert.equal(u.searchParams.get('business_id'),'eq.workspace-test')
 const rows=Array.from({length:Math.min(limit,total-offset)},(_,j)=>({id:String(offset+j).padStart(6,'0'),issue_date:'2026-01-01',scheduled_start:'2026-01-01',first_name:'QA',last_name:String(offset+j),customers:null,invoices:null}))
 const headers={'content-type':'application/json'};if(mode!=='missing-count')headers['content-range']=`${offset}-${offset+rows.length-1}/${total}`
 return new Response(JSON.stringify(rows),{headers})
}
for(const [key,name] of [['invoices','listInvoices'],['estimates','listEstimates'],['jobs','listJobs'],['customers','listCustomers'],['payments','listPayments'],['payments','listOpenInvoices']]){
 await group(name,100,async i=>{total=1001+i;mode='normal';calls.length=0;workflowBatches.length=0;const rows=await app[key][name]('workspace-test');assert.equal(rows.length,total);assert.equal(new Set(rows.map(r=>r.id)).size,total);assert.equal(calls.filter(u=>!u.pathname.includes('/rpc/')).length,3,'collection still uses exactly three pages');if(name==='listJobs'){assert.equal(workflowBatches.length,Math.ceil(total/200));assert.deepEqual(workflowBatches.flat(),rows.map(r=>r.id));assert.ok(rows.every(r=>r.active_appointment===null&&r.invoice===null))}else assert.equal(calls.length,3)})
 await group(name+'_missing_count',100,async()=>{mode='missing-count';await assert.rejects(()=>app[key][name]('workspace-test'),/complete record/)})
}
mode='normal'
for(const [key,name] of [['invoices','createInvoice'],['estimates','createEstimate']])await group(name+'_historical_payload',100,async i=>{let input={customer_id:'customer-test',issue_date:`2026-${String(1+i%10).padStart(2,'0')}-01`,due_date:'2026-12-01',expires_on:'2026-12-01',items:[{description:'QA',quantity:1,unit_price:100,tax_rate:0}]};const row=await app[key][name]('workspace-test',input);assert.equal(row.issue_date,input.issue_date)})
await group('line_calculation',100,i=>{const cents=2500+i,q=1+i%5,tax=i%2?0:530;const subtotal=cents*q,expected=subtotal+Math.floor((subtotal*tax+5000)/10000);assert.equal(app.validation.previewDocumentTotal([{quantity:q,unit_price:cents/100,tax_rate:tax/100}]),expected/100)})
await group('invalid_line_rejection',100,i=>assert.throws(()=>app.validation.validateDocumentInput({customer_id:'qa',items:[{description:'QA',quantity:1,unit_price:10,tax_rate:100.001+i}]})))
await group('date_order_rejection',100,i=>assert.throws(()=>app.validation.validateDocumentInput({customer_id:'qa',issue_date:'2026-02-01',due_date:'2026-01-01',items:[{description:'QA '+i,quantity:1,unit_price:10}]}),/precede/))
await group('financial_reconciliation',100,i=>{const rows=Array.from({length:100+i},(_,j)=>({id:String(j),entry_date:'2026-01-01',currency:'USD',amount:(j+1)/100,direction:j%2?'expense':'income'}));const t=app.finance.financialTotals(rows);assert.equal(Math.round(t.net*100),rows.reduce((s,r)=>s+(r.direction==='income'?1:-1)*Math.round(r.amount*100),0));const buckets=app.finance.financialBuckets(rows,12,'2026-11-02','America/New_York');assert.equal(Math.round(buckets.reduce((s,b)=>s+b.income,0)*100),Math.round(t.income*100))})
await group('calendar_dst_days',100,i=>{const day=i%2?'2026-11-01':'2026-03-08';const b=app.time.dayBounds(day,'America/New_York');assert.equal((Date.parse(b.to)-Date.parse(b.from))/3600000,i%2?25:23)})
await group('calendar_ambiguous_time',100,i=>assert.throws(()=>app.time.localInstant(i%2?'2026-11-01T01:30':'2026-03-08T02:30','America/New_York')))
await group('payment_destination_allowlist',100,i=>{assert(app.links.validPaymentLink({provider:'stripe',url:`https://buy.stripe.com/qa${i}`}));assert(!app.links.validPaymentLink({provider:'stripe',url:`https://buy.stripe.com.evil.invalid/qa${i}`}));assert(!app.links.validPaymentLink({provider:'paypal',url:`javascript:alert(${i})`}))})
await group('team_module_access',100,i=>{assert(!app.access.canAccess({role:'technician',primary_owner:false,access_modules:['billing','finances']},'billing'));assert(app.access.canAccess({role:'owner',primary_owner:true,access_modules:[]},'finances'));assert.equal(app.access.canAccess({role:'office',primary_owner:false,access_modules:i%2?['jobs']:[]},'jobs'),!!(i%2))})
process.env.CALENDAR_TOKEN_KEYS=JSON.stringify({v1:Buffer.alloc(32,9).toString('base64')})
await group('oauth_encryption_tamper',100,i=>{const value={refresh_token:'synthetic-'+i},encrypted=app.crypto.encrypt(value,'integration-'+i);assert.deepEqual(app.crypto.decrypt(encrypted,'integration-'+i),value);assert.throws(()=>app.crypto.decrypt(encrypted,'wrong-'+i))})
await group('record_pagination_mutation',100,async i=>{let call=0;await assert.rejects(()=>app.pages.collectBusinessRecords(async()=>({data:[{id:'repeat-'+i}],error:null,count:++call===1?2:3})),/changed/)})
writeFileSync('qa-results/volume-services.json',JSON.stringify({mode:'Actual service modules with simulated HTTP transport; pure-code checks. No live provider claims.',results,total:results.reduce((s,r)=>s+r.inputs,0),passed:results.reduce((s,r)=>s+r.pass,0),failed:results.reduce((s,r)=>s+r.fail,0)},null,2))
if(results.some(r=>r.fail))process.exitCode=1
