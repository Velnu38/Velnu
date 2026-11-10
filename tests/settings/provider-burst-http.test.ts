import test from 'node:test'
import assert from 'node:assert/strict'
import {burstLimitResponse} from '../../supabase/functions/_shared/burstLimit.ts'
import {readLimitedBytes} from '../../supabase/functions/_shared/signedEvents.ts'
import {workflowHandler} from '../../supabase/functions/fin-workflow/handler.ts'
import {finHandler} from '../../supabase/functions/fin-assistant/handler.ts'
import {receiptScanHandler} from '../../supabase/functions/receipt-scan/handler.ts'
import {attachmentHandler} from '../../supabase/functions/upload-attachment/handler.ts'
const B='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222'
const limit={code:'FINVIANT_BURST_LIMIT',message:'Do not echo provider secret',details:'10'}
const req=(body:unknown)=>new Request('https://local.test',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)})
const noProvider=async()=>{assert.fail('A blocked request must never reach a provider')}
test('only the trusted limit code returns a safe bounded Retry-After with CORS exposure',async()=>{
 assert.equal(burstLimitResponse({code:'P0001',message:'private'},{}),null)
 for(const details of ['10','999','NaN','-1','<script>',null]){
  const r=burstLimitResponse({...limit,details},{'access-control-allow-origin':'https://app.test'})!
  assert.equal(r.status,429);assert.equal(r.headers.get('access-control-allow-origin'),'https://app.test')
  assert.match(r.headers.get('access-control-expose-headers')!,/Retry-After/)
  assert.ok(Number(r.headers.get('retry-after'))>=1&&Number(r.headers.get('retry-after'))<=60)
  assert.doesNotMatch(await r.text(),/private|provider secret|script/)
 }
})
test('Fin and legacy Fin stop before provider usage and preserve the exact wait interval',async()=>{
 const reserve=async()=>{throw limit}
 const workflow=workflowHandler({authorize:async()=>({profile:{timezone:'UTC'},begin:async()=>({history:[],cached:null}),lookup:noProvider,finish:noProvider,reserve}),complete:noProvider})
 const legacy=finHandler({authorize:async()=>({role:'owner',entitled:async()=>true,reserve,context:async()=>({profile:{},sources:[],limits:[],as_of:'2026-11-10',timezone:'UTC'})}),configured:()=>true,complete:noProvider})
 for(const r of [await workflow(req({business_id:B,thread_id:A,request_id:A,text:'Help'})),await legacy(req({business_id:B,mode:'question',text:'Help'}))]){
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'10')
 }
 // Streaming bytes are bounded even without a declared length, before auth/usage.
 const oversized=()=>new Request('https://local.test',{method:'POST',headers:{authorization:'Bearer fixture'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(33000));c.close()}}),duplex:'half'} as RequestInit)
 assert.equal((await workflow(oversized())).status,413);assert.equal((await legacy(oversized())).status,413)
})
test('receipt and attachment limits return 429 without scanning or uploading',async()=>{
 const receipt=receiptScanHandler({origins:[],authorize:async()=>A,reserve:async()=>({error:limit}),analyze:noProvider})
 const attachment=attachmentHandler({origins:[],authorize:async()=>A,reserve:async()=>({error:limit}),upload:noProvider,finish:noProvider})
 const r=await receipt(new Request('https://local.test?business='+B+'&request='+A,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'image/jpeg'},body:Uint8Array.of(255,216,255,217)}))
 const a=await attachment(new Request('https://local.test?bucket=finviant-record-photos&path='+B+'/'+A+'.png',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'image/png'},body:Uint8Array.of(137,80,78,71,13,10,26,10)}))
 for(const response of [r,a]){assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'10')}
})
test('body deadlines cancel stalled streams and byte bounds ignore a forged small length',async()=>{
 let cancelled=false
 const stalled=new Request('https://local.test',{method:'POST',body:new ReadableStream({cancel(){cancelled=true}}),duplex:'half'} as RequestInit)
 await assert.rejects(readLimitedBytes(stalled,100,20),/REQUEST_TIMEOUT/)
 assert.equal(cancelled,true)
 const overflow=new Request('https://local.test',{method:'POST',headers:{'content-length':'1'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(101));c.close()}}),duplex:'half'} as RequestInit)
 await assert.rejects(readLimitedBytes(overflow,100),/REQUEST_TOO_LARGE/)
})
