import {readLimitedBytes} from '../_shared/signedEvents.ts'
import {burstLimitResponse} from '../_shared/burstLimit.ts'
type Result = { error: { message: string; code?: string } | null }
type Dependencies = {
  origins: readonly string[]
  authorize: (header: string) => Promise<string | null>
  reserve: (actor: string, bucket: string, path: string, bytes: number) => Promise<Result>
  upload: (bucket: string, path: string, bytes: Uint8Array, type: string) => Promise<Result>
  finish: (bucket: string, path: string) => Promise<unknown>
}
export function attachmentHandler(deps: Dependencies) {
  return async (req: Request) => {
    const origin = req.headers.get('origin') || ''
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'Origin' }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !deps.origins.includes(origin)) return reply(403, { error: 'Origin not allowed.' })
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
    try {
      const actor = await deps.authorize(req.headers.get('authorization') || '')
      if (!actor) return reply(401, { error: 'Sign in to upload.' })
      const url = new URL(req.url), bucket = url.searchParams.get('bucket') || '', path = url.searchParams.get('path') || ''
      if (!['finviant-record-photos', 'velnu-business-logos'].includes(bucket) || path.length > 100) return reply(400, { error: 'Invalid upload destination.' })
      const type = req.headers.get('content-type') || ''
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return reply(400, { error: 'Choose a JPG, PNG or WebP image.' })
      const limit = bucket === 'velnu-business-logos' ? 2_000_000 : 10_000_000
      const bytes=await readLimitedBytes(req,limit),size=bytes.byteLength
      if(!size)return reply(400,{error:'Image is empty.'})
      const signature = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
        : new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP'
      if (!signature) return reply(400, { error: 'Image format does not match its file type.' })
      const reservation = await deps.reserve(actor, bucket, path, size)
      const limited=burstLimitResponse(reservation.error,headers);if(limited)return limited
      if (reservation.error) return reply(reservation.error.code === '42501' ? 403 : 409, { error: reservation.error.message })
      const result = await deps.upload(bucket, path, bytes, type)
      if (result.error) return reply(502, { error: 'Upload was not confirmed. Refresh your pictures. Storage remains reserved until this upload is reconciled; contact Help & Support if it stays pending.' })
      // A failed acknowledgement must not free bytes for an upload that could
      // have committed. Reservations have no unsafe automatic timeout.
      await deps.finish(bucket, path).catch(() => {})
      return reply(200, { path })
    } catch(error) {
      if(error instanceof Error&&error.message==='REQUEST_TOO_LARGE')return reply(413,{error:'Image exceeds the upload size limit.'})
      if(error instanceof Error&&error.message==='REQUEST_TIMEOUT')return reply(408,{error:'The image upload timed out. Try again.'})
      return reply(503, { error: 'Upload could not be confirmed. Refresh before retrying.' }) }
  }
}
