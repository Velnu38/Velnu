import { verifyTwilioSignature } from '../twilio-test-events/handler.ts'
import { readLimitedRequest } from '../_shared/signedEvents.ts'

type Dependencies = {
  url: string
  account: string
  token: string
  record: (operation: 'finish_managed_sms' | 'record_managed_sms_inbound', input: Record<string, unknown>) => Promise<boolean>
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const messageSid = /^SM[0-9a-f]{32}$/i
const statuses = new Map([
  ['accepted', 'accepted'], ['queued', 'accepted'], ['sending', 'accepted'], ['sent', 'accepted'],
  ['delivered', 'delivered'], ['failed', 'failed'], ['undelivered', 'failed'],
])
const phone = /^\+1[0-9]{10}$/

export function managedSmsEventHandler({url, account, token, record}: Dependencies) {
  return async (request: Request) => {
    const reply = (status: number) => new Response(
      status === 200 ? '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' : 'Request rejected',
      {status, headers: {'content-type': 'text/xml', 'cache-control': 'no-store'}},
    )
    if (request.method !== 'POST') return reply(405)
    if (!token || !account) return reply(503)

    const query = new URL(request.url).searchParams
    const id = query.get('request_id')
    if (query.size !== (id ? 1 : 0) || (id && !uuid.test(id))) return reply(400)
    let params: URLSearchParams
    try {
      params = new URLSearchParams(await readLimitedRequest(request, 16384))
    } catch {
      return reply(400)
    }

    const canonical = url + (id ? '?request_id=' + id : '')
    if (!await verifyTwilioSignature(canonical, params, request.headers.get('x-twilio-signature') || '', token) || params.get('AccountSid') !== account) {
      return reply(401)
    }
    const sid = params.get('MessageSid') || ''
    if (!messageSid.test(sid)) return reply(400)

    try {
      if (id) {
        const status = statuses.get(params.get('MessageStatus') || '')
        if (!status) return reply(400)
        return reply(await record('finish_managed_sms', {p_request:id, p_status:status, p_provider:sid}) ? 200 : 503)
      }
      const from = params.get('From') || '', to = params.get('To') || '', body = params.get('Body') || ''
      if (!phone.test(from) || !phone.test(to) || [...body].length > 1600) return reply(400)
      return reply(await record('record_managed_sms_inbound', {p_from:from, p_to:to, p_body:body, p_sid:sid}) ? 200 : 503)
    } catch {
      return reply(503)
    }
  }
}
