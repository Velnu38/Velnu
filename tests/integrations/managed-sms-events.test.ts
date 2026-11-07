import {test} from 'node:test'
import assert from 'node:assert/strict'
import {managedSmsEventHandler} from '../../supabase/functions/managed-sms-events/handler'
const url = 'https://example.test/functions/v1/managed-sms-events'
const account = 'AC' + 'a'.repeat(32)
const token = 'test-signing-token'
const id = '11111111-1111-4111-8111-111111111111'
const sid = 'SM' + 'b'.repeat(32)

async function signed(target: string, fields: Record<string, string>, sentFields = fields) {
 const payload = target + Object.keys(fields).sort().map(key => key + fields[key]).join('')
 const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const signature = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64')
 return new Request(target,{method:'POST',body:new URLSearchParams(sentFields),headers:{'x-twilio-signature':signature}})
}

test('managed SMS validates signatures, IDs, accounts, terminal and intermediate delivery states', async () => {
 const calls: unknown[] = []
 const handler = managedSmsEventHandler({url,account,token,record:async (...args)=>{calls.push(args);return true}})
 const callback = url + '?request_id=' + id
 const fields = {AccountSid:account,MessageSid:sid,MessageStatus:'accepted'}
 assert.equal((await handler(await signed(callback,fields))).status,200)
 assert.deepEqual(calls.shift(), ['finish_managed_sms',{p_request:id,p_status:'accepted',p_provider:sid}])
 for (const [value,state] of [['delivered','delivered'],['undelivered','failed'],['sent','accepted']]) {
  assert.equal((await handler(await signed(callback,{...fields,MessageStatus:value}))).status,200)
  assert.deepEqual(calls.shift(), ['finish_managed_sms',{p_request:id,p_status:state,p_provider:sid}])
 }
 assert.equal((await handler(await signed(callback,fields,{...fields,MessageStatus:'delivered'}))).status,401)
 assert.equal((await handler(await signed(callback,{...fields,MessageSid:''}))).status,400)
 assert.equal((await handler(await signed(callback,{...fields,AccountSid:'AC'+'c'.repeat(32)}))).status,401)
 assert.equal((await handler(await signed(url+'?request_id='+'a'.repeat(36),fields))).status,400)
 assert.equal(calls.length,0)
})

test('managed SMS stores valid inbound messages and requests retries only for write failures', async () => {
 const fields = {AccountSid:account,MessageSid:sid,From:'+17575550100',To:'+17575550101',Body:'STOP'}
 const calls: unknown[] = []
 const record = async (...args:unknown[])=>{calls.push(args);return false}
 const handler = managedSmsEventHandler({url,account,token,record})
 assert.equal((await handler(await signed(url,fields))).status,503)
 assert.deepEqual(calls.shift(), ['record_managed_sms_inbound',{p_from:fields.From,p_to:fields.To,p_body:'STOP',p_sid:sid}])
 assert.equal((await handler(await signed(url,{...fields,From:''}))).status,400)
 assert.equal((await handler(await signed(url,{...fields,Body:'x'.repeat(1601)}))).status,400)
 assert.equal((await handler(new Request(url,{method:'POST',body:'x'.repeat(17000)}))).status,400)
 assert.equal((await managedSmsEventHandler({url,account,token:'',record})(await signed(url,fields))).status,503)
 assert.equal(calls.length,0)
})
