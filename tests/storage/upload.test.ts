import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentHandler } from '../../supabase/functions/upload-attachment/handler.ts'
const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg'
test('upload: authenticate, reject spoofed/oversized images before reservation, measure actual bytes and preserve uncertain quota',async()=>{
 const calls:string[]=[];let allowed=true,fail=false,quota=false
 const handler=attachmentHandler({origins:['https://finviant.com'],authorize:async()=>allowed?'user':null,
  reserve:async(_u,_b,_p,size)=>{calls.push('reserve:'+size);return {error:quota?{message:'Storage full'}:null}},
  upload:async()=>{calls.push('upload');return {error:fail?{message:'lost response'}:null}},
  finish:async()=>{calls.push('finish')}})
 const send=(bytes:Uint8Array)=>handler(new Request(`https://example.test/upload?bucket=finviant-record-photos&path=${path}`,{method:'POST',headers:{'content-type':'image/jpeg',origin:'https://finviant.com'},body:bytes}))
 allowed=false;assert.equal((await send(new Uint8Array([255,216,255]))).status,401);allowed=true
 assert.equal((await send(new Uint8Array([1,2,3]))).status,400)
 assert.equal((await send(new Uint8Array(10_000_001))).status,413);assert.equal(calls.length,0)
 assert.equal((await send(new Uint8Array([255,216,255]))).status,200);assert.deepEqual(calls,['reserve:3','upload','finish'])
 calls.length=0;fail=true
 assert.equal((await send(new Uint8Array([255,216,255]))).status,502);assert.deepEqual(calls,['reserve:3','upload'])
 calls.length=0;quota=true
 assert.equal((await send(new Uint8Array([255,216,255]))).status,409);assert.deepEqual(calls,['reserve:3'])
})
