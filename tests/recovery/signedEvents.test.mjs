import {test} from 'node:test'
import assert from 'node:assert/strict'
import {verifySignedEvent,readLimitedRequest} from '../../.recovery-build/signedEvents.js'
const enc=new TextEncoder(),now=1793126400000,stamp=String(now/1000),raw=JSON.stringify({type:'email.delivered',data:{email_id:'test'}})
const seed=new Uint8Array(32).fill(17),resendSecret='whsec_'+Buffer.from(seed).toString('base64'),stripeSecret='whsec_testing_only_not_a_real_key'
async function signed(provider,body=raw,time=stamp){
 const key=await crypto.subtle.importKey('raw',provider==='resend'?seed:enc.encode(stripeSecret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const text=provider==='resend'?'evt_test.'+time+'.'+body:time+'.'+body
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,enc.encode(text)))
 return provider==='resend'?new Headers({'svix-id':'evt_test','svix-timestamp':time,'svix-signature':'v1,'+sig.toString('base64')}):new Headers({'stripe-signature':'t='+time+',v1='+sig.toString('hex')})
}
for(const provider of ['resend','stripe']){
 const secret=provider==='resend'?resendSecret:stripeSecret
 test(provider+' verifies exact signed bytes',async()=>assert.equal(await verifySignedEvent(provider,raw,await signed(provider),secret,now),true))
 test(provider+' rejects changed body',async()=>assert.equal(await verifySignedEvent(provider,raw+' ',await signed(provider),secret,now),false))
 test(provider+' rejects wrong secret',async()=>assert.equal(await verifySignedEvent(provider,raw,await signed(provider),secret+'bad',now),false))
 test(provider+' rejects expired events',async()=>assert.equal(await verifySignedEvent(provider,raw,await signed(provider,raw,String(now/1000-301)),secret,now),false))
 test(provider+' rejects future timestamps',async()=>assert.equal(await verifySignedEvent(provider,raw,await signed(provider,raw,String(now/1000+301)),secret,now),false))
 test(provider+' rejects missing signature',async()=>assert.equal(await verifySignedEvent(provider,raw,new Headers(),secret,now),false))
 test(provider+' rejects oversized body',async()=>assert.equal(await verifySignedEvent(provider,'x'.repeat(262145),await signed(provider),secret,now),false))
 test(provider+' 1000 tampered payloads never verify',async()=>{const headers=await signed(provider);for(let n=0;n<1000;n++)assert.equal(await verifySignedEvent(provider,raw+n,headers,secret,now),false)})
}
test('body reader counts streamed bytes without Content-Length',async()=>{const req=new Request('https://test.invalid',{method:'POST',body:'x'.repeat(101)});await assert.rejects(()=>readLimitedRequest(req,100),/REQUEST_TOO_LARGE/)})
test('body reader returns exact UTF-8 text',async()=>assert.equal(await readLimitedRequest(new Request('https://test.invalid',{method:'POST',body:'Invoice £100'})),'Invoice £100'))
