import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { providerJson, ProviderRequestError } from './providerRequest.ts'
import { readLimitedRequest } from './signedEvents.ts'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const origins=new Set(['https://finviant.com','https://www.finviant.com','https://app.finviant.com','https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app','http://localhost:5173'])
export function documentEmailHandler(invoiceOnly:boolean){
 return async(req:Request):Promise<Response>=>{
  const trace=crypto.randomUUID(),origin=req.headers.get('origin')||''
  const headers={'content-type':'application/json','cache-control':'no-store','x-request-id':trace,'access-control-allow-origin':origins.has(origin)?origin:'https://finviant.com','access-control-allow-headers':'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'POST, OPTIONS','vary':'Origin'}
  const respond=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify({...body,request_id:trace}),{status,headers})
  if(origin&&!origins.has(origin))return respond(403,{error:'This app address is not authorized.'})
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  if(req.method!=='POST')return respond(405,{error:'Method not allowed.'})
  const auth=req.headers.get('authorization')||''
  if(!auth.startsWith('Bearer '))return respond(401,{error:'Sign in to send a document.'})
  try{
   const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
   if(!url||!anon||!service)return respond(503,{error:'Email service is not configured.'})
   const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
   const {data:identity,error:authError}=await caller.auth.getUser()
   if(authError||!identity.user)return respond(401,{error:'Session expired. Sign in again.'})
   const resend=Deno.env.get('RESEND_API_KEY'),webhook=Deno.env.get('RESEND_WEBHOOK_SECRET')
   if(Deno.env.get('FINVIANT_CUSTOMER_EMAIL_ENABLED')!=='true'||!resend||!webhook)return respond(503,{error:'Customer email is awaiting verified delivery configuration. No message was queued or sent.',code:'email_not_enabled'})
   let input:Record<string,unknown>;try{input=JSON.parse(await readLimitedRequest(req,16384))}catch{return respond(400,{error:'Invalid or oversized request.'})}
   if(!input||typeof input!=='object'||Array.isArray(input))return respond(400,{error:'Invalid request.'})
   const business=String(input.business_id||''),document=String((invoiceOnly?input.invoice_id:input.document_id)||''),operation=String(input.request_id||'')
   const kind=invoiceOnly?'invoice':String(input.document_type||'')
   if(![business,document,operation].every(v=>UUID.test(v))||(!invoiceOnly&&!['estimate','change_order'].includes(kind)))return respond(400,{error:'A valid business, document and persistent send identifier are required.'})
   const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
   const {data:prepared,error:prepError}=await admin.rpc('prepare_document_email',{p_actor:identity.user.id,p_business:business,p_kind:kind,p_document:document,p_request:operation,p_origin:Deno.env.get('FINVIANT_APP_BASE_URL')||'https://finviant.com'})
   if(prepError)return respond(prepError.code==='42501'?403:409,{error:'Unable to queue the document. Check account permissions, plan, recipient and document status.'})
   const {data:claim,error:claimError}=await admin.rpc('claim_document_email',{p_request:prepared.id})
   if(claimError)return respond(503,{error:'The saved send could not be claimed. Retry the same send, not a new message.'})
   if(['accepted','delivered'].includes(claim.status))return respond(200,{status:claim.status,email_id:claim.provider_id,recipient:claim.recipient||'the saved customer address',already_sent:true,send_id:claim.id})
   if(claim.status!=='claimed')return respond(409,{error:claim.status==='busy'?'This send is already processing or waiting for its retry interval.':'This send needs support review before another attempt.',code:claim.status,send_id:claim.id})
   let sent:Record<string,unknown>
   try{
    sent=await providerJson('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resend,'Content-Type':'application/json','Idempotency-Key':'finviant-outbox-'+claim.id},body:JSON.stringify(claim.payload)},{timeoutMs:20000,maxBytes:65536})
    if(typeof sent.id!=='string'||sent.id.length>200)throw new Error('INVALID_RECEIPT')
   }catch(err){
    const definitive=err instanceof ProviderRequestError&&err.code==='http'&&[400,401,403,404,422].includes(err.status||0)
    const code=err instanceof ProviderRequestError?err.code:'invalid_receipt'
    await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:definitive?'failed':'uncertain',p_provider_id:null,p_code:code})
    console.warn(JSON.stringify({service:'document-email',request_id:trace,code}))
    return respond(502,{error:'Delivery was not confirmed. The original request is saved; retry that same send after its waiting period. Do not start a new send.',code:'delivery_unconfirmed',send_id:claim.id})
   }
   const {error:saveError}=await admin.rpc('finish_document_email',{p_request:claim.id,p_lease:claim.lease,p_result:'accepted',p_provider_id:sent.id,p_code:null})
   return respond(200,{status:'accepted',email_id:sent.id,recipient:claim.payload.to[0],send_id:claim.id,warning:saveError?'Provider accepted the email but local reconciliation is pending. Do not create a new send.':null})
  }catch{console.error(JSON.stringify({service:'document-email',request_id:trace,code:'unexpected'}));return respond(500,{error:'The send outcome is not confirmed. Keep the same send identifier when retrying.'})}
 }
}
