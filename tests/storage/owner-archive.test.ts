import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {archiveHash,storedZip} from '../../shared/archiveZip.ts'
import {assembleArchivePart,type ArchiveClaim} from '../../supabase/functions/owner-archive/assemble.ts'
import {ownerArchiveHandler,type ArchiveDependencies} from '../../supabase/functions/owner-archive/handler.ts'
import {cleanupOwnerArchives} from '../../supabase/functions/_shared/archiveCleanup.ts'
const B='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222',L='33333333-3333-4333-8333-333333333333'
const claim:ArchiveClaim={business_id:B,archive_id:A,lease:L,part_no:1,part_count:2,kind:'records',created_at:'2026-11-10T12:00:00Z',expires_at:'2099-01-01T00:00:00Z',counts:{'public.customers':2},rows:[{collection:'public.customers',data:{id:'1',name:'José 👷'}},{collection:'public.customers',data:{id:'2',name:'Second'}}]}
const openZip=(bytes:Uint8Array)=>JSON.parse(execFileSync('python3',['-c',"import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:{'text':z.read(n).decode(),'hash':hashlib.sha256(z.read(n)).hexdigest()} for n in z.namelist()}))"],{input:Buffer.from(bytes),encoding:'utf8'}))
test('bounded archive ZIPs open independently, preserve Unicode records and provide verified entry manifests',async()=>{
 const result=await assembleArchivePart(claim,async()=>{throw Error('Records must not download files')})
 const files=openZip(result.bytes),name='records/public.customers.part-000001.jsonl'
 assert.deepEqual(files[name].text.trim().split('\n').map((line:string)=>JSON.parse(line)),claim.rows.map(r=>r.data))
 const manifest=JSON.parse(files['manifests/part-000001.json'].text);assert.equal(manifest.files[0].sha256,files[name].hash);assert.equal(manifest.collection_counts['public.customers'],2);assert.equal(manifest.collection_counts['public.invoices'],0);assert.equal(manifest.total_parts,2)
 assert.ok(JSON.parse(files['schema/catalog.json'].text).some((x:any)=>x.collection==='private.job_completion_reports'))
 assert.equal(await archiveHash(result.bytes),result.sha256)
 assert.deepEqual((await assembleArchivePart(claim,async()=>new Uint8Array())).bytes,result.bytes,'lost-response retry produces identical bytes')
 for(const name of ['../secret','/absolute','a/../b','a//b'])assert.throws(()=>storedZip([{name,bytes:new Uint8Array([1])}]))
})
test('file parts reject another tenant, oversized or changed source bytes and preserve originals',async()=>{
 const file={bucket:'finviant-record-photos',path:B+'/photo.png',byte_size:4,updated_at:'2026-11-10T12:00:00Z'},input={...claim,part_no:2,kind:'file' as const,rows:[{collection:'storage_files',data:file}]}
 let reads=0;const download=async()=>{reads++;return new Uint8Array([1,2,3,4])}
 const part=await assembleArchivePart(input,download);assert.equal(part.entries[0].bytes,4)
 for(const changed of [{path:A+'/photo.png'},{bucket:'private-credentials'},{byte_size:10000001},{path:B+'/../secret'}])await assert.rejects(()=>assembleArchivePart({...input,rows:[{collection:'storage_files',data:{...file,...changed}}]},download))
 assert.equal(reads,1);await assert.rejects(()=>assembleArchivePart(input,async()=>new Uint8Array([1])))
})
test('archive handler checks current ownership before files, detects corrupt downloads and leaves incomplete writes retryable',async()=>{
 let writes=0,finished=0,reads=0,allowed=true,failSave=false,corrupt=false
 const packed=await assembleArchivePart(claim,async()=>new Uint8Array())
 const deps:ArchiveDependencies={origins:['https://finviant.com'],authorize:async auth=>auth==='Bearer valid'?'owner':null,
  caller:async(_auth,name)=>allowed?{data:name==='claim_owner_archive_part'?claim:{path:B+'/'+A+'/1.zip',sha256:packed.sha256,byte_size:packed.bytes.length}}:{data:null,error:{}},source:async()=>{reads++;return new Uint8Array()},save:async()=>{writes++;if(failSave)throw Error('lost upload')},finish:async()=>{finished++},download:async()=>{reads++;return corrupt?new Uint8Array([1]):packed.bytes}}
 const handler=ownerArchiveHandler(deps),request=(action='prepare',auth='Bearer valid',origin='https://finviant.com')=>new Request('https://api.example/owner-archive',{method:'POST',headers:{authorization:auth,origin},body:JSON.stringify({action,business_id:B,archive_id:A,part:1})})
 assert.equal((await handler(request('prepare','bad'))).status,401);assert.equal((await handler(request('prepare','Bearer valid','https://evil.test'))).status,403)
 allowed=false;assert.equal((await handler(request())).status,403);assert.equal(reads+writes,0)
 allowed=true;failSave=true;assert.equal((await handler(request())).status,503);assert.equal(finished,0)
 failSave=false;assert.equal((await handler(request())).status,200);assert.equal(finished,1)
 assert.equal((await handler(request('download'))).status,200);corrupt=true;assert.equal((await handler(request('download'))).status,503)
 allowed=false;const before=reads;assert.equal((await handler(request('download'))).status,403);assert.equal(reads,before,'revoked access must not touch stored copies')
})
test('cleanup only removes generated archive objects and confirms deletion before removing metadata',async()=>{
 const calls:string[]=[],row={archive_id:A,part_no:1,path:B+'/'+A+'/1.zip'};let bad=false,fail=false
 const db={
  rpc:async(name:string)=>{calls.push(name);return {data:name==='expired_owner_archive_parts'?[{...row,path:bad?'original/customer-photo.png':row.path}]:null,error:null}},
  storage:{from:(bucket:string)=>{
   assert.equal(bucket,'finviant-owner-archives')
   return {remove:async(paths:string[])=>{calls.push('remove');assert.deepEqual(paths,[row.path]);return {error:fail?{}:null}}}
  }}
 }
 assert.equal(await cleanupOwnerArchives(db),1);assert.deepEqual(calls,['expired_owner_archive_parts','remove','remove_expired_owner_archive_parts'])
 calls.length=0;fail=true;await assert.rejects(()=>cleanupOwnerArchives(db));assert.ok(!calls.includes('remove_expired_owner_archive_parts'))
 calls.length=0;bad=true;await assert.rejects(()=>cleanupOwnerArchives(db));assert.deepEqual(calls,['expired_owner_archive_parts'])
})

