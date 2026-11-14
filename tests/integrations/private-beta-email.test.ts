import {test} from 'node:test'
import assert from 'node:assert/strict'
import {emailDeliveryMode} from '../../supabase/functions/_shared/emailRelease.ts'
import {dispatchQueuedEmail} from '../../supabase/functions/_shared/emailDispatch.ts'

const requestId='11111111-1111-4111-8111-111111111111'
const staging={SUPABASE_URL:'https://xvybcmyoblfgzokaifsx.supabase.co',RESEND_API_KEY:'fake-provider-key',RESEND_WEBHOOK_SECRET:'fake-signing-key',FINVIANT_PRIVATE_BETA_EMAIL_ENABLED:'true'}
const production={...staging,SUPABASE_URL:'https://qusmeexjbwphoezlcmie.supabase.co',FINVIANT_CUSTOMER_EMAIL_ENABLED:'true'}
const mode=(env:Record<string,string|undefined>)=>emailDeliveryMode(name=>env[name])

test('beta and production email release gates cannot open the other environment',()=>{
 assert.equal(mode(staging),'private_beta')
 assert.equal(mode({...staging,FINVIANT_PRIVATE_BETA_EMAIL_ENABLED:'false',FINVIANT_CUSTOMER_EMAIL_ENABLED:'true'}),'disabled')
 assert.equal(mode({...production,FINVIANT_CUSTOMER_EMAIL_ENABLED:'false'}),'disabled')
 assert.equal(mode(production),'production')
 assert.equal(mode({...staging,SUPABASE_URL:'https://unknown.supabase.co'}),'disabled')
 assert.equal(mode({...staging,RESEND_WEBHOOK_SECRET:''}),'disabled')
 assert.equal(mode({...staging,RESEND_API_KEY:''}),'disabled')
 assert.equal(mode({...staging,FINVIANT_APP_BASE_URL:'https://unrelated.example'}),'disabled')
})

type Options={env?:Record<string,string|undefined>;approval?:unknown;approvalError?:boolean;approvalThrows?:boolean;claimStatus?:string;stopThrows?:boolean;stopError?:boolean;stopSafe?:unknown}
async function scenario(options:Options,run:(state:{result:Awaited<ReturnType<typeof dispatchQueuedEmail>>;calls:Array<{name:string;args:Record<string,unknown>}>;emails:Record<string,unknown>[]})=>void|Promise<void>){
 const originalDeno=Object.getOwnPropertyDescriptor(globalThis,'Deno'),originalFetch=globalThis.fetch
 const env=options.env||staging,calls:Array<{name:string;args:Record<string,unknown>}>=[],emails:Record<string,unknown>[]=[]
 Object.defineProperty(globalThis,'Deno',{configurable:true,value:{env:{get:(name:string)=>env[name]}}})
 const admin={rpc(name:string,args:Record<string,unknown>){
  calls.push({name,args})
  return {abortSignal:async()=>{
   if(name==='claim_document_email')return {data:{id:requestId,status:options.claimStatus||'claimed',lease:'lease-only-for-test',provider_id:'already-accepted-id',payload:{from:'Finviant <noreply@finviant.com>',to:['delivered@resend.dev'],text:'Synthetic test'}},error:null}
   if(name==='private_beta_email_recipient_allowed'){
    if(options.approvalThrows)throw new Error('Approval unavailable')
    return {data:options.approval===undefined?true:options.approval,error:options.approvalError?{message:'RPC unavailable'}:null}
   }
   if(name==='stop_private_beta_email'){
    if(options.stopThrows)throw new Error('Database unavailable')
    return {data:options.stopSafe===undefined?true:options.stopSafe,error:options.stopError?{message:'Database unavailable'}:null}
   }
   if(name==='finish_document_email')return {data:null,error:null}
   throw new Error('Unexpected RPC '+name)
  }}
 }}
 globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init)
  assert.equal(request.url,'https://api.resend.com/emails')
  assert.equal(request.headers.get('idempotency-key'),'finviant-outbox-'+requestId)
  emails.push(await request.json())
  return new Response(JSON.stringify({id:'provider-test-id'}),{status:200,headers:{'content-type':'application/json'}})
 }
 try{const result=await dispatchQueuedEmail(admin as never,'fake-provider-key',requestId,'trace-only-for-test');await run({result,calls,emails})}
 finally{globalThis.fetch=originalFetch;if(originalDeno)Object.defineProperty(globalThis,'Deno',originalDeno);else Reflect.deleteProperty(globalThis,'Deno')}
}

