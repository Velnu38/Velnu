import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333',A='44444444-4444-4444-8444-444444444444',STAFF='55555555-5555-4555-8555-555555555555'
const migration=await readFile('supabase/migrations/20261110175726_owner_record_archives.sql','utf8')
const value=async(db:PGlite,sql:string,args:unknown[]=[])=>((await db.query<{v:any}>(sql,args)).rows[0]?.v)
async function actor(db:PGlite,id=U,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
async function fixture(upgrade=true){
 const db=new PGlite();try{
  await db.exec(await readFile('tests/records/archive-schema.sql','utf8'))
  const owners=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8'),start=owners.indexOf('create function private.is_primary_owner(')
  await db.exec(owners.slice(start,owners.indexOf('$$;',start)+3));await db.exec(migration);if(upgrade)await db.exec(await readFile('supabase/migrations/20261112212349_owner_archive_completeness.sql','utf8'))
  await db.query('insert into public.businesses(id,created_by_user_id,name) values($1,$2,$3),($4,$4,$5)',[B,U,'Archive fixture',OTHER,'Other tenant'])
  await db.query("insert into public.business_members(business_id,user_id,role) values($1,$2,'owner'),($3,$3,'owner'),($1,$4,'owner')",[B,U,OTHER,STAFF])
  await actor(db);return db
 }catch(e){await db.close();throw e}
}
test('owner snapshot includes more than 50,000 rows, remains immutable, excludes secrets and rejects other identities',async()=>{
 const db=await fixture();try{
  await db.exec('reset role')
  await db.query("insert into public.customers(id,business_id,first_name) select gen_random_uuid(),$1,'Customer '||n from generate_series(1,50001)n",[B])
  await db.query("insert into public.customers(id,business_id,first_name) values(gen_random_uuid(),$1,'Other tenant secret')",[OTHER])
  await db.query("insert into private.calendar_integrations(id,business_id,email,credentials) values(gen_random_uuid(),$1,'owner@example.test',$2)",[B,{access_token:'must-not-export'}])
  await db.query("insert into private.support_cases(id,business_id,title) values($1,$2,'Case')",[A,B]);await db.query("insert into private.support_messages(id,case_id,audience,body) values(gen_random_uuid(),$1,'customer','Customer reply'),(gen_random_uuid(),$1,'internal','Internal secret')",[A])
  await actor(db)
  assert.equal(await value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),A)
  assert.equal(await value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),A,'lost-response retry reuses the snapshot')
  const state=await value(db,'select public.get_owner_archive($1,$2) v',[B,A]);assert.equal(state.counts['public.customers'],50001);assert.equal(state.counts['private.support_messages'],1);assert.ok(state.part_count>1)
  await db.exec('reset role');await db.query("update public.customers set first_name='Edited after snapshot' where business_id=$1",[B]);
  const stored=await value(db,"select count(*)::int v from private.owner_archive_rows where archive_id=$1 and collection='public.customers' and payload->>'first_name' like 'Customer %'",[A]);assert.equal(stored,50001)
  const calendar=await value(db,"select payload v from private.owner_archive_rows where archive_id=$1 and collection='private.calendar_integrations'",[A]);assert.equal(calendar.email,'owner@example.test');assert.ok(!('credentials' in calendar))
  for(const id of [OTHER,STAFF]){await actor(db,id);await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501');await assert.rejects(()=>value(db,'select public.begin_owner_archive($1,$2) v',[B,crypto.randomUUID()]),(e:any)=>e.code==='42501')}
  await actor(db,'','anon');await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501')
  await actor(db);await assert.rejects(()=>db.query('select * from private.owner_archive_rows'),(e:any)=>e.code==='42501')
  const claim=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.ok(claim.rows.length);assert.equal((await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A])).busy,true)
  await assert.rejects(()=>db.query('select public.finish_owner_archive_part($1,1,$2,$3,100,$4)',[A,claim.lease,'a'.repeat(64),[]]),(e:any)=>e.code==='42501')
  const {assembleArchivePart}=await import('../../supabase/functions/owner-archive/assemble.ts')
  const {execFileSync}=await import('node:child_process')
  let current=claim,exported=0,parts=0
  while(!current.ready){
   const part=await assembleArchivePart(current,async()=>{throw Error('No files in large fixture')})
   const count=Number(execFileSync('python3',['-c',"import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(sum(len(z.read(n).splitlines()) for n in z.namelist() if n.startswith('records/public.customers.part-')))"],{input:Buffer.from(part.bytes),encoding:'utf8'}))
   exported+=count;parts++
   await actor(db,U,'service_role');await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,$5,$6)',[A,current.part_no,current.lease,part.sha256,part.bytes.length,JSON.stringify(part.entries)]);await actor(db)
   current=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A])
  }
  assert.equal(exported,50001);assert.equal(parts,state.part_count)
  await db.exec('reset role');await db.query('update public.business_members set role=$1 where user_id=$2',['viewer',U]);await actor(db)
  await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
