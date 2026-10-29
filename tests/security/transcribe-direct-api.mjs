/** Optional live staging verification. Requires two disposable QA users and server-seeded transcripts.
 * Never calls OpenAI. Missing fixtures are explicitly NOT RUN, never a pass. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const target=existsSync('scripts/qa/target.json') ? JSON.parse(readFileSync('scripts/qa/target.json')) : {projectRef:'xvybcmyoblfgzokaifsx',url:'https://xvybcmyoblfgzokaifsx.supabase.co',publishableKey:process.env.VOICE_QA_PUBLISHABLE_KEY}
assert.equal(target.projectRef,'xvybcmyoblfgzokaifsx')
assert.equal(target.url,'https://xvybcmyoblfgzokaifsx.supabase.co','Only the registered staging API may be tested')
const required=['VOICE_QA_OWNER_A_JWT','VOICE_QA_OWNER_B_JWT','VOICE_QA_BUSINESS_A','VOICE_QA_BUSINESS_B','VOICE_QA_TRANSCRIPT_A','VOICE_QA_TRANSCRIPT_B']
const result={scope:'live Supabase subscriber transcript isolation',status:'not_run',checks:[],errors:[],reason:''}
function save(){writeFileSync('VOICE_DIRECT_API_RESULTS.json',JSON.stringify(result,null,2)+'\n')}
if(!target.publishableKey || required.some(k=>!process.env[k])){result.reason='Requires two disposable authenticated staging QA accounts/businesses and server-seeded transcripts. No entitlement or OpenAI credential is needed for these Data API checks.';save();console.log(result.reason);process.exit(0)}
const jwtA=process.env.VOICE_QA_OWNER_A_JWT,jwtB=process.env.VOICE_QA_OWNER_B_JWT,ba=process.env.VOICE_QA_BUSINESS_A,bb=process.env.VOICE_QA_BUSINESS_B,ta=process.env.VOICE_QA_TRANSCRIPT_A,tb=process.env.VOICE_QA_TRANSCRIPT_B
async function call(path,jwt,init={}){return fetch(target.url+path,{...init,headers:{apikey:target.publishableKey,Authorization:'Bearer '+jwt,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(12000)})}
async function check(name,fn){try{await fn();result.checks.push({name,status:'pass'})}catch(e){result.errors.push({name,message:e.message});result.checks.push({name,status:'fail'})}}
const identityA=await call('/auth/v1/user',jwtA),identityB=await call('/auth/v1/user',jwtB);assert.equal(identityA.status,200);assert.equal(identityB.status,200)
const userA=(await identityA.json()).id,userB=(await identityB.json()).id;assert.notEqual(userA,userB);assert.notEqual(ba,bb)
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
for(const value of [userA,userB,ba,bb,ta,tb])assert.match(value,uuid,'QA fixture identifiers must be UUIDs')
for(const[id,jwt]of [[ba,jwtA],[bb,jwtB]]){const r=await call('/rest/v1/businesses?id=eq.'+id+'&select=id,name',jwt);assert.equal(r.status,200);const rows=await r.json();assert.equal(rows.length,1);assert.match(rows[0].name,/^QA[_ -]/,'Only disposable QA businesses may be used')}
for(const[id,business_id,user_id,jwt]of [[ta,ba,userA,jwtA],[tb,bb,userB,jwtB]]){const r=await call('/rest/v1/voice_transcriptions?id=eq.'+id+'&select=id,business_id,user_id',jwt);assert.equal(r.status,200);const rows=await r.json();assert.deepEqual(rows,[{id,business_id,user_id}],'Every mutation target must be a verified disposable QA transcript')}
for(const[title,jwt,own,foreign]of [['A',jwtA,ta,tb],['B',jwtB,tb,ta]]){
 await check(title+' can select own transcript',async()=>{const r=await call('/rest/v1/voice_transcriptions?id=eq.'+own+'&select=id',jwt);assert.equal(r.status,200);assert.equal((await r.json()).length,1)})
 await check(title+' cannot select other business transcript',async()=>{const r=await call('/rest/v1/voice_transcriptions?id=eq.'+foreign+'&select=id',jwt);assert.equal(r.status,200);assert.deepEqual(await r.json(),[])})
}
for(const[business_id,user_id]of [[ba,userA],[ba,userB],[bb,userA]])await check('subscriber cannot forge transcript '+business_id+':'+user_id,async()=>{const r=await call('/rest/v1/voice_transcriptions',jwtA,{method:'POST',body:JSON.stringify({id:randomUUID(),business_id,user_id,provider:'openai',model:'gpt-4o-transcribe',transcript:'QA FORGERY ATTEMPT'})});assert.ok([401,403].includes(r.status),'Forged write unexpectedly returned '+r.status)})
await check('subscriber cannot update stored transcript',async()=>{const r=await call('/rest/v1/voice_transcriptions?id=eq.'+ta,jwtA,{method:'PATCH',body:JSON.stringify({transcript:'QA FORGERY ATTEMPT'})});assert.ok([401,403].includes(r.status))})
await check('subscriber cannot delete stored transcript',async()=>{const r=await call('/rest/v1/voice_transcriptions?id=eq.'+ta,jwtA,{method:'DELETE'});assert.ok([401,403].includes(r.status))})
result.status=result.errors.length?'failed':'passed';save();if(result.errors.length)process.exitCode=1
