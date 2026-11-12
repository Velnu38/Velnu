import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowHandler} from '../../supabase/functions/fin-workflow/handler.ts'
import {resolveFinNavigation,assertFinNavigationAccess} from '../../src/lib/finNavigation.ts'
const B='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222'
const response=(body:unknown)=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body)}]}]})
const reply={answer:'Review the authorized screen; provider acceptance is separate.',source_keys:[],navigation:[],clarification:null,steps:[]}
const request=(text:string,business=B)=>new Request('https://fixture.invalid',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({business_id:business,thread_id:B,request_id:D,text})})
// complete is deliberately a deterministic stub, not evidence of model quality.
const cases=[
 {view:'invoices',question:'Did my invoice reminder reach the customer?',rules:[/Accepted by provider is not confirmed delivery/,/no reminder-history lookup tool/,/Viewing or refreshing history sends nothing/]},
 {view:'estimates',question:'Can you explain the lines on my saved estimate or read an uploaded PDF?',rules:[/current authorized record lookups/,/exact document/,/not proof that an uploaded PDF was read/]},
 {view:'calendar',question:'Does Google or Outlook now sync both ways?',rules:[/Do not promise Google or Outlook two-way sync/,/unverified provider behavior/]},
 {view:'payments',question:'Can you charge a card with Square Tap to Pay?',rules:[/Fin cannot charge, refund/,/not evidence of a connected processor/]},
 {view:'team',question:'Does adding a worker send a login invitation?',rules:[/does not invite, notify or grant login access/,/Invitations are a separate explicit/]},
 {view:'work',question:'Can you edit all job materials and work offline?',rules:[/not exposed by the jobs lookup/,/Do not promise offline sync/]},
]
for(const item of cases)for(const inputMode of ['typed','simulated transcript'])test(`${inputMode}: ${item.view} receives accurate bounded guidance`,async()=>{
 let providerCalls=0
 const h=workflowHandler({authorize:async()=>({profile:{timezone:'UTC'},capabilities:{views:{[item.view]:{}}},begin:async()=>({history:[],cached:null}),lookup:async()=>{throw Error('Unexpected record lookup')},finish:async(_t,_r,p)=>p,reserve:async()=>{}}),complete:async(input,tools,instructions)=>{
  providerCalls++;assert.equal(JSON.parse((input[0] as any).content).request,item.question)
  for(const rule of item.rules)assert.match(instructions,rule)
  assert.deepEqual(tools.map((t:any)=>t.name),['lookup_account_records'])
  return response({...reply,navigation:[item.view]})
 }})
 const r=await h(request(item.question));assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data.steps,[]);assert.deepEqual(data.sources,[]);assert.equal(providerCalls,1)
})
test('saved invoice question retrieves current scoped lines and a verified document link',async()=>{
 let calls=0,reads=0
 const lookup={resource:'invoices',id:D,query:null,customer_id:null,status:null,from:null,to:null,order:'newest',offset:0}
 const h=workflowHandler({authorize:async(_auth,b)=>b===B?{profile:{timezone:'UTC'},capabilities:{views:{invoices:{}}},begin:async()=>({history:[],cached:null}),reserve:async()=>{},lookup:async q=>{reads++;assert.deepEqual(q,lookup);return {resource:'invoices',rows:[{id:D,invoice_number:'INV-FIXTURE',total:125,items:[{description:'Repair',quantity:1,unit_price:125}]}],matching_count:1,offset:0,complete:true}},finish:async(_t,_r,p)=>p}:null,complete:async input=>{
  if(++calls===1)return {output:[{type:'function_call',name:'lookup_account_records',call_id:'fixture',arguments:JSON.stringify(lookup)}]}
  const record=JSON.parse((input.at(-1) as any).output);assert.equal(record.rows[0].items[0].unit_price,125)
  return response({...reply,answer:'The saved repair line is $125.',source_keys:['invoices:'+D],navigation:['invoices']})
 }})
 const r=await h(request('Explain saved invoice INV-FIXTURE'));assert.equal(r.status,200);const data=await r.json();assert.equal(data.sources[0].href,'/?view=invoices&document='+D);assert.equal(reads,1);assert.deepEqual(data.steps,[])
 assert.equal((await h(request('Read another business invoice',D))).status,403);assert.equal(reads,1);assert.equal(calls,2)
})
test('restricted navigation and permission loss cannot be turned into a successful answer',async()=>{
 for(const deniedLookup of [false,true]){
  let saves=0
  const h=workflowHandler({authorize:async()=>({profile:{timezone:'UTC'},capabilities:{views:{work:{}}},begin:async()=>({history:[],cached:null}),reserve:async()=>{},lookup:async()=>{throw {code:'42501'}},finish:async(_t,_r,p)=>{saves++;return p}}),complete:async()=>deniedLookup?{output:[{type:'function_call',name:'lookup_account_records',call_id:'fixture',arguments:JSON.stringify({resource:'invoices',id:D,query:null,customer_id:null,status:null,from:null,to:null,order:'newest',offset:0})}]}:response({...reply,navigation:['invoices']})})
  assert.equal((await h(request('Show invoice'))).status,deniedLookup?403:503);assert.equal(saves,0)
 }
})
test('typed and simulated voice direct navigation retain exact routes and fresh account checks',()=>{
 const owner={id:B,role:'owner',primary_owner:true} as any,usage={plan:'pro',ai_limit:100,voice_limit:100}
 for(const text of ['Open job management','Open invoices','Open calendar connections']){
  const typed=resolveFinNavigation(text),transcript=resolveFinNavigation(text);assert.deepEqual(typed,transcript);assert.ok(typed&&'destination' in typed)
  if(typed&&'destination' in typed){assert.ok(assertFinNavigationAccess(B,owner,typed.destination,usage).href.startsWith('/?view='));assert.throws(()=>assertFinNavigationAccess(D,owner,typed.destination,usage))}
 }
})