test('versioned catalogs are hashed, legacy claims stay v1 and immutable PDF content changes fail',async()=>{
 const old=openZip((await assembleArchivePart(claim,async()=>new Uint8Array())).bytes)
 const oldManifest=JSON.parse(old['manifests/part-000001.json'].text)
 assert.equal(oldManifest.schema_version,1)
 assert.ok(!JSON.parse(old['schema/catalog.json'].text).some((c:any)=>c.collection==='private.delivery_tasks'))
 const current=openZip((await assembleArchivePart({...claim,schema_version:2},async()=>new Uint8Array())).bytes)
 const manifest=JSON.parse(current['manifests/part-000001.json'].text)
 assert.equal(manifest.schema_version,2)
 assert.equal(manifest.files.find((f:any)=>f.name==='schema/catalog.json').sha256,current['schema/catalog.json'].hash)
 assert.ok(JSON.parse(current['schema/catalog.json'].text).some((c:any)=>c.collection==='private.delivery_tasks'))
 await assert.rejects(()=>assembleArchivePart({...claim,schema_version:99 as any},async()=>new Uint8Array()),/Unsupported/)
 const file={bucket:'finviant-document-pdfs',path:B+'/issued.pdf',byte_size:4,sha256:await archiveHash(new Uint8Array([1,2,3,4]))}
 const input={...claim,schema_version:2 as const,part_no:2,kind:'file' as const,rows:[{collection:'storage_files',data:file}]}
 await assert.rejects(()=>assembleArchivePart(input,async()=>new Uint8Array([4,3,2,1])),/hash mismatch/)
 assert.equal((await assembleArchivePart(input,async()=>new Uint8Array([1,2,3,4]))).entries[0].sha256,file.sha256)
})
