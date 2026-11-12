import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'

/** Real anonymous REST calls, using only the owned replay's synthetic invoice. */
export async function verifyPublicLinkAbuse(db,api,owner,business,invoice){
 assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(Number(db.connectionParameters.port),54322)
 const token=randomBytes(32).toString('hex')
 const prepared=await api('/rest/v1/rpc/prepare_personal_document',owner,{method:'POST',body:{p_business:business,p_kind:'invoice',p_document:invoice,p_token:token}})
 assert.equal(prepared.status,200)
 const read=()=>api('/rest/v1/rpc/get_shared_document',undefined,{method:'POST',body:{p_token:token}})
 // One request must work before saturating; validates the real binding and tenant lookup.
 const first=await read();assert.equal(first.status,200)
 const snapshot=await first.json();assert.ok(snapshot.document_id===invoice)
 const hash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') hash",[token])).rows[0].hash
 await db.query("update private.provider_burst_buckets set theoretical_at=clock_timestamp()+interval '60 seconds' where resource='public_link' and scope='actor' and subject=substring($1,1,32)::uuid",[hash])
 for(const response of await Promise.all([read(),read()])){
  assert.equal(response.status,429);assert.equal((await response.json()).code,'FINVIANT_BURST_LIMIT')
  assert.ok(Number(response.headers.get('retry-after'))>=1)
 }
 // Private manual record reads do not consume the public-link/provider limiter.
 const manual=await api('/rest/v1/invoices?id=eq.'+invoice+'&select=id,balance_due',owner)
 assert.equal(manual.status,200);assert.equal((await manual.json())[0].id,invoice)
 await db.query("update private.provider_burst_buckets set theoretical_at=clock_timestamp()-interval '1 minute' where resource='public_link' and scope='actor' and subject=substring($1,1,32)::uuid",[hash])
 const recovered=await read();assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),snapshot)
 await api('/rest/v1/rpc/revoke_document_share',owner,{method:'POST',body:{p_business:business,p_token:token}}).then(r=>assert.ok(r.ok))
 assert.ok([401,403].includes((await read()).status))
 return {anonymousRead:true,sharedTokenBurstDenied:true,retryAfter:true,cooldownRecovery:true,manualReadAvailable:true,revokedDenied:true}
}
