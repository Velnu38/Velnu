import { documentEmailHandler } from '../_shared/documentEmail.ts'
const handle=documentEmailHandler(true),docHandle=documentEmailHandler(false)
const biz='11111111-1111-4111-8111-111111111111',invoice='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',id='55555555-5555-4555-8555-555555555555'
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message)}
function req(extra:Record<string,unknown>={},auth=true,origin='https://finviant.com'){
 return new Request('https://qusmeexjbwphoezlcmie.supabase.co/functions/v1/send-invoice-email',{method:'POST',headers:{'content-type':'application/json',Origin:origin,...(auth?{Authorization:'Bearer test-session'}:{})},body:JSON.stringify({business_id:biz,invoice_id:invoice,request_id:id,...extra})})
}
type Opt={role?:string;unavailable?:boolean;missingEmail?:boolean;providerStatus?:number;network?:boolean;invalidJSON?:boolean;badReceipt?:boolean;disabled?:boolean;ackFail?:boolean;claim?:string}
async function mock(opt:Opt,run:(state:{emails:Record<string,unknown>[];keys:string[];preparations:Record<string,unknown>[];finishes:Record<string,unknown>[]})=>Promise<void>){
 const original=globalThis.fetch,emails:Record<string,unknown>[]=[],keys:string[]=[],preparations:Record<string,unknown>[]=[],finishes:Record<string,unknown>[]=[]
 const rows=new Map<string,{document:string;status:string;provider_id?:string}>()
 const vars={SUPABASE_URL:'https://qusmeexjbwphoezlcmie.supabase.co',SUPABASE_ANON_KEY:'test-key',SUPABASE_SERVICE_ROLE_KEY:'fake-server-key',RESEND_API_KEY:'fake-resend-key',RESEND_WEBHOOK_SECRET:'fake-signing-key',FINVIANT_CUSTOMER_EMAIL_ENABLED:opt.disabled?'false':'true',FINVIANT_APP_BASE_URL:'https://finviant.com'}
 const previous=new Map(Object.keys(vars).map(k=>[k,Deno.env.get(k)]));for(const[k,v]of Object.entries(vars))Deno.env.set(k,v)
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
 globalThis.fetch=async(input,init)=>{
  const r=new Request(input,init),u=new URL(r.url)
  if(u.hostname==='api.resend.com'){
   emails.push(await r.json());keys.push(r.headers.get('idempotency-key')||'')
   if(opt.network)throw new TypeError('simulated network interruption; not a real API call')
   if(opt.invalidJSON)return new Response('not json',{status:200})
   if(opt.providerStatus)return json({error:'simulated'},opt.providerStatus)
   return json(opt.badReceipt?{}:{id:'provider-test-'+keys.at(-1)})
  }
  if(u.hostname!=='qusmeexjbwphoezlcmie.supabase.co')throw new Error('External network forbidden')
  if(u.pathname==='/auth/v1/user')return json({id:user,email:'owner@example.invalid',app_metadata:{},user_metadata:{}})
  const body=await r.json()
  if(u.pathname.endsWith('/prepare_document_email')){
   preparations.push(body);assert(body.p_actor===user,'Actor must come from verified session');assert(body.p_business===biz,'Tenant must be explicit')
   if(['viewer','technician'].includes(opt.role||''))return json({code:'42501',message:'Finance permission required'},403)
   if(opt.unavailable||opt.missingEmail)return json({code:'23514',message:'Invalid canonical document or recipient'},400)
   const prior=rows.get(body.p_request)
   if(prior&&prior.document!==body.p_document)return json({code:'23505',message:'Request collision'},409)
   if(!prior)rows.set(body.p_request,{document:body.p_document,status:'queued'})
   return json({id:body.p_request,status:prior?.status||'queued'})
  }
  if(u.pathname.endsWith('/claim_document_email')){
   const row=rows.get(body.p_request)!
   if(row.status==='accepted')return json({id:body.p_request,status:'accepted',provider_id:row.provider_id,recipient:'customer@example.invalid'})
   if(opt.claim)return json({id:body.p_request,status:opt.claim})
   return json({id:body.p_request,status:'claimed',lease:'66666666-6666-4666-8666-666666666666',payload:{from:'Finviant Office <adminsupport@finviant.com>',to:['customer@example.invalid'],subject:'Invoice TEST',text:'Canonical invoice: <script>text only</script>. Total USD 100.'}})
  }
  if(u.pathname.endsWith('/finish_document_email')){
   finishes.push(body)
   if(opt.ackFail)return json({code:'XX000',message:'Simulated local acknowledgement failure'},500)
   const row=rows.get(body.p_request)!;row.status=body.p_result;row.provider_id=body.p_provider_id
   return json(null)
  }
  throw new Error('Unexpected database route: '+u.pathname)
 }
 try{await run({emails,keys,preparations,finishes})}finally{globalThis.fetch=original;for(const[k,v]of previous)v===undefined?Deno.env.delete(k):Deno.env.set(k,v)}
}
Deno.test('unauthenticated requests cannot send email',()=>mock({},async s=>{assert((await handle(req({},false))).status===401);assert(s.emails.length===0)}))
Deno.test('unapproved browser origins cannot send email',()=>mock({},async s=>{assert((await handle(req({},true,'https://unrelated.example'))).status===403);assert(s.emails.length===0)}))
Deno.test('production email rejects the staging browser origin',()=>mock({},async s=>{const r=await handle(req({},true,'https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app'));assert(r.status===403);assert(!r.headers.has('access-control-allow-origin'));assert(s.emails.length===0);assert(s.preparations.length===0)}))
Deno.test('cross-environment email callback override fails before network access',()=>mock({},async s=>{Deno.env.set('FINVIANT_APP_BASE_URL','https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app');assert((await handle(req())).status===503);assert(s.emails.length===0);assert(s.preparations.length===0)}))
Deno.test('viewer cannot email invoices',()=>mock({role:'viewer'},async s=>{assert((await handle(req())).status===403);assert(s.emails.length===0)}))
Deno.test('technicians cannot email financial documents',()=>mock({role:'technician'},async s=>{assert((await handle(req())).status===403);assert(s.emails.length===0)}))
Deno.test('unavailable invoice is not emailed',()=>mock({unavailable:true},async s=>{assert((await handle(req())).status===409);assert(s.emails.length===0)}))
Deno.test('customer must have a valid canonical email',()=>mock({missingEmail:true},async s=>{assert((await handle(req())).status===409);assert(s.emails.length===0)}))
Deno.test('server release gate prevents direct API bypass',()=>mock({disabled:true},async s=>{assert((await handle(req())).status===503);assert(s.preparations.length===0);assert(s.emails.length===0)}))
Deno.test('immutable payload ignores attacker recipient and internal notes',()=>mock({},async s=>{const r=await handle(req({to:'attacker@example.invalid',notes:'CONFIDENTIAL_INTERNAL_NOTES'}));assert(r.status===200);assert(s.emails.length===1);assert(JSON.stringify(s.emails[0].to)==='["customer@example.invalid"]');assert(!JSON.stringify(s.emails[0]).includes('CONFIDENTIAL_INTERNAL_NOTES'));assert(s.emails[0].html===undefined,'Plain text is not interpreted as HTML');assert(String(s.emails[0].from).includes('adminsupport@finviant.com'))}))
Deno.test('retry of accepted request does not send a second email',()=>mock({},async s=>{assert((await handle(req())).status===200);const r=await handle(req());assert(r.status===200);assert((await r.json()).already_sent===true);assert(s.emails.length===1)}))
Deno.test('network interruption is uncertain, not sent or silently retried',()=>mock({network:true},async s=>{assert((await handle(req())).status===502);assert(s.emails.length===1);assert(s.finishes[0].p_result==='uncertain')}))
Deno.test('malformed provider success remains uncertain',()=>mock({invalidJSON:true},async s=>{assert((await handle(req())).status===502);assert(s.finishes[0].p_result==='uncertain')}))
Deno.test('success without receipt remains uncertain',()=>mock({badReceipt:true},async s=>{assert((await handle(req())).status===502);assert(s.finishes[0].p_result==='uncertain')}))
Deno.test('provider rate limit does not cause a retry storm',()=>mock({providerStatus:429},async s=>{assert((await handle(req())).status===502);assert(s.emails.length===1);assert(s.finishes[0].p_result==='uncertain')}))
Deno.test('definitive provider rejection is recorded failed',()=>mock({providerStatus:422},async s=>{assert((await handle(req())).status===502);assert(s.finishes[0].p_result==='failed')}))
Deno.test('database ack failure warns without asking for another send',()=>mock({ackFail:true},async s=>{const r=await handle(req());assert(r.status===200);assert((await r.json()).warning);assert(s.emails.length===1)}))
for(const state of ['busy','reconciliation_required','failed'])Deno.test('queue '+state+' is never re-sent',()=>mock({claim:state},async s=>{assert((await handle(req())).status===409);assert(s.emails.length===0)}))
Deno.test('100 attempts retain 50 original provider keys',()=>mock({},async s=>{for(let n=0;n<50;n++){const request_id='77777777-7777-4777-8777-'+String(n).padStart(12,'0');assert((await handle(req({request_id}))).status===200);assert((await handle(req({request_id}))).status===200)}assert(s.emails.length===50);assert(new Set(s.keys).size===50)}))
Deno.test('estimate path passes a persistent ID to the same queue',()=>mock({},async s=>{const r=await docHandle(req({document_type:'estimate',document_id:invoice}));assert(r.status===200);assert(s.preparations[0].p_kind==='estimate');assert(s.preparations[0].p_request===id)}))