test('approved private beta send checks the frozen request before the provider call',()=>scenario({},s=>{
 assert.equal(s.result.status,200)
 assert.equal(s.emails.length,1)
 assert.deepEqual(s.calls.map(c=>c.name),['claim_document_email','private_beta_email_recipient_allowed','finish_document_email'])
 assert.deepEqual(s.calls[1].args,{p_request:requestId})
 assert.equal(s.calls[2].args.p_result,'accepted')
}))

for(const approval of [false,null,{},'true',1])test('unapproved or malformed beta approval cannot send: '+JSON.stringify(approval),()=>scenario({approval},s=>{
 assert.equal(s.result.status,403)
 assert.equal(s.result.body.code,'beta_recipient_not_approved')
 assert.equal(s.result.body.beta_send_not_started,true)
 assert.match(String(s.result.body.error),/approved test recipient/)
 assert.equal(s.emails.length,0)
 assert.equal(s.calls.at(-1)?.name,'stop_private_beta_email')
 assert.equal(s.calls.at(-1)?.args.p_request,requestId)
 assert.equal(s.calls.at(-1)?.args.p_lease,'lease-only-for-test')
}))

for(const failure of [{approvalError:true},{approvalThrows:true}])test('beta approval fails closed when setup is unavailable: '+JSON.stringify(failure),()=>scenario(failure,s=>{
 assert.equal(s.result.status,503)
 assert.equal(s.result.body.code,'beta_configuration_unavailable')
 assert.equal(s.result.body.beta_send_not_started,true)
 assert.equal(s.emails.length,0)
}))

for(const failure of [{approval:false,stopError:true},{approval:false,stopThrows:true},{approvalError:true,stopError:true},{approvalThrows:true,stopThrows:true},...([false,null,{},'true',1].map(stopSafe=>({approval:false,stopSafe})))])test('unconfirmed or previously attempted beta stop retains the original operation: '+JSON.stringify(failure),()=>scenario(failure,s=>{
 assert.equal(s.result.status,503)
 assert.equal(s.result.body.code,'beta_stop_unconfirmed')
 assert.equal(s.result.body.beta_send_not_started,undefined)
 assert.equal(s.result.body.send_id,requestId)
 assert.match(String(s.result.body.error),/same send/)
 assert.equal(s.emails.length,0)
 assert.deepEqual(s.calls.map(c=>c.name),['claim_document_email','private_beta_email_recipient_allowed','stop_private_beta_email'])
}))

test('recovery paths cannot bypass disabled beta release by calling the dispatcher directly',()=>scenario({env:{...staging,FINVIANT_PRIVATE_BETA_EMAIL_ENABLED:'false',FINVIANT_CUSTOMER_EMAIL_ENABLED:'true'}},s=>{
 assert.equal(s.result.status,503)
 assert.equal(s.calls.length,0)
 assert.equal(s.emails.length,0)
}))

test('production continues using its existing send path without beta recipient restrictions',()=>scenario({env:production,approval:false},s=>{
 assert.equal(s.result.status,200)
 assert.equal(s.emails.length,1)
 assert.deepEqual(s.calls.map(c=>c.name),['claim_document_email','finish_document_email'])
}))

test('already accepted beta operation remains idempotent without another provider call',()=>scenario({claimStatus:'accepted',approval:false},s=>{
 assert.equal(s.result.status,200)
 assert.equal(s.result.body.already_sent,true)
 assert.equal(s.emails.length,0)
 assert.deepEqual(s.calls.map(c=>c.name),['claim_document_email'])
}))
