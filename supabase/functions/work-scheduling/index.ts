import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { dispatchQueuedEmail } from '../_shared/emailDispatch.ts'
import { schedulingHandler } from './handler.ts'
import { emailDeliveryMode } from '../_shared/emailRelease.ts'

const url=Deno.env.get('SUPABASE_URL') || '', anon=Deno.env.get('SUPABASE_ANON_KEY') || '', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const environment=resolveAppEnvironment(url,Deno.env.get('FINVIANT_APP_BASE_URL'))
const resend=Deno.env.get('RESEND_API_KEY') || ''
if(!environment || !url || !anon || !service) {
  Deno.serve(()=>new Response(JSON.stringify({error:'Scheduling service is awaiting setup.'}),{status:503,headers:{'content-type':'application/json'}}))
} else {
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  Deno.serve(schedulingHandler({
    origin:environment.baseUrl,allowedOrigins:environment.origins,
    emailEnabled:emailDeliveryMode()!=='disabled',
    async authorize(authorization) {
      if(!authorization.startsWith('Bearer ')) return null
      const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
      const {data,error}=await caller.auth.getUser()
      return error || !data.user ? null : {id:data.user.id}
    },
    async rpc(name,args) { return await admin.rpc(name,args).abortSignal(AbortSignal.timeout(12000)) },
    dispatch:(id,trace)=>dispatchQueuedEmail(admin,resend,id,trace),
  }))
}
