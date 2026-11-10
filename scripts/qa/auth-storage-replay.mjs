import {verifyOwnerArchiveReplay} from './owner-archive-replay.mjs'
import assert from 'node:assert/strict'
import {createHash,randomBytes,randomUUID} from 'node:crypto'

export function localApiOrigin(value){
 const url=new URL(value)
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='54321'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Auth/Storage replay requires the owned local API on 127.0.0.1:54321')
 return url.origin
}

// Only receives keys produced by the newly started disposable Supabase CLI.
// Never returns/logs identities, passwords, JWTs, signed URLs or object contents.
export async function verifyAuthStorageReplay(db,status,restoreDrill,cleanupFixture){
 const origin=localApiOrigin(status.API_URL)
 assert.equal(db.connectionParameters.host,'127.0.0.1')
 assert.equal(Number(db.connectionParameters.port),54322)
 assert.ok(status.ANON_KEY&&status.SERVICE_ROLE_KEY,'Disposable API keys are required')
 const before=(await db.query('select (select count(*) from auth.users)::int users,(select count(*) from public.businesses)::int businesses,(select count(*) from storage.objects)::int files')).rows[0]
 assert.deepEqual(before,{users:0,businesses:0,files:0})
 const actors=[],businessA=randomUUID(),businessB=randomUUID(),customer=randomUUID(),request=randomUUID()
 let photoPath,phase='password-sessions'
 async function api(path,token=status.ANON_KEY,{method='GET',body,raw,headers={}}={}){
  assert.ok(path.startsWith('/')&&!path.startsWith('//'))
  const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))})
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
  entry.login=async()=>{
   const session=await json('/auth/v1/token?grant_type=password',status.ANON_KEY,{method:'POST',body:{email,password}})
   assert.equal(session.user.id,id);assert.ok(session.access_token);entry.token=session.access_token
  }
  await entry.login()
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
  const uploadFile=(token,bytes=png)=>fetch(origin+object,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'image/png'},body:bytes})
  assert.ok(!(await uploadFile(owner.token)).ok,'Direct uploads must not bypass the server quota path')
  phase='quota-reservation'
  const reservation={p_actor:owner.id,p_bucket:'finviant-record-photos',p_path:photoPath,p_bytes:png.length}
  assert.ok(!(await api('/rest/v1/rpc/reserve_attachment',owner.token,{method:'POST',body:reservation})).ok,'Client must not impersonate a server upload reservation')
  const reserve=await api('/rest/v1/rpc/reserve_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:reservation});assert.equal(reserve.status,204)
  phase='private-storage-upload'
  const upload=await uploadFile(status.SERVICE_ROLE_KEY);assert.ok(upload.ok,'Quota-reserved server upload must succeed')
  const finish=await api('/rest/v1/rpc/finish_attachment',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_bucket:'finviant-record-photos',p_path:photoPath}});assert.equal(finish.status,204)
  phase='private-storage-download'
  const downloaded=await api(object,owner.token);assert.ok(downloaded.ok)
  const backedUpFile=Buffer.from(await downloaded.arrayBuffer());assert.equal(digest(backedUpFile),digest(png))
  for(const token of [outsider.token,status.ANON_KEY])assert.ok(!(await api(object,token)).ok,'Unrelated or anonymous identity must not read private bytes')
  const otherSign=await api('/storage/v1/object/sign/finviant-record-photos/'+photoPath,outsider.token,{method:'POST',body:{expiresIn:60}});assert.ok(!otherSign.ok)
  phase='synthetic-recovery-fixtures'
  // Include a real receivable/payment, estimate-derived job and roster records.
  await json('/rest/v1/invoices?id=eq.'+invoice.id,owner.token,{method:'PATCH',headers:{Prefer:'return=representation'},body:{status:'sent'}})
  const payment={target_business_id:businessA,invoice_id:invoice.id,request_id:randomUUID(),payment_amount:30,payment_method:'cash',payment_note:'Synthetic restore fixture'}
  await json('/rest/v1/rpc/record_manual_payment',owner.token,{method:'POST',body:payment})
  await json('/rest/v1/rpc/record_manual_payment',owner.token,{method:'POST',body:payment})
  const estimate=await json('/rest/v1/rpc/create_document',owner.token,{method:'POST',body:{...payload,document_kind:'estimate',request_id:randomUUID()}})
  await json('/rest/v1/estimates?id=eq.'+estimate.id,owner.token,{method:'PATCH',headers:{Prefer:'return=representation'},body:{status:'accepted'}})
  const worker=randomUUID()
  const workerResponse=await api('/rest/v1/rpc/save_worker_profile',owner.token,{method:'POST',body:{p_business:businessA,p_id:worker,p_input:{name:'Synthetic restore worker',active:true},p_expected:null}})
  assert.ok(workerResponse.ok)
  const jobs=await json('/rest/v1/jobs?select=id&source_estimate_id=eq.'+estimate.id,owner.token);assert.equal(jobs.length,1)
  phase='bounded-job-directory'
  const directoryArgs={p_business:businessA,p_filter:'all',p_search:'',p_page:0}
  const directory=await json('/rest/v1/rpc/get_job_directory_page',owner.token,{method:'POST',body:directoryArgs})
  assert.equal(directory.total,1);assert.equal(directory.counts.active,1);assert.equal(directory.items[0].id,jobs[0].id);assert.equal(directory.page_size,25)
  for(const token of [outsider.token,status.ANON_KEY])assert.ok(!(await api('/rest/v1/rpc/get_job_directory_page',token,{method:'POST',body:directoryArgs})).ok)
  assert.equal((await json('/rest/v1/rpc/get_job_directory_page',owner.token,{method:'POST',body:{...directoryArgs,p_customer:randomUUID()}})).total,0)
  await json('/rest/v1/rpc/manage_job_workspace',owner.token,{method:'POST',body:{p_business:businessA,p_job:jobs[0].id,p_action:'add_task',p_payload:{id:randomUUID(),title:'Synthetic restoration checklist',worker_id:worker}}})
  await json('/rest/v1/rpc/manage_job_workspace',owner.token,{method:'POST',body:{p_business:businessA,p_job:jobs[0].id,p_action:'add_time',p_payload:{request_id:randomUUID(),worked_on:'2026-11-10',minutes:60,hourly_cost:25,worker_id:worker,note:'Synthetic reviewed recovery fixture'}}})
  let recovery
  if(restoreDrill){
   phase='synthetic-restore'
   recovery=await restoreDrill({expectedUsers:actors.map(a=>a.id),expectedBusinesses:[businessA,businessB],
    removeFile:async()=>{const r=await api('/storage/v1/object/finviant-record-photos',status.SERVICE_ROLE_KEY,{method:'DELETE',body:{prefixes:[photoPath]}});assert.ok(r.ok);assert.ok(!(await api(object,owner.token)).ok)},
    restoreFile:async()=>{for(const actor of actors)await actor.login();assert.ok((await uploadFile(status.SERVICE_ROLE_KEY,backedUpFile)).ok)},
    verifyFile:async()=>{
     const r=await api(object,owner.token);assert.ok(r.ok);assert.equal(digest(Buffer.from(await r.arrayBuffer())),digest(png))
     for(const token of [outsider.token,status.ANON_KEY])assert.ok(!(await api(object,token)).ok)
     const balance=await json('/rest/v1/invoices?select=total,amount_paid,balance_due&id=eq.'+invoice.id,owner.token)
     assert.deepEqual(balance.map(r=>[Number(r.total),Number(r.amount_paid),Number(r.balance_due)]),[[105,30,75]])
     assert.equal((await json('/rest/v1/payments?select=id&invoice_id=eq.'+invoice.id,owner.token)).length,1)
     assert.deepEqual(await json('/rest/v1/invoices?select=id&business_id=eq.'+businessA,outsider.token),[])
     assert.equal((await json('/rest/v1/jobs?select=id&business_id=eq.'+businessA,owner.token)).length,1)
    }
   })
  }
  phase='recurring-owner-date'
  const firstDate=(await db.query("select ((now() at time zone 'America/New_York')::date+30)::text as first_date")).rows[0].first_date
  const planRequest=randomUUID(),repeatOptions={title:'Synthetic monthly service',cadence:'monthly',first_date:firstDate,end_date:'',due_days:7,schedule_visit:false,visit_time:'09:00',duration_minutes:60,workers:[]}
  const repeatBody={p_invoice:invoice.id,p_request:planRequest,p_options:repeatOptions}
  phase='recurring-owner-create'
  const createdPlan=await json('/rest/v1/rpc/create_recurring_invoice',owner.token,{method:'POST',body:repeatBody})
  assert.equal(createdPlan.id,planRequest);assert.equal(createdPlan.status,'active')
  assert.equal((await json('/rest/v1/rpc/create_recurring_invoice',owner.token,{method:'POST',body:repeatBody})).id,planRequest)
  phase='recurring-owner-page'
  const pageBody={p_business:businessA,p_status:'current',p_before:null,p_before_id:null}
  const recurringPage=()=>json('/rest/v1/rpc/get_recurring_invoice_page',owner.token,{method:'POST',body:pageBody})
  assert.equal((await recurringPage()).items.length,1)
  for(const actor of [outsider,office])assert.equal((await api('/rest/v1/rpc/get_recurring_invoice_page',actor.token,{method:'POST',body:pageBody})).status,403)
  for(const status of ['paused','active']){
   assert.equal((await api('/rest/v1/rpc/set_recurring_invoice_status',owner.token,{method:'POST',body:{p_plan:planRequest,p_status:status}})).status,204)
   assert.equal((await recurringPage()).items[0].status,status)
  }
  phase='recurring-deposit-exclusion'
  const deposit=await json('/rest/v1/rpc/create_estimate_deposit',owner.token,{method:'POST',body:{p_estimate:estimate.id,p_amount:10,p_due:firstDate}})
  const depositRepeat=await api('/rest/v1/rpc/create_recurring_invoice',owner.token,{method:'POST',body:{...repeatBody,p_invoice:deposit,p_request:randomUUID()}})
  assert.equal(depositRepeat.status,400);assert.equal((await depositRepeat.json()).code,'23514')
  phase='recurring-keyset-fixtures'
  // Equal timestamps exercise the compound keyset cursor, not offset slicing.
  await db.query("insert into private.recurring_invoice_plans select (jsonb_populate_record(null::private.recurring_invoice_plans,to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'status','paused','created_at','2026-11-01T00:00:00Z'::timestamptz))).* from private.recurring_invoice_plans p cross join generate_series(1,26) n where p.id=$1",[planRequest])
  const firstPage=await recurringPage();assert.equal(firstPage.items.length,25);assert.equal(firstPage.has_more,true);assert.equal(firstPage.counts.paused,26)
  const cursor=firstPage.items.at(-1)
  const secondPage=await json('/rest/v1/rpc/get_recurring_invoice_page',owner.token,{method:'POST',body:{...pageBody,p_before:cursor.created_at,p_before_id:cursor.id}})
  assert.equal(secondPage.items.length,2);assert.equal(secondPage.has_more,false)
  assert.equal(new Set([...firstPage.items,...secondPage.items].map(p=>p.id)).size,27)
  phase='distributed-provider-burst'
  // Twenty independent PostgREST transactions, actual shared DB state, no OCR call.
  const receiptRequests=Array.from({length:20},()=>randomUUID())
  const reservations=await Promise.all(receiptRequests.map(p_request=>api('/rest/v1/rpc/reserve_receipt_scan',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_business:businessA,p_request,p_actor:owner.id}})))
  assert.equal(reservations.filter(r=>r.status===204).length,6)
  assert.equal(reservations.filter(r=>r.status===429).length,14)
  for(const response of reservations.filter(r=>r.status===429)){
   assert.ok(Number(response.headers.get('retry-after'))>=1&&Number(response.headers.get('retry-after'))<=10)
   assert.equal((await response.json()).code,'FINVIANT_BURST_LIMIT')
  }
  assert.equal(Number((await db.query('select count(*) from private.receipt_scan_requests where business_id=$1',[businessA])).rows[0].count),6)
  const firstAccepted=reservations.findIndex(r=>r.status===204)
  const duplicate=await api('/rest/v1/rpc/reserve_receipt_scan',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_business:businessA,p_request:receiptRequests[firstAccepted],p_actor:owner.id}})
  assert.equal(duplicate.status,409)
  const foreignReservation=await api('/rest/v1/rpc/reserve_receipt_scan',status.SERVICE_ROLE_KEY,{method:'POST',body:{p_business:businessA,p_request:randomUUID(),p_actor:outsider.id}})
  assert.equal(foreignReservation.status,403)
  phase='atomic-fin-voice-allowances'
  const aiRequests=Array.from({length:10},()=>randomUUID())
  const reserveAi=(p_feature,p_request=randomUUID(),p_units=1)=>api('/rest/v1/rpc/reserve_ai_request',owner.token,{method:'POST',body:{p_business:businessA,p_request,p_feature,p_units}})
  const ai=await Promise.all(aiRequests.map(request=>reserveAi('ai',request)))
  assert.ok(ai.every(r=>r.status===200))
  assert.equal((await reserveAi('ai')).status,400) // Existing business attempt ceiling.
  for(let i=0;i<2;i++)assert.equal((await reserveAi('voice',randomUUID(),12)).status,200)
  const throttledVoice=await reserveAi('voice',randomUUID(),12)
  assert.equal(throttledVoice.status,429);assert.equal((await throttledVoice.json()).code,'FINVIANT_BURST_LIMIT')
  assert.equal((await reserveAi('ai',aiRequests[0])).status,409)
  const actualUsage=(await db.query("select feature,used from private.tier_usage where business_id=$1 and feature in('ai','voice') order by feature",[businessA])).rows
  assert.deepEqual(actualUsage.map(r=>({feature:r.feature,used:Number(r.used)})),[{feature:'ai',used:10},{feature:'voice',used:24}])
  phase='owner-archive'
  const ownerArchive=await verifyOwnerArchiveReplay({db,api,json,owner,outsider,office,business:businessA,service:status.SERVICE_ROLE_KEY,sourceBytes:png})
  phase='access-revocation'
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner.id])
  await db.query("update public.business_members set access_modules=array['jobs'] where business_id=$1 and user_id=$2",[businessA,office.id])
  assert.deepEqual(await json('/rest/v1/invoices?select=id&business_id=eq.'+businessA,office.token),[])
  assert.ok(!(await api(object,office.token)).ok,'Revoked billing access must not read invoice files with the existing session')
  await db.query('delete from public.business_members where business_id=$1 and user_id=$2',[businessA,office.id])
  assert.deepEqual(await json('/rest/v1/customers?select=id&business_id=eq.'+businessA,office.token),[])
  return {genuinePasswordSessions:3,ownerInvoiceRetry:true,crossTenantReadWriteDenied:true,directUploadBypassDenied:true,serverQuotaReservation:true,privateFileHashVerified:true,anonymousFileDenied:true,foreignSigningDenied:true,moduleRevocation:true,membershipRevocation:true,concurrentReceiptReservations:6,burstRequestsDenied:14,atomicFinVoiceAllowance:true,recurringOwnerCreateRetry:true,recurringForeignOfficeDenied:true,recurringDepositRejected:true,recurringKeysetRows:27,ownerArchive,recovery}
 }catch(error){
  console.error(JSON.stringify({phase:'auth-storage-'+phase,errorCode:/^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/.test(error.code??'')?error.code:'unknown',...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{})}))
  throw Error('Genuine Auth/Storage replay failed at '+phase)
 }finally{
  await db.query('rollback')
  // End the fixture's owner impersonation before owned-container maintenance.
  // Keep the real application ownership-transfer guard fully enabled.
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)")
  if(photoPath){const removed=await api('/storage/v1/object/finviant-record-photos',status.SERVICE_ROLE_KEY,{method:'DELETE',body:{prefixes:[photoPath]}});if(!removed.ok)throw Error('Disposable Storage cleanup failed')}
  if(cleanupFixture){
   await cleanupFixture({expectedUsers:actors.map(a=>a.id),expectedBusinesses:[businessA,businessB]})
  }else{
  for(const business of [businessA,businessB]){
   for(const table of ['record_photos','payments','invoice_items','invoices','appointments','estimate_items','estimates','jobs','customers'])await db.query('delete from public.'+table+' where business_id=$1',[business])
   await db.query('delete from public.businesses where id=$1',[business])
  }
  await db.query('delete from private.provider_burst_buckets') // Only the owned empty-start disposable platform.
  for(const actor of actors){const removed=await api('/auth/v1/admin/users/'+actor.id,status.SERVICE_ROLE_KEY,{method:'DELETE'});if(!removed.ok)throw Error('Disposable Auth cleanup failed')}
  }
 }
}
