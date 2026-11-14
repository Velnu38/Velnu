import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'

// Caller supplies the newly created local-only API helpers and synthetic accounts.
// This exercises real Auth/RPC/Storage, not a hosted user's records or provider.
export async function verifyOwnerArchiveReplay({db,api,json,owner,outsider,office,business,service,sourceBytes}){
 assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(Number(db.connectionParameters.port),54322)
 const {assembleArchivePart}=await import('../../supabase/functions/owner-archive/assemble.ts')
 const id=randomUUID(),paths=[],digest=bytes=>createHash('sha256').update(bytes).digest('hex')
 const usage=async()=>(await db.query('select feature,used from private.tier_usage where business_id=$1 order by feature',[business])).rows
 const before=await usage();let count=0,files=0
 try{
  await db.query("update private.business_entitlements set plan='free',valid_until=now()-interval '1 day' where business_id=$1",[business])
  const begin={p_business:business,p_request:id}
  for(const token of [outsider.token,office.token])assert.equal((await api('/rest/v1/rpc/begin_owner_archive',token,{method:'POST',body:begin})).status,403)
  assert.equal(await json('/rest/v1/rpc/begin_owner_archive',owner.token,{method:'POST',body:begin}),id)
  assert.equal(await json('/rest/v1/rpc/begin_owner_archive',owner.token,{method:'POST',body:begin}),id)
  const args={p_business:business,p_archive:id}
  const initial=await json('/rest/v1/rpc/get_owner_archive',owner.token,{method:'POST',body:args})
  assert.equal(initial.file_count,1);assert.ok(initial.record_count>10);assert.ok(initial.part_count>=2)
  for(let i=0;i<initial.part_count;i++){
   const claim=await json('/rest/v1/rpc/claim_owner_archive_part',owner.token,{method:'POST',body:args})
   assert.equal(claim.archive_id,id);assert.equal(claim.business_id,business)
   const part=await assembleArchivePart(claim,async file=>{
    const response=await api('/storage/v1/object/'+file.bucket+'/'+file.path,owner.token);assert.ok(response.ok)
    const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(digest(bytes),digest(sourceBytes));files++;return bytes
   })
   const path=business+'/'+id+'/'+claim.part_no+'.zip';paths.push(path)
   const upload=await api('/storage/v1/object/finviant-owner-archives/'+path,service,{method:'POST',raw:part.bytes,headers:{'Content-Type':'application/zip'}})
   assert.ok(upload.ok,'Archive bytes must be stored privately')
   const finish={p_archive:id,p_part:claim.part_no,p_lease:claim.lease,p_sha256:part.sha256,p_bytes:part.bytes.length,p_entries:part.entries}
   assert.equal((await api('/rest/v1/rpc/finish_owner_archive_part',owner.token,{method:'POST',body:finish})).status,403)
   assert.equal((await api('/rest/v1/rpc/finish_owner_archive_part',service,{method:'POST',body:finish})).status,204)
   for(const token of [owner.token,outsider.token,office.token])assert.ok(!(await api('/storage/v1/object/finviant-owner-archives/'+path,token)).ok,'Copies require a fresh owner-authorized server download')
   const stored=await api('/storage/v1/object/finviant-owner-archives/'+path,service);assert.ok(stored.ok);assert.equal(digest(Buffer.from(await stored.arrayBuffer())),part.sha256)
   count++
  }
  const ready=await json('/rest/v1/rpc/get_owner_archive',owner.token,{method:'POST',body:args});assert.equal(ready.status,'ready');assert.equal(ready.ready_count,initial.part_count);assert.equal(files,1)
  for(const token of [outsider.token,office.token])assert.equal((await api('/rest/v1/rpc/owner_archive_download',token,{method:'POST',body:{...args,p_part:1}})).status,403)
  const context=await json('/rest/v1/rpc/owner_archive_download',owner.token,{method:'POST',body:{...args,p_part:1}});assert.equal(context.path,paths[0])
  await db.query("update private.owner_archives set expires_at=now()-interval '21 minutes' where id=$1",[id])
  assert.equal((await api('/rest/v1/rpc/owner_archive_download',owner.token,{method:'POST',body:{...args,p_part:1}})).status,403)
  const expired=await json('/rest/v1/rpc/expired_owner_archive_parts',service,{method:'POST',body:{}});assert.equal(expired.length,count)
  assert.ok((await api('/storage/v1/object/finviant-owner-archives',service,{method:'DELETE',body:{prefixes:paths}})).ok)
  assert.equal((await api('/rest/v1/rpc/remove_expired_owner_archive_parts',service,{method:'POST',body:{p_parts:expired}})).status,204)
  assert.equal(Number((await db.query('select count(*) from private.owner_archive_rows where archive_id=$1',[id])).rows[0].count),0)
  assert.deepEqual(await usage(),before,'Creating and downloading archives must not consume Fin allowance')
  return {parts:count,privateFileHashVerified:true,expiredFreeOwnerAccess:true,crossTenantAndStaffDenied:true,directObjectAccessDenied:true,expiryEnforced:true,copiesCleaned:true,noFinUsage:true}
 }finally{
  if(paths.length)assert.ok((await api('/storage/v1/object/finviant-owner-archives',service,{method:'DELETE',body:{prefixes:paths}})).ok)
  await db.query("update private.business_entitlements set plan='pro',valid_until=null where business_id=$1",[business])
 }
}