test('archive preparation resumes expired leases, checks source changes, expires at seven days and cleanup leaves originals intact',async()=>{
 const db=await fixture();try{
  await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('finviant-record-photos',$1,$2)",[B+'/file.png',{size:4}]);await actor(db)
  await value(db,'select public.begin_owner_archive($1,$2) v',[B,A])
  const first=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);await db.exec('reset role');await db.query("update private.owner_archive_parts set lease_until=now()-interval '1 second' where archive_id=$1",[A]);await actor(db)
  const retry=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.equal(retry.part_no,first.part_no);assert.notEqual(retry.lease,first.lease)
  await actor(db,U,'service_role');await assert.rejects(()=>db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,first.part_no,first.lease,'a'.repeat(64),[]]),(e:any)=>e.code==='40001')
  await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,retry.part_no,retry.lease,'a'.repeat(64),[]]);await actor(db)
  let next=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.equal(next.kind,'file');const file=next.rows[0].data
  await actor(db,U,'service_role');assert.equal(await value(db,'select public.validate_owner_archive_source($1,$2,$3,$4) v',[file.bucket,file.path,file.updated_at,4]),true)
  await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,next.part_no,next.lease,'b'.repeat(64),[]]);await actor(db)
  const ready=await value(db,'select public.get_owner_archive($1,$2) v',[B,A]);assert.equal(ready.status,'ready');assert.equal(ready.ready_count,ready.part_count)
  assert.match((await value(db,'select public.owner_archive_download($1,$2,1) v',[B,A])).path,/\/1.zip$/)
  await db.exec('reset role');await db.query("update private.owner_archives set expires_at=now()-interval '21 minutes' where id=$1",[A]);await actor(db)
  assert.equal((await value(db,'select public.get_owner_archive($1,$2) v',[B,A])).status,'expired');await assert.rejects(()=>value(db,'select public.owner_archive_download($1,$2,1) v',[B,A]),(e:any)=>e.code==='42501')
  await actor(db,U,'service_role');const cleanup=await value(db,'select public.expired_owner_archive_parts() v');assert.equal(cleanup.length,ready.part_count)
  await db.query('select public.remove_expired_owner_archive_parts($1)',[JSON.stringify(cleanup)]);await db.exec('reset role')
  assert.equal(await value(db,'select count(*)::int v from private.owner_archive_rows where archive_id=$1',[A]),0)
  assert.equal(await value(db,'select count(*)::int v from storage.objects'),1);assert.equal(await value(db,'select count(*)::int v from public.businesses'),2)
 }finally{await db.close()}
})

