/** Validate raw-body provider signatures. Never log payloads, signatures or keys. */
const enc = new TextEncoder()
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
const owned = (value: Uint8Array): ArrayBuffer => { const copy = new Uint8Array(value.length); copy.set(value); return copy.buffer }
export async function verifySignedEvent(provider: 'resend' | 'stripe', raw: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
 if (enc.encode(raw).length > 262144) return false
 let stamp = '', message = '', signatures: Uint8Array[] = [], keyBytes: Uint8Array
 try {
  if (provider === 'resend') {
   const id = headers.get('svix-id') || ''; stamp = headers.get('svix-timestamp') || ''
   if (!id || id.length > 200 || !secret.startsWith('whsec_')) return false
   keyBytes = bytes(secret.slice(6))
   signatures = (headers.get('svix-signature') || '').split(' ').filter(v => v.startsWith('v1,')).slice(0,5).map(v => bytes(v.slice(3)))
   message = id + '.' + stamp + '.' + raw
  } else {
   const parts = (headers.get('stripe-signature') || '').split(','); const times = parts.filter(v => v.startsWith('t='))
   if (times.length !== 1 || !secret.startsWith('whsec_')) return false
   stamp = times[0].slice(2); keyBytes = enc.encode(secret)
   signatures = parts.filter(v => /^v1=[0-9a-f]{64}$/.test(v)).slice(0,5).map(v => Uint8Array.from(v.slice(3).match(/../g)!, h => parseInt(h,16)))
   message = stamp + '.' + raw
  }
  if (!/^\d{1,13}$/.test(stamp) || !Number.isFinite(now) || Math.abs(now/1000 - Number(stamp)) > 300 || keyBytes.length < 16) return false
  const key = await crypto.subtle.importKey('raw', owned(keyBytes), {name:'HMAC',hash:'SHA-256'}, false, ['verify'])
  for (const signature of signatures) if (signature.length === 32 && await crypto.subtle.verify('HMAC', key, owned(signature), owned(enc.encode(message)))) return true
  return false
 } catch { return false }
}
export async function readLimitedRequest(req: Request, maxBytes = 262144): Promise<string> {
 if (Number(req.headers.get('content-length') || 0) > maxBytes) throw new Error('REQUEST_TOO_LARGE')
 if (!req.body) return ''
 const reader = req.body.getReader(), chunks: Uint8Array[] = []; let timer: ReturnType<typeof setTimeout> | undefined, size = 0
 try {
  return await Promise.race([
   (async () => {
    for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>maxBytes)throw new Error('REQUEST_TOO_LARGE'); chunks.push(value) }
    const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.byteLength}
    return new TextDecoder('utf-8',{fatal:true}).decode(all)
   })(), new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('REQUEST_TIMEOUT')),5000)})
  ])
 } finally { if(timer)clearTimeout(timer);void reader.cancel().catch(()=>{});chunks.length=0 }
}
