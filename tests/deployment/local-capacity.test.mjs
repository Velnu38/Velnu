import test from 'node:test'
import assert from 'node:assert/strict'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {CAPACITY_LIMITS,ownedRestContainer,summarize,fixturePng} from '../../scripts/qa/local-capacity.mjs'
test('capacity permits only a uniquely owned disposable REST service and bounded workload',()=>{
 assert.equal(ownedRestContainer('finviant-replay-a0b1c2d3'),'supabase_rest_finviant-replay-a0b1c2d3')
 for(const id of ['xvybcmyoblfgzokaifsx','ocmlvzkackufwpwnnsdb','--all','finviant-replay-12345678;restart','finviant-replay-123456789'])assert.throws(()=>ownedRestContainer(id))
 assert.equal(CAPACITY_LIMITS.tenants,300);assert.equal(CAPACITY_LIMITS.soakSeconds,3600);assert.ok(CAPACITY_LIMITS.requestCeiling<300000);assert.ok(CAPACITY_LIMITS.requestsPerSecond<=50)
})
test('long soak statistics stay bounded and retain errors and high percentiles',()=>{
 const rows=Array.from({length:200000},(_,i)=>({ms:i%1000,bytes:10,ok:i%10000!==0}))
 const result=summarize(rows);assert.equal(result.requests,200000);assert.equal(result.errors,20);assert.equal(result.p50Ms,499);assert.equal(result.p95Ms,949);assert.equal(result.p99Ms,989);assert.equal(result.maxMs,999);assert.equal(result.bytes,2000000)
 assert.deepEqual(summarize([]),{requests:0,errors:0,p50Ms:0,p95Ms:0,p99Ms:0,maxMs:0,bytes:0})
})
test('capacity attachment is a deterministic valid-size PNG containing real image data',()=>{
 const bytes=fixturePng();assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(bytes.length>750000&&bytes.length<800000)
 assert.equal(bytes.readUInt32BE(16),512);assert.equal(bytes.readUInt32BE(20),512)
 let offset=8,data=[];while(offset<bytes.length){const size=bytes.readUInt32BE(offset),name=bytes.subarray(offset+4,offset+8).toString();if(name==='IDAT')data.push(bytes.subarray(offset+8,offset+8+size));offset+=size+12}
 assert.equal(offset,bytes.length);assert.equal(inflateSync(Buffer.concat(data)).length,512*(512*3+1));assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(fixturePng()).digest('hex'))
})
