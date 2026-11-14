import assert from 'node:assert/strict'
import test from 'node:test'
import {dispatchQueuedEmail} from '../../supabase/functions/_shared/emailDispatch.ts'
const B='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222',V='33333333-3333-4333-8333-333333333333',Q='44444444-4444-4444-8444-444444444444',L='55555555-5555-4555-8555-555555555555'
async function withMock(options:{artifactUnavailable?:boolean;freezeUnconfirmed?:boolean;providerUncertain?:boolean;claimLimited?:boolean}={},run:(state:any)=>Promise<void>){
 const env={SUPABASE_URL:'https://qusmeexjbwphoezlcmie.supabase.co',FINVIANT_APP_BASE_URL:'https://finviant.com',FINVIANT_CUSTOMER_EMAIL_ENABLED:'true',RESEND_API_KEY:'fake-test-key',RESEND_WEBHOOK_SECRET:'fake-test-signature'}
 const originalDeno=Object.getOwnPropertyDescriptor(globalThis,'Deno'),originalFetch=globalThis.fetch
 Object.defineProperty(globalThis,'Deno',{configurable:true,value:{env:{get:(name:string)=>env[name as keyof typeof env]}}})
 const provider:any[]=[],rpc:any[]=[],finish:any[]=[];let accepted=false
 const bytes=new TextEncoder().encode('%PDF-1.7 originally issued PDF\n%%EOF')
 const payload={from:'Test <adminsupport@finviant.com>',to:['customer@example.test'],subject:'Invoice',text:'Your PDF is attached.'}
 const client={rpc(name:string,args:any){
  rpc.push({name,args});let result:any
  if(name==='claim_document_email'&&options.claimLimited)result={data:null,error:{code:'FINVIANT_DAILY_LIMIT',details:'3600'}}
  else if(name==='claim_document_email')result={data:accepted?{id:Q,status:'accepted',provider_id:'provider-1',recipient:'customer@example.test'}:{id:Q,status:'claimed',lease:L,document_version_id:V,payload},error:null}
  else if(name==='document_pdf_artifact_context')result=options.artifactUnavailable?{data:null,error:{message:'unavailable'}}:{data:{version_id:V,business_id:B,document_id:D,kind:'invoice',snapshot:{kind:'invoice',number:'INV-123'}},error:null}
  else if(name==='register_document_pdf_artifact')result={data:{ok:true},error:null}
  else if(name==='freeze_document_email_attachment')result=options.freezeUnconfirmed?{data:null,error:{message:'lost acknowledgement'}}:{data:{...payload,attachments:[{filename:args.p_filename,content:args.p_content,content_type:'application/pdf'}]},error:null}
  else if(name==='release_document_pdf_claim'){finish.push({...args,pre_provider_release:true});result={data:true,error:null}}
  else if(name==='finish_document_email'){finish.push(args);accepted=args.p_result==='accepted';result={data:null,error:null}}
  else throw new Error('Unexpected RPC '+name)
  return{abortSignal:async()=>result}
 },storage:{from(bucket:string){assert.equal(bucket,'finviant-document-pdfs');return{download:async()=>({data:new Blob([bytes]),error:null})}}}}
 globalThis.fetch=async(input:any,init:any)=>{assert.equal(String(input),'https://api.resend.com/emails');provider.push({payload:JSON.parse(init.body),key:init.headers['Idempotency-Key']});if(options.providerUncertain)throw new TypeError('mocked network failure');return new Response(JSON.stringify({id:'provider-1'}),{headers:{'content-type':'application/json'}})}
 try{await run({client,provider,rpc,finish,bytes})}finally{globalThis.fetch=originalFetch;if(originalDeno)Object.defineProperty(globalThis,'Deno',originalDeno);else delete(globalThis as any).Deno}
}

test('Resend receives the persisted canonical PDF before its single provider attempt',()=>withMock({},async s=>{
 const response=await dispatchQueuedEmail(s.client,'fake-key',Q,'trace')
 assert.equal(response.status,200)
 assert.equal(s.provider.length,1)
 assert.equal(s.rpc.find((call:any)=>call.name==='claim_document_email').args.p_pdf_capable,true)
 const attachment=s.provider[0].payload.attachments[0]
 assert.equal(attachment.filename,'Invoice-INV-123.pdf')
 assert.deepEqual(Buffer.from(attachment.content,'base64'),Buffer.from(s.bytes))
 assert.equal(s.provider[0].key,'finviant-outbox-'+Q)
 assert.equal(s.finish[0].p_result,'accepted')
 const again=await dispatchQueuedEmail(s.client,'fake-key',Q,'trace2')
 assert.equal(again.body.already_sent,true)
 assert.equal(s.provider.length,1)
}))

test('missing canonical PDF or unconfirmed freeze cannot contact Resend',async()=>{
 for(const options of [{artifactUnavailable:true},{freezeUnconfirmed:true}])await withMock(options,async s=>{
  const response=await dispatchQueuedEmail(s.client,'fake-key',Q,'trace')
  assert.equal(response.status,503)
  assert.equal(response.body.code,'pdf_artifact_unavailable')
  assert.equal(response.body.send_id,Q)
  assert.equal(s.provider.length,0)
  assert.equal(s.finish[0].pre_provider_release,true)
  assert.equal(s.finish[0].p_lease,L)
 })
})

test('a provider failure retains the frozen PDF and original operation for reconciliation',()=>withMock({providerUncertain:true},async s=>{
 const response=await dispatchQueuedEmail(s.client,'fake-key',Q,'trace')
 assert.equal(response.status,502)
 assert.equal(s.provider.length,1)
 assert.equal(s.provider[0].key,'finviant-outbox-'+Q)
 assert.ok(s.provider[0].payload.attachments[0].content)
 assert.equal(s.finish[0].p_result,'uncertain')
 assert.equal(response.body.send_id,Q)
}))


test('shared claim limit returns Retry-After and the original send ID with zero provider attempts',()=>withMock({claimLimited:true},async s=>{
 const response=await dispatchQueuedEmail(s.client,'fake-key',Q,'trace')
 assert.equal(response.status,429);assert.equal(response.headers?.['retry-after'],'3600')
 assert.equal(response.body.send_id,Q);assert.equal(s.provider.length,0);assert.equal(s.finish.length,0)
}))
