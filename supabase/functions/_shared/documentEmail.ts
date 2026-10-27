import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { dispatchQueuedEmail } from './emailDispatch.ts'
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
   const {data:prepared,error:prepError}=await admin.rpc('prepare_document_email',{p_actor:identity.user.id,p_business:business,p_kind:kind,p_document:document,p_request:operation,p_origin:Deno.env.get('FINVIANT_APP_BASE_URL')||'https://finviant.com'}).abortSignal(AbortSignal.timeout(5000))
   if(prepError||!prepared)return respond(prepError?.code==='42501'?403:409,{error:'Unable to queue the document. Check account permissions, plan, recipient and document status.'})
   const result=await dispatchQueuedEmail(admin,resend,prepared.id,trace)
   return respond(result.status,result.body)
  }catch{console.error(JSON.stringify({service:'document-email',request_id:trace,code:'unexpected'}));return respond(500,{error:'The send outcome is not confirmed. Keep the same send identifier when retrying.'})}
 }
}
