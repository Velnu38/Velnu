import test from 'node:test'
import assert from 'node:assert/strict'
import {documentPdfHandler} from '../../supabase/functions/document-pdf/handler.ts'
import {documentSmsHandler} from '../../supabase/functions/send-document-sms/handler.ts'
import {businessCardDeliveryHandler} from '../../supabase/functions/business-card-delivery/handler.ts'
const ID='11111111-1111-4111-8111-111111111111', token='a'.repeat(64)
const limit={code:'FINVIANT_DAILY_LIMIT',details:'3600',message:'private detail'}
const noCall=async()=>{assert.fail('Blocked work must not reach provider/storage')}
const request=(body:unknown)=>new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)})
test('separate PDF handler instances preserve shared-store denial and never fetch/render an artifact',async()=>{
 const deps={origins:[],authorize:async()=>ID,ownerVersion:async()=>({data:null,error:limit}),customerVersion:async()=>({data:null,error:limit}),artifact:noCall}
 for(const handler of [documentPdfHandler(deps),documentPdfHandler(deps)]){
  for(const body of [{token},{business_id:ID,document_kind:'invoice',document_id:ID}]){
   const response=await handler(request(body));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'3600');assert.doesNotMatch(await response.text(),/private detail/)
  }
 }
 const renderLimited=documentPdfHandler({...deps,customerVersion:async()=>({data:{version_id:ID}}),artifact:async()=>{throw limit}})
 assert.equal((await renderLimited(request({token}))).status,429)
})
test('SMS and card handlers stop before send on shared claim rejection and bound streamed input bytes',async()=>{
 const sms=documentSmsHandler({enabled:true,authorize:async()=>ID,prepare:async()=>({id:ID}),claim:async()=>{throw limit},send:noCall,finish:noCall})
 const card=businessCardDeliveryHandler({enabled:()=>true,origins:[],authorize:async()=>ID,prepare:async()=>({data:{id:ID},error:null}),claim:async()=>{throw limit},send:noCall,finish:noCall,email:noCall})
 const response=await sms(request({business_id:ID,document_id:ID,request_id:ID,kind:'invoice',token,recipient:'+17575550111'}))
 const cardResponse=await card(request({business_id:ID,request_id:ID,revision:ID,token,channel:'sms',consent:true,recipient:'+17575550111'}))
 for(const r of [response,cardResponse]){assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'3600')}
 for(const handler of [sms,card]){
  let canceled=false
  const req=new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer fixture','content-length':'1'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(4097))},cancel(){canceled=true}}),duplex:'half'} as RequestInit)
  assert.equal((await handler(req)).status,413);assert.equal(canceled,true)
 }
})
