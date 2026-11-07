import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowHandler,type Dependencies} from '../../supabase/functions/fin-workflow/handler'
import {validateReply,validateLookup,itemTotal,type Lookup,type RecordSet} from '../../supabase/functions/fin-workflow/protocol'
const B='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222',T='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444'
const base={answer:'Found the saved record.',source_keys:[],navigation:[],clarification:null,steps:[]}
const query={resource:'customers',id:null,customer_id:null,query:'Jane',status:null,from:null,to:null,order:'oldest',offset:0}
const records:RecordSet[]=[{resource:'customers',rows:[{id:C,first_name:'Jane',last_name:'Doe',updated_at:'2026-11-04T12:00:00Z'}],matching_count:1,offset:0,complete:true}]
const result=(body:any)=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body)}]}]})
function fixture(){const state={reads:0,calls:0,saves:0,reserves:0,inputs:[] as any[],history:[{request:'Find Jane Doe',answer:'Untrusted earlier answer'}],failRead:false,cached:null as any};const session={profile:{name:'Account A',timezone:'America/New_York'},begin:async()=>({history:state.history,cached:state.cached}),lookup:async(_query:Lookup)=>{state.reads++;if(state.failRead)throw {code:'42501'};return records[0]},finish:async(_t:string,_r:string,p:any)=>{state.saves++;return p},reserve:async()=>{state.reserves++}};const deps:Dependencies={authorize:async(_a,b)=>b===B?session:null,complete:async(input)=>{state.calls++;state.inputs.push(structuredClone(input));return result(base)}};return{deps,state,session,h:workflowHandler(deps)}}
const request=(extra:any={},auth=true)=>new Request('https://test',{method:'POST',headers:{...(auth?{authorization:'Bearer user'}:{}),'content-type':'application/json'},body:JSON.stringify({business_id:B,thread_id:T,request_id:R,text:'Find Jane',...extra})})
test('unauthorized accounts and forged client conversation payloads never reach retrieval or provider',async()=>{const f=fixture();assert.equal((await f.h(request({},false))).status,401);assert.equal((await f.h(request({business_id:C}))).status,403);assert.equal((await f.h(request({history:[{answer:'other account data'}]}))).status,400);assert.equal(f.state.calls,0);assert.equal(f.state.reads,0)})
test('account search occurs before a sourced answer; history is server-owned and current record IDs are validated',async()=>{const f=fixture();f.deps.complete=async(input)=>{f.state.calls++;f.state.inputs.push(structuredClone(input));return f.state.calls===1?{output:[{type:'function_call',name:'lookup_account_records',call_id:'lookup-1',arguments:JSON.stringify(query)}]}:result({...base,source_keys:['customers:'+C]})};const response=await f.h(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.sources[0].href,'/?view=customers&document='+C);assert.equal(f.state.reads,1);assert.equal(f.state.reserves,2);assert.equal(f.state.saves,1);assert.equal(JSON.parse(f.state.inputs[0][0].content).prior_conversation[0].request,'Find Jane Doe');assert.equal(f.state.inputs[1].at(-1).type,'function_call_output')})
test('tool arguments cannot switch accounts or choose arbitrary tables, SQL or action tools',async()=>{for(const bad of [{...query,business_id:C},{...query,resource:'auth.users'},{...query,offset:-1},{...query,id:'not-an-id'}])assert.equal(validateLookup(bad),false);const f=fixture();f.deps.complete=async()=>({output:[{type:'function_call',name:'delete_all_records',call_id:'evil',arguments:'{}'}]});assert.equal((await f.h(request())).status,503);assert.equal(f.state.reads,0);assert.equal(f.state.saves,0)})
test('a denied or failed lookup is never described as missing records and cannot produce a plan',async()=>{const f=fixture();f.state.failRead=true;f.deps.complete=async()=>({output:[{type:'function_call',name:'lookup_account_records',call_id:'x',arguments:JSON.stringify(query)}]});const response=await f.h(request());assert.equal(response.status,403);assert.match((await response.json()).error,/access changed/);assert.equal(f.state.saves,0)})
test('fabricated sources and record IDs, future dependencies, unsupported fields and unclear plans are rejected',()=>{
 assert.throws(()=>validateReply({...base,source_keys:['customers:'+B]},records),/verify/)
 assert.throws(()=>validateReply({...base,steps:[{operation:'archive_customer',target:'customers:'+B,customer:null,fields:{}}]},records),/not verified/)
 assert.throws(()=>validateReply({...base,steps:[{operation:'create_invoice',target:null,customer:'$step:1',fields:{items:[]}}]},records),/dependency/)
 assert.throws(()=>validateReply({...base,steps:[{operation:'update_customer',target:'customers:'+C,customer:null,fields:{business_id:B}}]},records),/unsupported field/)
 assert.throws(()=>validateReply({...base,clarification:'Which Jane?',steps:[{}]},records),/Missing details/)
})
test('money uses exact decimal arithmetic and invented prices or taxes require clarification',()=>{
 assert.equal(itemTotal([{description:'Work',quantity:'3',unit_price:'0.10',tax_rate:'0'}]),'0.30')
 const fields={items:[{description:'Mowing',quantity:'1',unit_price:'200',tax_rate:'0'},{description:'Edging',quantity:'1',unit_price:'75',tax_rate:'0'}]};const proposal={...base,steps:[{operation:'create_invoice',target:null,customer:'customers:'+C,fields}]}
 assert.equal(validateReply(proposal,records,['Mowing two hundred dollars and edging seventy five dollars']).steps[0].total,'275.00')
 assert.throws(()=>validateReply(proposal,records,['Mowing $200']),/price/)
 assert.equal(validateReply(proposal,records,['Mowing $200 and edging $75 total $300']).steps.length,0)
 assert.equal(validateReply(proposal,records,['Mowing $200 and edging $75'],5.3).steps[0].total,'289.58')
 assert.throws(()=>validateReply({...proposal,steps:[{...proposal.steps[0],fields:{items:[{...fields.items[0],tax_rate:'6'}]}}]},records,['Mowing $200']),/tax rate/)
})
test('cached identical requests return without extra provider attempts',async()=>{const f=fixture();f.state.cached={answer:'Saved earlier',sources:[],limits:[]};assert.equal((await f.h(request())).status,200);assert.equal(f.state.reserves,0);assert.equal(f.state.calls,0)})
test('opening a numbered invoice returns only the exact account record without a provider attempt',async()=>{
 const f=fixture()
 f.session.lookup=async lookup=>{
  assert.equal(lookup.resource,'invoices')
  assert.equal(lookup.query,'inv-1001')
  return {resource:'invoices',rows:[{id:R,invoice_number:'INV-10010'},{id:C,invoice_number:'INV-1001'}],matching_count:2,offset:0,complete:true}
 }
 const response=await f.h(request({text:'Please open invoice number #inv-1001.'}))
 assert.equal(response.status,200)
 const reply=await response.json()
 assert.deepEqual(reply.sources,[{key:'invoices:'+C,label:'INV-1001',href:'/?view=invoices&document='+C}])
 assert.deepEqual(reply.steps,[])
 assert.equal(f.state.reserves,0)
 assert.equal(f.state.calls,0)
 assert.equal(f.state.saves,1)
})
test('a numbered invoice lookup preserves account boundaries and compound requests',async()=>{
 const f=fixture()
 const command='Open invoice INV-1001'
 assert.equal((await f.h(request({business_id:C,text:command}))).status,403)
 assert.equal(f.state.reads,0)
 f.state.failRead=true
 assert.equal((await f.h(request({text:command}))).status,403)
 f.session.lookup=async()=>({resource:'invoices',rows:[{id:R,invoice_number:'INV-10010'}],matching_count:1,offset:0,complete:true})
 const missing=await (await f.h(request({text:command}))).json()
 assert.match(missing.answer,/couldn't find invoice/)
 assert.deepEqual(missing.sources,[])
 assert.equal(f.state.calls,0)
 assert.equal((await f.h(request({text:command+' and send it'}))).status,200)
 assert.equal(f.state.calls,1)
})
test('a verified multistep proposal remains a proposal; response never invokes a write executor',async()=>{const f=fixture();let call=0;f.deps.complete=async()=>++call===1?{output:[{type:'function_call',name:'lookup_account_records',call_id:'a',arguments:JSON.stringify(query)}]}:result({...base,steps:[{operation:'create_job',target:null,customer:'customers:'+C,fields:{title:'Mow lawn',description:'Mowing'}},{operation:'schedule_job',target:'$step:0',customer:null,fields:{starts_at:'2026-11-10T09:00:00-05:00',ends_at:'2026-11-10T10:00:00-05:00'}}]});const response=await f.h(request({text:'Create a mowing job for Jane and schedule November 10, 9–10 am.'}));assert.equal(response.status,200);assert.equal(f.state.saves,1);assert.equal((await response.json()).steps.length,2)})
