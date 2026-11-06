import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {providerJson} from '../_shared/providerRequest.ts'
import {documentSmsHandler} from './handler.ts'
const env=(key:string)=>Deno.env.get(key)||'',url=env('SUPABASE_URL'),account=env('TWILIO_ACCOUNT_SID'),token=env('TWILIO_AUTH_TOKEN')
const admin=createClient(url,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const{data,error}=await admin.rpc(name,args).abortSignal(AbortSignal.timeout(8000));if(error)throw error;return data}
Deno.serve(documentSmsHandler({enabled:env('FINVIANT_CUSTOMER_SMS_ENABLED')==='true'&&/^AC[0-9a-f]{32}$/i.test(account)&&!!token,
 async authorize(auth){const db=createClient(url,env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});const{data,error}=await db.auth.getUser();return error?null:data.user?.id||null},
 prepare:(actor,input)=>rpc('prepare_managed_sms',{p_actor:actor,p_business:input.business_id,p_kind:input.kind,p_document:input.document_id,p_request:input.request_id,p_token:input.token,p_recipient:input.recipient}),
 claim:id=>rpc('claim_managed_sms',{p_request:id}),
 async send(claim){const data=await providerJson('https://api.twilio.com/2010-04-01/Accounts/'+account+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+btoa(account+':'+token),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:claim.recipient,From:claim.sender,Body:claim.body,StatusCallback:url+'/functions/v1/managed-sms-events?request_id='+claim.id}).toString()},{timeoutMs:15000,maxBytes:65536});return data as {sid:string}},
 finish:(id,status,provider)=>rpc('finish_managed_sms',{p_request:id,p_status:status,p_provider:provider})
}))
