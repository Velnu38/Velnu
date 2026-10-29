import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerJson, ProviderRequestError } from '../../.recovery-build/providerRequest.js'
const url = 'https://provider.invalid/not-a-live-endpoint'
const good = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
const errorCode = code => err => err instanceof ProviderRequestError && err.code === code

test('valid JSON returns the response without retry', async () => {
  let n = 0
  assert.deepEqual(await providerJson(url, { method: 'POST' }, { fetcher: async () => { n++; return good() } }), { ok: true })
  assert.equal(n, 1)
})
for (const status of [400,401,403,408,409,429,500,502,503,504]) {
  test('provider HTTP '+status+' is sanitized and never automatically retried', async () => {
    let n=0
    await assert.rejects(providerJson(url, {}, { fetcher: async () => { n++; return new Response('PRIVATE_PROVIDER_DETAIL', {status}) } }), e => e instanceof ProviderRequestError && e.code==='http' && e.status===status && !e.message.includes('PRIVATE'))
    assert.equal(n,1)
  })
}
for (const value of ['', 'not JSON', '<html>Gateway error</html>', 'null','[]','true','12','"text"']) {
  test('malformed or non-object JSON is rejected: '+JSON.stringify(value), async () => {
    await assert.rejects(providerJson(url, {}, { fetcher: async () => new Response(value) }), errorCode('invalid_response'))
  })
}
test('DNS/network failure is sanitized', async () => {
  await assert.rejects(providerJson(url, {}, { fetcher: async () => { throw new Error('SECRET_TOKEN') } }), errorCode('network'))
})
test('headers timeout aborts one request', async () => {
  let n=0, aborted=false
  const fetcher=async (_url,init)=>{ n++; init.signal.addEventListener('abort',()=>{aborted=true}); return await new Promise(()=>{}) }
  await assert.rejects(providerJson(url, {}, {fetcher,timeoutMs:10}), errorCode('timeout'))
  assert.equal(n,1); assert.equal(aborted,true)
})
test('body stall is covered by the same deadline', async () => {
  let cancelled=false
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"half":'));},cancel(){cancelled=true}})
  await assert.rejects(providerJson(url, {}, { fetcher: async()=>new Response(body),timeoutMs:10 }),errorCode('timeout'))
  assert.equal(cancelled,true)
})
test('declared oversized responses are rejected and cancelled', async()=>{
  let cancelled=false
  const body=new ReadableStream({cancel(){cancelled=true}})
  await assert.rejects(providerJson(url,{}, {fetcher:async()=>new Response(body,{headers:{'content-length':'9999'}}), maxBytes:20}),errorCode('too_large'))
  assert.equal(cancelled,true)
})
test('streaming size limit works without Content-Length',async()=>{
  await assert.rejects(providerJson(url,{}, {fetcher:async()=>new Response('{"text":"'+ 'a'.repeat(100)+'"}'),maxBytes:20}),errorCode('too_large'))
})
test('utf8 split across chunks is decoded correctly',async()=>{
  const bytes=new TextEncoder().encode('{"text":"café"}')
  const body=new ReadableStream({start(c){ for(const b of bytes)c.enqueue(new Uint8Array([b])); c.close() }})
  assert.deepEqual(await providerJson(url,{}, {fetcher:async()=>new Response(body)}),{text:'café'})
})
test('parallel failures remain isolated and bounded (200 inputs)',async()=>{
  const results=await Promise.all(Array.from({length:200},async(_,i)=>{
    let calls=0
    const fetcher=async()=>{calls++; return i%2 ? good():new Response('no',{status:503})}
    try { await providerJson(url,{}, {fetcher}); return calls===1 && i%2===1 }
    catch(e){return calls===1 && i%2===0 && e.code==='http'}
  }))
  assert.equal(results.every(Boolean),true)
})
test('1000 bounded JSON input cases do not escape or retry failures',async()=>{
  let attempts=0
  for(let i=0;i<1000;i++){
    const valid=i%4===0
    const value=valid?JSON.stringify({request:i,text:'x'.repeat(i%100)}):['{','null','[]'][i%3]
    const fetcher=async()=>{attempts++;return new Response(value)}
    if(valid) assert.equal((await providerJson(url,{}, {fetcher})).request,i)
    else await assert.rejects(providerJson(url,{}, {fetcher}),errorCode('invalid_response'))
  }
  assert.equal(attempts,1000)
})
