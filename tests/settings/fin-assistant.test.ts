import {test} from 'node:test'
import assert from 'node:assert/strict'
import {finHandler,type FinDependencies} from '../../supabase/functions/fin-assistant/handler.ts'
import {validDraft,validateAnswer,sumMoney,responseText} from '../../supabase/functions/fin-assistant/core.ts'
const B='11111111-1111-4111-8111-111111111111',X='22222222-2222-4222-8222-222222222222'
const words='Create invoice for $200 for landscaping, $100 for painting'
const draft=()=>({kind:'invoice',customerName:'',lines:[{description:'landscaping',amount:'200',quantity:'1',source:'$200 for landscaping'},{description:'painting',amount:'100',quantity:'1',source:'$100 for painting'}],statedTotal:null,taxRate:null,warnings:[]})
const req=(body:unknown,auth=true)=>new Request('https://example.test/fin',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer caller'}:{})},body:JSON.stringify(body)})
function fixture(){let calls=0,reserves=0,reads=0;const session={role:'owner',entitled:async()=>true,reserve:async()=>{reserves++},context:async()=>{reads++;return {profile:{name:'Example business'},sources:[{key:'profile',label:'Saved company profile'}],limits:['Bounded snapshot'],as_of:'2026-11-03T12:00:00Z',timezone:'America/New_York'}}};const deps:FinDependencies={authorize:async(_a,b)=>b===B?session:null,configured:()=>true,complete:async()=>{calls++;return {output_text:JSON.stringify(draft())}}};return{deps,session,counts:()=>({calls,reserves,reads})}}
test('Fin rejects unauthenticated, unrelated-business, forbidden-role and non-Pro reads before any provider call',async()=>{
 const f=fixture(),h=finHandler(f.deps),body={business_id:B,mode:'question',text:'Who owes me money?'}
 assert.equal((await h(req(body,false))).status,401);assert.equal((await h(req({...body,business_id:X}))).status,403)
 f.session.role='office';assert.equal((await h(req(body))).status,403);f.session.role='viewer';assert.equal((await h(req({...body,mode:'draft'}))).status,403)
 f.session.role='owner';f.session.entitled=async()=>false;assert.equal((await h(req(body))).status,403);assert.deepEqual(f.counts(),{calls:0,reserves:0,reads:0})
})
test('Fin keeps all charges with no invented customer or stated total, reserves once and returns only a proposal',async()=>{
 const f=fixture(),r=await finHandler(f.deps)(req({business_id:B,mode:'draft',text:words}));assert.equal(r.status,200);const body=await r.json();assert.equal(body.draft.customerName,'');assert.equal(body.draft.statedTotal,null);assert.deepEqual(body.draft.lines.map((l:any)=>l.amount),['200','100']);assert.equal(body.action_id,undefined);assert.deepEqual(f.counts(),{calls:1,reserves:1,reads:1});assert.equal(r.headers.get('cache-control'),'no-store')
})
test('Fin fails closed on invented prices, customer prices, ungrounded tax and totals, negative charges or incomplete output',()=>{
 const d=draft();assert.equal(validDraft(d,words),true)
 d.lines[0].amount='900';assert.equal(validDraft(d,words),false);d.lines[0].amount='200'
 d.customerName='$200';assert.equal(validDraft(d,words),false);d.customerName='two hundred dollars';assert.equal(validDraft(d),false);d.customerName=''
 d.taxRate='5' as any;assert.equal(validDraft(d,words),false);d.taxRate=null;d.statedTotal='300' as any;assert.equal(validDraft(d,words),false);d.statedTotal=null
 assert.equal(validDraft(d,words+' deposit $10'),false);assert.throws(()=>responseText({status:'incomplete',output_text:'{}'}))
 assert.equal(validateAnswer({answer:'Account balance',source_keys:['other-business']},new Set(['profile'])),false)
 assert.equal(sumMoney([{amount:0.1},{amount:'0.20'}],'amount'),'0.30');assert.throws(()=>sumMoney([{amount:'NaN'}],'amount'))
})
test('Fin answers cite only retrieved records; a fabricated source fails and no writes or SQL are available to the model',async()=>{
 const f=fixture();f.deps.complete=async(_i,input)=>{assert.equal(JSON.parse(input).context.profile.name,'Example business');return {output_text:JSON.stringify({answer:'This business is Example business.',source_keys:['profile']})}}
 const h=finHandler(f.deps),input={business_id:B,mode:'question',text:'What is my business called?'};const r=await h(req(input));assert.equal(r.status,200);assert.deepEqual((await r.json()).sources,[{key:'profile',label:'Saved company profile'}])
 f.deps.complete=async()=>({output_text:JSON.stringify({answer:'Other business secrets',source_keys:['outside']})});assert.equal((await h(req(input))).status,502)
})
test('Fin setup, quota, record and provider errors never pretend a draft was saved',async()=>{
 const f=fixture(),h=finHandler(f.deps),input={business_id:B,mode:'draft',text:words};f.deps.configured=()=>false;assert.equal((await h(req(input))).status,503);assert.equal(f.counts().calls,0)
 f.deps.configured=()=>true;f.session.reserve=async()=>{throw {code:'P0001'}};assert.equal((await h(req(input))).status,429);assert.equal(f.counts().calls,0)
 f.session.reserve=async()=>{};f.deps.complete=async()=>{throw Error('provider unavailable')};assert.equal((await h(req(input))).status,503)
 assert.equal((await h(req({...input,text:'x'.repeat(6001)}))).status,413);assert.equal((await h(req({...input,mode:'execute'}))).status,400)
})
