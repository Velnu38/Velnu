import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {dispatchQueuedEmail} from '../_shared/emailDispatch.ts'
import {emailDeliveryMode} from '../_shared/emailRelease.ts'
import {dispatchAppointmentReminder} from '../_shared/appointmentReminderDispatch.ts'
import {providerJson} from '../_shared/providerRequest.ts'
import {resolveAppEnvironment} from '../_shared/appEnvironment.ts'
const env=(key:string)=>Deno.env.get(key)||''
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(async(req:Request)=>{
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:'Not authorized'})
 const auth=await db.rpc('authorize_tier_worker',{p_token:token});if(auth.error||auth.data!==true)return reply(401,{error:'Not authorized'})
 const mode=emailDeliveryMode(),account=env('TWILIO_ACCOUNT_SID'),smsToken=env('TWILIO_AUTH_TOKEN')
 const smsEnabled=!!resolveAppEnvironment(env('SUPABASE_URL'),env('FINVIANT_APP_BASE_URL'))&&env('FINVIANT_CUSTOMER_SMS_ENABLED')==='true'&&/^AC[0-9a-f]{32}$/i.test(account)&&!!smsToken
 if(mode==='disabled'&&!smsEnabled)return reply(200,{paused:true,reason:'Sender activation pending',sent:0})
 let accepted=0,unconfirmed=0,prepared=0,documentQueueFailed=false
 if(mode!=='disabled'){
  try{
   const tasks=await db.rpc('prepare_due_delivery_tasks');if(tasks.error)throw tasks.error;prepared=tasks.data
   const{data,error}=await db.rpc('list_due_document_emails');if(error||!Array.isArray(data))throw Error('Queue unavailable')
   for(const row of data.slice(0,3)){try{const result=await dispatchQueuedEmail(db,env('RESEND_API_KEY'),row.id,crypto.randomUUID());if(result.status===200)accepted++;else unconfirmed++}catch{unconfirmed++}}
  }catch{documentQueueFailed=true}
 }
 async function rpc(name:string,args:Record<string,unknown>={}){const{data,error}=await db.rpc(name,args).abortSignal(AbortSignal.timeout(8000));if(error)throw error;return data}
 let appointmentAccepted=0,appointmentUnconfirmed=0
 try{
  await rpc('prepare_due_appointment_reminders')
  const rows=await rpc('list_due_appointment_reminders',{p_email_enabled:mode!=='disabled',p_sms_enabled:smsEnabled})
  if(!Array.isArray(rows))throw Error('Queue unavailable')
  for(const row of rows.slice(0,10)){
   try{
    const result=await dispatchAppointmentReminder({emailMode:mode,smsEnabled,
     claim:(id,beta)=>rpc('claim_appointment_reminder',{p_request:id,p_private_beta:beta}),
     async sendEmail(id,payload){return await providerJson('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'finviant-appointment-'+id},body:JSON.stringify(payload)},{timeoutMs:20000,maxBytes:65536}) as {id:string}},
     async sendSms(claim){return await providerJson('https://api.twilio.com/2010-04-01/Accounts/'+account+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+btoa(account+':'+smsToken),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:claim.recipient!,From:claim.sender!,Body:claim.body!}).toString()},{timeoutMs:15000,maxBytes:65536}) as {sid:string}},
     finish:async(id,status,provider)=>{await rpc('finish_appointment_reminder',{p_request:id,p_status:status,p_provider:provider})}
    },row)
    if(result.status==='accepted')appointmentAccepted++;else if(result.status!=='paused')appointmentUnconfirmed++
   }catch{appointmentUnconfirmed++}
  }
 }catch{return reply(503,{error:'Appointment reminder queue unavailable',prepared,accepted,unconfirmed,appointmentAccepted,appointmentUnconfirmed})}
 return reply(documentQueueFailed?503:200,{prepared,accepted,unconfirmed,appointmentAccepted,appointmentUnconfirmed,documentQueueFailed})
})
