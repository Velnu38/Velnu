/** One bounded provider attempt. No automatic retries of billable or side-effecting requests. */
export class ProviderRequestError extends Error {
  constructor(public readonly code: 'timeout' | 'network' | 'http' | 'invalid_response' | 'too_large', public readonly status = 0) {
    super('Provider request failed: ' + code)
    this.name = 'ProviderRequestError'
  }
}
export async function providerJson(url: string, init: RequestInit,
  options: { timeoutMs?: number; maxBytes?: number; fetcher?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? 45_000
  const maxBytes = options.maxBytes ?? 1_048_576
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Invalid provider request bounds')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      void reader?.cancel().catch(() => {})
      reject(new ProviderRequestError('timeout'))
    }, timeoutMs)
  })
  const attempt = (async () => {
    try {
      const response = await (options.fetcher ?? fetch)(url, { ...init, signal: controller.signal })
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {})
        throw new ProviderRequestError('timeout')
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        throw new ProviderRequestError('http', response.status)
      }
      if (Number(response.headers.get('content-length') || 0) > maxBytes) {
        void response.body?.cancel().catch(() => {})
        throw new ProviderRequestError('too_large')
      }
      if (!response.body) throw new ProviderRequestError('invalid_response')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let length = 0, text = ''
      while (true) {
        const chunk = await reader.read()
        if (controller.signal.aborted) throw new ProviderRequestError('timeout')
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > maxBytes) {
          void reader.cancel().catch(() => {})
          throw new ProviderRequestError('too_large')
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { throw new ProviderRequestError('invalid_response') }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderRequestError('invalid_response')
      return parsed as Record<string, unknown>
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error
      if (controller.signal.aborted) throw new ProviderRequestError('timeout')
      throw new ProviderRequestError('network')
    } finally {
      try { reader?.releaseLock() } catch { /* A cancelled read may still be settling. */ }
    }
  })()
  try { return await Promise.race([attempt, deadline]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
