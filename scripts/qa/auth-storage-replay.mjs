import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'

export function localApiOrigin(value){
 const url=new URL(value)
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='54321'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Auth/Storage replay requires the owned local API on 127.0.0.1:54321')
 return url.origin
}

// Only receives keys produced by the newly started disposable Supabase CLI.
// Never returns/logs identities, passwords, JWTs, signed URLs or object contents.
export async function verifyAuthStorageReplay(db,status){
 const origin=localApiOrigin(status.API_URL)
 assert.equal(db.connectionParameters.host,'127.0.0.1')
 assert.equal(Number(db.connectionParameters.port),54322)
 assert.ok(status.ANON_KEY&&status.SERVICE_ROLE_KEY,'Disposable API keys are required')
 const before=(await db.query('select (select count(*) from auth.users)::int users,(select count(*) from public.businesses)::int businesses,(select count(*) from storage.objects)::int files')).rows[0]
 assert.deepEqual(before,{users:0,businesses:0,files:0})
 const actors=[],businessA=randomUUID(),businessB=randomUUID(),customer=randomUUID(),request=randomUUID()
 let photoPath,phase='password-sessions'
 async function api(path,token=status.ANON_KEY,{method='GET',body,headers={}}={}){
  assert.ok(path.startsWith('/')&&!path.startsWith('//'))
  const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)})
  return response
 }
 async function json(path,token,options){
  const response=await api(path,token,options)
  if(!response.ok)throw Object.assign(Error('Disposable API operation failed'),{httpStatus:response.status})
  return response.json()
 }
 async function actor(label){
  const email='replay-'+label+'-'+randomUUID()+'@example.test',password=randomBytes(24).toString('base64url')
  const created=await json('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{method:'POST',body:{email,password,email_confirm:true}})
  const id=created.id??created.user?.id;assert.match(id,/^[a-f0-9-]{36}$/)
  const entry={id,token:null};actors.push(entry)
  const session=await json('/auth/v1/token?grant_type=password',status.ANON_KEY,{method:'POST',body:{email,password}})
  assert.equal(session.user.id,id);assert.ok(session.access_token);entry.token=session.access_token
  const confirmed=await json('/auth/v1/user',entry.token);assert.equal(confirmed.id,id)
  return entry
 }
 const digest=value=>createHash('sha256').update(value).digest('hex')
 try{
  const owner=await actor('owner'),outsider=await actor('other'),office=await actor('office')
  phase='tenant-fixtures'
  await db.query('begin')
  for(const user of actors)await db.query("insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values($1,'2026-11-06-v5',true,true,true)",[user.id])
  for(const [business,user] of [[businessA,owner],[businessB,outsider]]){
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id])
   await db.query("insert into public.businesses(id,name,created_by_user_id) values($1,'Synthetic authenticated replay',$2)",[business,user.id])
   await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro') on conflict(business_id) do update set plan='pro',valid_until=null",[business])
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner.id])
  await db.query("insert into public.business_members(business_id,user_id,role,access_modules) values($1,$2,'office',array['jobs','billing','calendar','finances'])",[businessA,office.id])
  await db.query('commit')
  // PostgREST needs the schema after the complete application replay.
  await db.query("notify pgrst,'reload schema'")
  for(let i=0;i<40;i++){
   const response=await api('/rest/v1/customers?select=id&limit=0',owner.token)
   if(response.ok)break
   if(i===39)throw Error('Disposable API schema did not reload')
   await new Promise(resolve=>setTimeout(resolve,250))
  }
  phase='authorized-rest'
  const rows=await json('/rest/v1/customers',owner.token,{method:'POST',headers:{Prefer:'return=representation'},body:{id:customer,business_id:businessA,first_name:'Synthetic',last_name:'Customer'}})
  assert.equal(rows[0].id,customer)
  const payload={target_business_id:businessA,document_kind:'invoice',request_id:request,payload:{customer_id:customer,items:[{description:'Synthetic work',quantity:2,unit_price:50,tax_rate:5}]}}
  const invoice=await json('/rest/v1/rpc/create_document',owner.token,{method:'POST',body:payload})
  assert.equal(Number(invoice.total),105)
  assert.equal((await json('/rest/v1/rpc/create_document',owner.token,{method:'POST',body:payload})).id,invoice.id)
  assert.deepEqual(await json('/rest/v1/invoices?select=id&business_id=eq.'+businessA,outsider.token),[])
  const forged=await api('/rest/v1/rpc/create_document',outsider.token,{method:'POST',body:{...payload,request_id:randomUUID()}});assert.equal(forged.status,403)
  assert.equal((await json('/rest/v1/invoices?select=id&business_id=eq.'+businessA,office.token)).length,1)
  phase='private-storage'
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGdEAAAAASUVORK5CYII=','base64')
  phase='file-metadata'
  const photo=await json('/rest/v1/record_photos',owner.token,{method:'POST',headers:{Prefer:'return=representation'},body:{business_id:businessA,invoice_id:invoice.id,file_name:'synthetic.png',byte_size:png.length,media_type:'image/png'}})
  photoPath=photo[0].storage_path
  assert.ok(photoPath.startsWith(businessA+'/'))
  const object='/storage/v1/object/finviant-record-photos/'+photoPath
  phase='blocked-direct-upload'
  const uploadFile=token=>fetch(origin+object,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'image/png'},body:png})
  assert.ok(!(await uploadFile(owner.token)).ok,'Direct uploads must not bypass the server quota path')
  phase='quota-reservation'
  const reservation={p_actor:owner.id,p_bucket:'finviant-record-photos',p_path:photoPath,p_bytes:png.length}
  assert.ok(!(await api('/rest/v1/rpc/reserve_attachment',owner.token,{method:'POST',body:reservation})).ok,'Client must not impersonate a server upload reservation')
  const reserve=await api('/rest/v1/rpc/reserve_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:reservation});assert.equal(reserve.status,204)
  phase='private-storage-upload'
  const upload=await uploadFile(status.SERVICE_ROLE_KEY);assert.ok(upload.ok,'Quota-reserved server upload must succeed')
  const finish=await api('/rest/v1/rpc/finish_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_bucket:'finviant-record-photos',p_path:photoPath}});assert.equal(finish.status,204)
  phase='private-storage-download'
  const downloaded=await api(object,owner.token);assert.ok(downloaded.ok);assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())),digest(png))
  for(const token of [outsider.token,status.ANON_KEY])assert.ok(!(await api(object,token)).ok,'Unrelated or anonymous identity must not read private bytes')
  const otherSign=await api('/storage/v1/object/sign/finviant-record-photos/'+photoPath,outsider.token,{method:'POST',body:{expiresIn:60}});assert.ok(!otherSign.ok)
  phase='access-revocation'
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner.id])
  await db.query("update public.business_members set access_modules=array['jobs'] where business_id=$1 and user_id=$2",[businessA,office.id])
  assert.deepEqual(await json('/rest/v1/invoices?select=id&business_id=eq.'+businessA,office.token),[])
  assert.ok(!(await api(object,office.token)).ok,'Revoked billing access must not read invoice files with the existing session')
  await db.query('delete from public.business_members where business_id=$1 and user_id=$2',[businessA,office.id])
  assert.deepEqual(await json('/rest/v1/customers?select=id&business_id=eq.'+businessA,office.token),[])
  return {genuinePasswordSessions:3,ownerInvoiceRetry:true,crossTenantReadWriteDenied:true,directUploadBypassDenied:true,serverQuotaReservation:true,privateFileHashVerified:true,anonymousFileDenied:true,foreignSigningDenied:true,moduleRevocation:true,membershipRevocation:true}
 }catch(error){
  console.error(JSON.stringify({phase:'auth-storage-'+phase,errorCode:/^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/.test(error.code??'')?error.code:'unknown',...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{})}))
  throw Error('Genuine Auth/Storage replay failed at '+phase)
 }finally{
  await db.query('rollback')
  // End the fixture's owner impersonation before owned-container maintenance.
  // Keep the real application ownership-transfer guard fully enabled.
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)")
  if(photoPath){const removed=await api('/storage/v1/object/finviant-record-photos',status.SERVICE_ROLE_KEY,{method:'DELETE',body:{prefixes:[photoPath]}});if(!removed.ok)throw Error('Disposable Storage cleanup failed')}
  for(const business of [businessA,businessB]){
   for(const table of ['record_photos','invoice_items','invoices','appointments','jobs','customers'])await db.query('delete from public.'+table+' where business_id=$1',[business])
   await db.query('delete from public.businesses where id=$1',[business])
  }
  for(const actor of actors){const removed=await api('/auth/v1/admin/users/'+actor.id,status.SERVICE_ROLE_KEY,{method:'DELETE'});if(!removed.ok)throw Error('Disposable Auth cleanup failed')}
 }
}
