import {test} from 'node:test'
import assert from 'node:assert/strict'
import {personalEmailHref,personalSmsHref} from '../../src/lib/personalDelivery'
import {pcmDuration} from '../../supabase/functions/transcribe-voice/pcm'
import {documentSmsHandler,type SmsDependencies} from '../../supabase/functions/send-document-sms/handler'
test('personal drafts encode the exact recipient/body without header injection',()=>{
 const link=personalEmailHref('mike@example.test','Invoice & estimate','Review: https://finviant.test/?x=a&y=b\n$120')
 assert.equal(new URL(link).searchParams.get('body'),'Review: https://finviant.test/?x=a&y=b\n$120');assert.throws(()=>personalEmailHref('mike@example.test\r\nBcc:someone@example.test','Test','hello'))
 assert.match(personalSmsHref('+17575550123','Invoice & total: $120'),/^sms:\+17575550123/)
})
test('voice metering rejects forged headers, unsupported data and over-limit audio',()=>{
 assert.throws(()=>pcmDuration(new Uint8Array(80)));assert.throws(()=>pcmDuration(new Uint8Array(44+121*32000)),/two minutes/)
 const b=new Uint8Array(44+32000),v=new DataView(b.buffer);for(const[n,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)for(let i=0;i<s.length;i++)b[n+i]=s.charCodeAt(i)
 for(const[n,x]of [[4,b.length-8],[16,16],[24,16000],[28,32000],[40,32000]])v.setUint32(n,x,true)
 for(const[n,x]of [[20,1],[22,1],[32,2],[34,16]])v.setUint16(n,x,true)
 assert.equal(pcmDuration(b),1);v.setUint32(28,1,true);assert.throws(()=>pcmDuration(b),/verified PCM/)
})
test('managed SMS never retries an uncertain provider outcome and returns confirmed receipt once',async()=>{
 let sends=0,status='queued';const id='11111111-1111-4111-8111-111111111111',sid='SM'+'a'.repeat(32)
 const d:SmsDependencies={enabled:true,authorize:async()=>id,prepare:async()=>({id}),claim:async()=>status==='queued'?(status='sending',{id,status:'claimed',recipient:'+17575550123'}):({id,status,recipient:'+17575550123',provider_id:sid}),send:async()=>{sends++;throw Error('timeout')},finish:async(_id,s)=>{status=s}}
 const input={business_id:id,document_id:id,request_id:id,kind:'invoice',token:'a'.repeat(64),recipient:'+17575550123'},req=()=>new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(input)})
 const h=documentSmsHandler(d);assert.equal((await h(req())).status,502);assert.equal((await h(req())).status,409);assert.equal(sends,1)
 status='queued';d.send=async()=>{sends++;return{sid}};assert.equal((await h(req())).status,200);assert.equal((await h(req())).status,200);assert.equal(sends,2)
 d.enabled=false;assert.equal((await h(req())).status,503);assert.equal(sends,2)
})
