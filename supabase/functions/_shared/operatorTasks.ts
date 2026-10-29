import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { dispatchQueuedEmail } from './emailDispatch.ts'
import { assessReliabilityHealth } from './healthStatus.ts'
async function authorized(req:Request,secret:string):Promise<boolean>{
 const value=req.headers.get('authorization')||''
 if(secret.length<32||value.length>512||!value.startsWith('Bearer '))return false
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.slice(7))))
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))
 let diff=0;for(let i=0;i<32;i++)diff|=a[i]^b[i];return diff===0
}
export function operatorTask(kind:'worker'|'health'){
 return async(req:Request):Promise<Response>=>{
  const requestId=crypto.randomUUID()
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':requestId}})
  if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
  const secret=Deno.env.get(kind==='worker'?'FINVIANT_EMAIL_WORKER_TOKEN':'FINVIANT_MONITOR_TOKEN')||''
  if(secret.length<32)return reply(503,{error:'Operator access not configured'})
  if(!await authorized(req,secret))return reply(401,{error:'Not authorized'})
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!key)return reply(503,{error:'Backend not configured'})
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  try{
   if(kind==='health'){
    const {data,error}=await db.rpc('finviant_ops_health').abortSignal(AbortSignal.timeout(5000))
    if(error||!data)return reply(503,{status:'unhealthy',request_id:requestId})
    const assessment=assessReliabilityHealth(data)
    return reply(assessment.healthy?200:503,{...data,alerts:assessment.alerts,metrics_valid:!assessment.invalid,request_id:requestId,
     provider_checks:'not_performed',email_release_gate:Deno.env.get('FINVIANT_CUSTOMER_EMAIL_ENABLED')==='true'?'enabled':'disabled',
     external_alert_delivery:'requires_verified_monitor_configuration'})
   }
   const resend=Deno.env.get('RESEND_API_KEY')
   if(Deno.env.get('FINVIANT_CUSTOMER_EMAIL_ENABLED')!=='true'||!resend||!Deno.env.get('RESEND_WEBHOOK_SECRET'))return reply(503,{error:'Delivery is not enabled; nothing was sent'})
   const {data:rows,error}=await db.rpc('list_due_document_emails').abortSignal(AbortSignal.timeout(5000))
   if(error||!Array.isArray(rows))return reply(503,{error:'Queue unavailable'})
   let accepted=0,deferred=0,unconfirmed=0
   // Strictly bounded invocation; the database lease prevents overlapping workers sending twice.
   for(const row of rows.slice(0,3)){
    const result=await dispatchQueuedEmail(db,resend,row.id,requestId)
    if(result.status===200)accepted++;else if(result.status===409)deferred++;else unconfirmed++
   }
   console.info(JSON.stringify({service:'email-worker',request_id:requestId,accepted,deferred,unconfirmed}))
   return reply(200,{accepted,deferred,unconfirmed,request_id:requestId})
  }catch{console.error(JSON.stringify({service:'operator-task',kind,request_id:requestId,code:'unavailable'}));return reply(503,{error:'Operation could not be confirmed',request_id:requestId})}
 }
}
