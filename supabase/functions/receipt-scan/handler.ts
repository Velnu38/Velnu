import { receiptDraft } from './receipt.ts'

type Dependencies = {
  origins: readonly string[]
  authorize: (bearer: string) => Promise<string | null>
  reserve: (business: string, request: string, actor: string) => Promise<{ error: { code?: string; message: string } | null }>
  analyze: ((bytes: Uint8Array) => Promise<Parameters<typeof receiptDraft>[0]>) | null
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const limit = 5_000_000

export function receiptScanHandler(deps: Dependencies) {
  return async (req: Request) => {
    const origin = req.headers.get('origin') || ''
    const headers = {
      'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', vary: 'Origin',
    }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !deps.origins.includes(origin)) return reply(403, { error: 'Origin not allowed.' })
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
    const bearer = req.headers.get('authorization') || ''
    try {
      const actor = bearer.startsWith('Bearer ') ? await deps.authorize(bearer.slice(7)) : null
      if (!actor) return reply(401, { error: 'Sign in to scan a receipt.' })
      const query = new URL(req.url).searchParams
      const business = query.get('business') || '', request = query.get('request') || ''
      if (!uuid.test(business) || !uuid.test(request)) return reply(400, { error: 'Invalid receipt request.' })
      if (!deps.analyze) return reply(503, { error: 'Automatic receipt reading is awaiting setup. You can enter the details and save the photo.' })
      const reader = req.body?.getReader()
      if (req.headers.get('content-type') !== 'image/jpeg' || !reader) return reply(400, { error: 'Choose a receipt image.' })
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > limit) { await reader.cancel(); return reply(413, { error: 'Choose a receipt image smaller than 5 MB.' }) }
          chunks.push(next.value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return reply(400, { error: 'This receipt photo could not be opened.' })
      const { error } = await deps.reserve(business, request, actor)
      if (error) {
        if (error.code === '42501') return reply(403, { error: error.message })
        if (error.code === '23505') return reply(409, { error: error.message })
        if (error.code === '23514') return reply(429, { error: error.message })
        return reply(503, { error: 'Unable to check receipt scan availability. You can still save the photo with a manual entry.' })
      }
      const scan = await deps.analyze(bytes)
      return reply(200, receiptDraft(scan))
    } catch (error) {
      // The provider error body may contain receipt details. Log only the error type.
      console.warn('receipt scan failed', error instanceof Error ? error.name : 'Unknown')
      return reply(503, { error: 'Unable to read the receipt. You can enter the details and save the photo.' })
    }
  }
}
