import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { managedSmsEventHandler } from './handler.ts'

const env = (key: string) => Deno.env.get(key) || ''
const base = env('SUPABASE_URL')
const db = createClient(base, env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false, autoRefreshToken:false}})
Deno.serve(managedSmsEventHandler({
  url: base + '/functions/v1/managed-sms-events',
  account: env('TWILIO_ACCOUNT_SID'),
  token: env('TWILIO_AUTH_TOKEN'),
  async record(operation, input) {
    const {error} = await db.rpc(operation, input).abortSignal(AbortSignal.timeout(8000))
    return !error
  },
}))