test('v2 tenant archive reconciles business records, balances, files and history against independent ZIP manifests',async()=>{
 const {assembleArchivePart}=await import('../../supabase/functions/owner-archive/assemble.ts')
 const {archiveHash}=await import('../../shared/archiveZip.ts')
 const {execFileSync}=await import('node:child_process')
 const {mkdir,writeFile}=await import('node:fs/promises')
 const {archiveCatalog}=await import('../../shared/archiveCatalog.ts')
 const db=await fixture(),bytes=new TextEncoder().encode('Synthetic immutable PDF fixture'),photo=new Uint8Array([1,2,3,4])
 const sources=new Map([[B+'/issued.pdf',bytes],[B+'/photo.png',photo],[B+'/logo.png',photo]])
 const expected:Record<string,any[]>={}
 const seed=async(table:string,row:Record<string,unknown>)=>{
  await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,[JSON.stringify(row)])
  expected[table]??=[];expected[table].push(row)
 }
 try{
  await db.exec('reset role')
  await db.query('update public.businesses set logo_path=$1 where id=$2',[B+'/logo.png',B])
  await seed('public.customers',{id:A,business_id:B,first_name:'Synthetic customer'})
  await seed('public.properties',{id:A,business_id:B,customer_id:A,address_line1:'123 Fixture Lane'})
  await seed('public.jobs',{id:A,business_id:B,customer_id:A,title:'Synthetic job',status:'completed'})
  await seed('public.estimates',{id:A,business_id:B,customer_id:A,total:100})
  await seed('public.change_orders',{id:A,business_id:B,customer_id:A,total:20})
  await seed('public.invoices',{id:A,business_id:B,customer_id:A,total:120,amount_paid:45,balance_due:75})
  await seed('public.invoice_items',{id:A,business_id:B,invoice_id:A,description:'Synthetic service',line_total:120})
  await seed('public.payments',{id:A,business_id:B,invoice_id:A,amount:45,status:'completed'})
  await seed('public.bookkeeping_entries',{id:A,business_id:B,direction:'expense',amount:12,invoice_id:A})
  await seed('public.document_approvals',{id:A,business_id:B,estimate_id:A,action:'approved'})
  await seed('private.worker_profiles',{id:STAFF,business_id:B,name:'Synthetic worker',active:true})
  await seed('private.worker_time_off',{id:A,business_id:B,user_id:STAFF,note:'Synthetic leave'})
  await seed('private.job_activity',{id:1,business_id:B,job_id:A,event:{action:'completed'}})
  await seed('private.job_completion_reports',{id:A,business_id:B,job_id:A,snapshot:{title:'Synthetic completion'}})
  await seed('private.job_report_photos',{report_id:A,photo_id:A,storage_path:B+'/photo.png'})
  await seed('public.record_photos',{id:A,business_id:B,expense_id:A,storage_path:B+'/photo.png',byte_size:4})
  await seed('private.document_versions',{id:A,business_id:B,document_id:A,kind:'invoice',pdf_bucket:'finviant-document-pdfs',pdf_path:B+'/issued.pdf',pdf_byte_size:bytes.length,pdf_sha256:await archiveHash(bytes)})
  await seed('private.delivery_tasks',{id:A,business_id:B,actor_id:U,document_id:A,kind:'invoice',reminder:true,status:'canceled',snapshot:{token:'DO-NOT-EXPORT'}})
  await seed('private.finviant_email_outbox',{id:A,business_id:B,actor_id:U,document_id:A,document_kind:'invoice_reminder',status:'delivered',provider_id:'tenant-mail',payload:{to:['fixture@example.test'],text:'DO-NOT-EXPORT'}})
  await seed('private.finviant_delivery_events',{event_id:'tenant-event',provider_id:'tenant-mail',event_type:'email.delivered'})
  await seed('private.managed_sms',{id:A,business_id:B,actor_id:U,document_id:A,status:'uncertain',body:'DO-NOT-EXPORT',token_hash:'DO-NOT-EXPORT'})
  await seed('private.business_card_sms',{id:A,business_id:B,actor_id:U,status:'accepted',body:'DO-NOT-EXPORT'})
  await seed('private.appointment_reminder_queue',{id:A,business_id:B,appointment_id:A,status:'blocked',snapshot:{actor_id:U,customer_id:A,recipient:'fixture@example.test',token:'DO-NOT-EXPORT'}})
  await seed('private.job_invoice_results',{job_id:A,business_id:B,invoice_id:A})
  for(const [path,data] of sources)await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[path.endsWith('.pdf')?'finviant-document-pdfs':path.endsWith('logo.png')?'velnu-business-logos':'finviant-record-photos',path,{size:data.length}])
  await db.query("insert into private.finviant_email_outbox(id,business_id,provider_id,payload) values($1,$2,'other-mail','{}')",[OTHER,OTHER])
  await db.exec("insert into private.finviant_delivery_events(event_id,provider_id,event_type) values('other-event','other-mail','email.delivered')")
  await actor(db);await value(db,'select public.begin_owner_archive($1,$2) v',[B,A])
  const state=await value(db,'select public.get_owner_archive($1,$2) v',[B,A]),records:Record<string,any[]>={},counts:Record<string,number>={},hashes:Record<string,string>={}
  await mkdir('tmp/owner-archive-test',{recursive:true})
  for(let n=1;n<=state.part_count;n++){
   const claim=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.equal(claim.schema_version,2)
   const part=await assembleArchivePart(claim,async file=>sources.get(String(file.path))!)
   // Python's standard ZIP implementation independently checks CRCs, all SHA-256s and record counts.
   const opened=JSON.parse(execFileSync('python3',['-c',`import sys,io,zipfile,json,hashlib
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None
m=json.loads(z.read(next(n for n in z.namelist() if n.startswith('manifests/'))))
assert m['schema_version']==2
rows={}
for f in m['files']:
 b=z.read(f['name']); assert len(b)==f['bytes']; assert hashlib.sha256(b).hexdigest()==f['sha256']
 if f['name'].startswith('records/'):
  r=[json.loads(x) for x in b.splitlines()]; assert len(r)==f['records']; rows[f['name'].split('/')[1].split('.part-')[0]]=r
assert set(z.namelist())=={f['name'] for f in m['files']}|{n for n in z.namelist() if n.startswith('manifests/')}
print(json.dumps({'manifest':m,'rows':rows}))`],{input:Buffer.from(part.bytes),encoding:'utf8',maxBuffer:10000000}))
   assert.equal(opened.manifest.business_id,B);assert.equal(opened.manifest.total_parts,state.part_count)
   assert.ok(!JSON.stringify(opened).includes('DO-NOT-EXPORT'));assert.ok(!JSON.stringify(opened).includes('other-event'))
   for(const [table,rows] of Object.entries(opened.rows) as [string,any[]][]){records[table]=[...(records[table]||[]),...rows];counts[table]=(counts[table]||0)+rows.length}
   for(const entry of opened.manifest.files)if(entry.source){assert.equal(entry.sha256,await archiveHash(sources.get(entry.source.path)!));counts.storage_files=(counts.storage_files||0)+1}
   hashes[String(n)]=part.sha256;await writeFile(`tmp/owner-archive-test/part-${n}.zip`,part.bytes)
   await actor(db,U,'service_role');await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,$5,$6)',[A,n,claim.lease,part.sha256,part.bytes.length,JSON.stringify(part.entries)]);await actor(db)
  }
  for(const [table,count] of Object.entries(state.counts))assert.equal(counts[table],count,table)
  for(const table of Object.keys(expected))assert.equal(records[table].length,expected[table].length,table)
  for(const c of archiveCatalog)for(const row of records[c.collection]||[])assert.deepEqual(Object.keys(row).sort(),[...c.columns].sort(),c.collection+' catalog parity')
  assert.equal(records['public.invoices'][0].balance_due,75);assert.equal(records['public.payments'][0].amount,45)
  assert.deepEqual(records['private.finviant_email_outbox'][0].recipient,['fixture@example.test'])
  assert.equal((await value(db,'select public.get_owner_archive($1,$2) v',[B,A])).status,'ready')
  for(const id of [OTHER,STAFF]){await actor(db,id);for(const rpc of ['claim_owner_archive_part','get_owner_archive'])await assert.rejects(()=>value(db,`select public.${rpc}($1,$2) v`,[B,A]),(e:any)=>e.code==='42501');await assert.rejects(()=>value(db,'select public.owner_archive_download($1,$2,1) v',[B,A]),(e:any)=>e.code==='42501')}
  await writeFile('tmp/owner-archive-test/verification.json',JSON.stringify({synthetic:true,schema_version:2,counts,part_hashes:hashes,balances:{total:120,paid:45,due:75},independentZipVerification:true},null,2)+'\n')
 }finally{await db.close()}
})

