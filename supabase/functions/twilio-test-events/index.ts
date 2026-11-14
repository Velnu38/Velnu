import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { twilioTestEventHandler } from './handler.ts'
const get=(key:string)=>Deno.env.get(key)||'',project=get('SUPABASE_URL')
const db=createClient(project||'https://invalid.supabase.co',get('SUPABASE_SERVICE_ROLE_KEY')||'not-configured',{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(twilioTestEventHandler({staging:resolveAppEnvironment(project)?.name==='staging',url:project+'/functions/v1/twilio-test-events',account:get('TWILIO_ACCOUNT_SID'),token:get('TWILIO_AUTH_TOKEN'),async record(args){const {data,error}=await db.rpc('record_integration_test_event',args).abortSignal(AbortSignal.timeout(8000));if(error)throw error;return data===true}}))
