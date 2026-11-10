import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { AnalyzeExpenseCommand, TextractClient } from 'npm:@aws-sdk/client-textract@3.1164.0'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { receiptScanHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const environment = resolveAppEnvironment(url, Deno.env.get('FINVIANT_APP_BASE_URL'))
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const region = Deno.env.get('RECEIPT_AWS_REGION')
const accessKeyId = Deno.env.get('RECEIPT_AWS_ACCESS_KEY_ID')
const secretAccessKey = Deno.env.get('RECEIPT_AWS_SECRET_ACCESS_KEY')
const sessionToken = Deno.env.get('RECEIPT_AWS_SESSION_TOKEN')
const textract = region && accessKeyId && secretAccessKey
  ? new TextractClient({ region, credentials: { accessKeyId, secretAccessKey, sessionToken }, maxAttempts: 1 })
  : null

Deno.serve(environment ? receiptScanHandler({
  origins: environment.origins,
  async authorize(token) {
    const { data, error } = await admin.auth.getUser(token)
    return error ? null : data.user?.id || null
  },
  reserve: (business, request, actor) => Promise.resolve(admin.rpc('reserve_receipt_scan', { p_business: business, p_request: request, p_actor: actor })),
  analyze: textract ? bytes => textract.send(new AnalyzeExpenseCommand({ Document: { Bytes: bytes } }), { abortSignal: AbortSignal.timeout(15_000) }) : null,
}) : () => new Response('Environment is not configured', { status: 503 }))