test('missing logos and retained completion photos fail atomically without a partial archive',async()=>{
 const db=await fixture();try{
  await db.exec('reset role');await db.query('update public.businesses set logo_path=$1 where id=$2',[B+'/missing-logo.png',B]);await actor(db)
  await assert.rejects(()=>value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='55000')
  await db.exec('reset role');await db.query('update public.businesses set logo_path=null where id=$1',[B]);await db.query('insert into private.job_completion_reports(id,business_id) values($1,$2)',[A,B]);await db.query('insert into private.job_report_photos(report_id,storage_path) values($1,$2)',[A,B+'/missing-photo.png']);await actor(db)
  await assert.rejects(()=>value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='55000')
  await db.exec('reset role');assert.equal(await value(db,'select count(*)::int v from private.owner_archives'),0)
 }finally{await db.close()}
})


test('upgrade preserves the original version on existing snapshots',async()=>{
 const db=await fixture(false);try{
  await value(db,'select public.begin_owner_archive($1,$2) v',[B,A])
  await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261112212349_owner_archive_completeness.sql','utf8'));await actor(db)
  assert.equal((await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A])).schema_version,1)
  const next=crypto.randomUUID();await value(db,'select public.begin_owner_archive($1,$2) v',[B,next])
  assert.equal((await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,next])).schema_version,2)
 }finally{await db.close()}
})
