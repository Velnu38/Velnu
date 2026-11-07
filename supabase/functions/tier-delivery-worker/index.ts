import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {dispatchQueuedEmail} from '../_shared/emailDispatch.ts'
import {emailDeliveryMode} from '../_shared/emailRelease.ts'
const env=(key:string)=>Deno.env.get(key)||''
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(async(req:Request)=>{
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'})
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:'Not authorized'})
 const auth=await db.rpc('authorize_tier_worker',{p_token:token});if(auth.error||auth.data!==true)return reply(401,{error:'Not authorized'})
 if(emailDeliveryMode()==='disabled')return reply(200,{paused:true,reason:'Sender activation pending',sent:0})
 const tasks=await db.rpc('prepare_due_delivery_tasks');if(tasks.error)return reply(503,{error:'Unable to prepare scheduled work'})
 const{data,error}=await db.rpc('list_due_document_emails');if(error||!Array.isArray(data))return reply(503,{error:'Queue unavailable'})
 let accepted=0,unconfirmed=0
 for(const row of data.slice(0,3)){const result=await dispatchQueuedEmail(db,env('RESEND_API_KEY'),row.id,crypto.randomUUID());if(result.status===200)accepted++;else unconfirmed++}
 return reply(200,{prepared:tasks.data,accepted,unconfirmed})
})
