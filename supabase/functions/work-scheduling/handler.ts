import { readLimitedRequest } from '../_shared/signedEvents.ts'

export type SchedulingDependencies = {
  origin: string
  allowedOrigins: readonly string[]
  authorize: (authorization: string) => Promise<{ id: string } | null>
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>
  dispatch: (id: string, trace: string) => Promise<{ status: number; body: Record<string, unknown> }>
  emailEnabled: boolean
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function schedulingHandler(deps: SchedulingDependencies) {
  return async (req: Request) => {
    const origin = req.headers.get('origin') || '', trace = crypto.randomUUID()
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin', 'x-request-id': trace,
      ...(origin && deps.allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin } : {}) }
    const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify({ ...body, request_id: trace }), {status,headers})
    if (origin && !deps.allowedOrigins.includes(origin)) return reply(403,{error:'This app address is not authorized.'})
    if (req.method==='OPTIONS') return new Response('ok',{headers})
    if (req.method!=='POST') return reply(405,{error:'Method not allowed.'})
    try {
      const actor = await deps.authorize(req.headers.get('authorization') || '')
      if (!actor) return reply(401,{error:'Sign in to manage this job.'})
      let body: Record<string, unknown>
      try { body = JSON.parse(await readLimitedRequest(req,8192)) } catch { return reply(400,{error:'Invalid request.'}) }
      if (!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{error:'Invalid request.'})
      if (body.action==='complete' || body.action==='prepare_invoice') {
        if (!uuid.test(String(body.job_id || ''))) return reply(400,{error:'Choose a valid job.'})
        const {data,error}=await deps.rpc('complete_job_workflow',{p_job:body.job_id,p_actor:actor.id,p_retry_only:body.action==='prepare_invoice'})
        if(error || !data) return reply(error?.code==='42501'?403:409,{error:error?.message || 'This job could not be completed. Refresh and try again.'})
        return reply(200,data)
      }
      if(body.action!=='send_availability') return reply(400,{error:'Choose a valid scheduling action.'})
      if(!uuid.test(String(body.offer_id || '')) || !uuid.test(String(body.send_id || '')) || !/^[a-f0-9]{64}$/.test(String(body.token || '')) || body.approved!==true)
        return reply(400,{error:'Review the recipient and appointment options before approving this message.'})
      // Email configuration is checked before any outbox or provider side effect.
      if(!deps.emailEnabled) return reply(503,{error:'Customer email is awaiting verified delivery setup. No message was queued or sent.',code:'email_not_enabled'})
      const {data,error}=await deps.rpc('prepare_scheduling_email',{p_offer:body.offer_id,p_actor:actor.id,p_request:body.send_id,p_token:body.token,p_origin:deps.origin})
      if(error || !data) return reply(error?.code==='42501'?403:409,{error:error?.message || 'The scheduling message could not be prepared.'})
      const result=await deps.dispatch(data.id,trace)
      return reply(result.status,result.body)
    } catch {
      console.warn(JSON.stringify({service:'work-scheduling',request_id:trace,code:'request_failed'}))
      return reply(503,{error:'The result is not confirmed. Refresh the job or retry the same saved message.'})
    }
  }
}
