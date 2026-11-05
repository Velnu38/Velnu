import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {providerJson} from '../_shared/providerRequest.ts'
import {workflowHandler} from './handler.ts'
import type {Lookup} from './protocol.ts'
const env=(key:string)=>Deno.env.get(key)||''
Deno.serve(workflowHandler({
 async authorize(authorization,business){
  const key=env('SUPABASE_ANON_KEY')||JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')||'{}').default
  const db=createClient(env('SUPABASE_URL'),key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:auth,error}=await db.auth.getUser();if(error||!auth.user)return null
  const {data:member,error:membershipError}=await db.from('business_members').select('role,access_modules').eq('business_id',business).eq('user_id',auth.user.id).maybeSingle()
  if(membershipError||!member||!['owner','admin','office','technician','viewer'].includes(member.role))return null
  const {data:usage,error:usageError}=await db.rpc('get_plan_usage',{target_business_id:business});if(usageError||usage?.plan!=='pro'||Number(usage?.ai_limit)<=0)return null
  if(!env('OPENAI_API_KEY'))throw Error('Fin’s language service is awaiting server setup.')
  const {data:profile,error:profileError}=await db.from('businesses').select('name,timezone,business_description,services_offered,service_area,team_roles').eq('id',business).single();if(profileError)throw profileError
  const {data:settings,error:settingsError}=await db.from('business_settings').select('default_tax_rate').eq('business_id',business).maybeSingle();if(settingsError)throw settingsError
  async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw error;return data}
  const capabilities=await rpc('fin_account_capabilities',{p_business:business})
  return {capabilities,profile:{...profile,default_tax_rate:settings?.default_tax_rate||0,role:member.role,access_modules:member.access_modules},
   begin:(thread:string,request:string,text:string)=>rpc('fin_begin_turn',{p_business:business,p_thread:thread,p_request:request,p_text:text}),
   lookup:(query:Lookup)=>rpc('fin_lookup_records',{p_business:business,p_query:query}),
   finish:(thread:string,request:string,reply:unknown)=>rpc('fin_finish_turn',{p_business:business,p_thread:thread,p_request:request,p_reply:reply}),
   reserve:()=>rpc('reserve_ai_provider_attempt',{p_business_id:business,p_kind:'command'})}
 },
 async complete(input,tools,instructions,schema,timeoutMs){return providerJson('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-6-luna',reasoning:{effort:'low'},instructions,input,tools,parallel_tool_calls:false,store:false,max_output_tokens:6000,text:{format:{type:'json_schema',name:'fin_workflow',strict:true,schema}}})},{timeoutMs:timeoutMs||45000,maxBytes:1048576})}
}))
