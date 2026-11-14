import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {B,U,C,I,fixture,user,invoice} from './fixture.ts'
const R='77777777-7777-4777-8777-000000000001'
const R2='77777777-7777-4777-8777-000000000002'
const migration='supabase/migrations/20261108001434_canonical_pdf_delivery_artifacts.sql'
async function setup(){
 const db=await fixture()
 await db.exec(`create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb default '{}',primary key(bucket_id,name));
 create table private.attachment_reservations(bucket_id text,object_name text,business_id uuid,actor_id uuid,bytes bigint,created_at timestamptz default now(),primary key(bucket_id,object_name));
 create function private.business_storage_usage(p_business uuid) returns bigint language sql as $$
  select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id in ('finviant-record-photos','velnu-business-logos') and name like p_business::text||'/%'
 $$;
 create function private.reserve_attachment(p_business uuid,p_bucket text,p_name text,p_bytes bigint) returns void language plpgsql as $$
 begin
  if p_bucket not in ('finviant-record-photos','velnu-business-logos') then raise exception 'INVALID_ATTACHMENT_BUCKET';end if;
  perform 1 from storage.objects where bucket_id in ('finviant-record-photos','velnu-business-logos') and name like p_business::text||'/%';
 end $$;

 create table public.properties(id uuid primary key,business_id uuid,customer_id uuid,label text,address_line1 text,address_line2 text,city text,state text,postal_code text,access_notes text,unique(id,business_id));
 create table public.business_settings(business_id uuid,payment_links jsonb,payment_instructions text);
 alter table public.customers add column address_line1 text,add column address_line2 text,add column city text,add column state text,add column postal_code text;
 alter table public.change_orders add column change_totals jsonb;
 create function private.can_write_business(uuid) returns boolean language sql as $$select private.fin_access($1,'invoices',true)$$;
 insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values('${B}',true,'owner@example.test') on conflict(business_id) do update set email_active=true;
 `)
 const original=await readFile('supabase/migrations/20261102231643_document_workflow_and_contact_import.sql','utf8')
 const at=original.indexOf('CREATE OR REPLACE FUNCTION public.create_document(')
 await db.exec(original.slice(at,original.indexOf('end$function$;',at)+'end$function$;'.length))
 await db.exec(await readFile('supabase/migrations/20261107023520_streamlined_workflow_handoffs.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261104164218_change_order_review_recipient.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261108001428_canonical_customer_document_revisions.sql','utf8'))
 await db.exec(await readFile(migration,'utf8'))
 await invoice(db)
 await db.exec('reset role')
 return db
}
async function value(db:any,sql:string,args:unknown[]=[]){return(await db.query(sql,args)).rows[0].v}
const prepare=(db:any,id=R,expected?:string)=>value(db,'select public.prepare_document_email($1,$2,$3,$4,$5,$6,$7) v',[U,B,'invoice',I,id,'https://finviant.com',expected??null])
async function currentVersion(db:any){await user(db);const version=await value(db,'select public.get_owner_document_version($1,$2,$3) v',[B,'invoice',I]);await db.exec('reset role');return version}

test('new managed document freezes reviewed version and supplies a stable document link',async()=>{
 const db=await setup();try{
  const version=await currentVersion(db),queued=await prepare(db,R,version.version_id)
  const row=await value(db,'select to_jsonb(o) v from private.finviant_email_outbox o where id=$1',[R])
  assert.equal(queued.document_version_id,version.version_id)
  assert.equal(row.document_version_id,version.version_id)
  assert.match(row.payload.text,/Your document is attached as a PDF/)
  assert.equal(row.payload.from,'"Test Company via Finviant" <adminsupport@finviant.com>')
  assert.match(row.payload.text,/Hello Jordan,/)
  assert.deepEqual(row.payload.reply_to,['owner@example.test'])
  assert.match(row.payload.text,/https:\/\/finviant.com\/\?document_share=[a-f0-9]{64}/)
  assert.doesNotMatch(row.payload.text,/14 days|\?approval=/)
  assert.equal(row.attempts,0)
  assert.equal(await value(db,'select count(*)::int v from private.document_shares'),1)
  assert.equal(await value(db,'select status v from public.invoices where id=$1',[I]),'draft')
  const again=await prepare(db,R,version.version_id)
  assert.equal(again.id,R)
  assert.equal(await value(db,'select count(*)::int v from private.document_shares'),1)
 }finally{await db.close()}
})

test('a mismatched reviewed version rolls back the entire queue and quota reservation',async()=>{
 const db=await setup();try{
  await assert.rejects(()=>prepare(db,R,'99999999-9999-4999-8999-999999999999'),/DOCUMENT_VERSION_CHANGED/)
  assert.equal(await value(db,'select count(*)::int v from private.finviant_email_outbox'),0)
  assert.equal(await value(db,'select count(*)::int v from public.messages'),0)
  assert.equal(await value(db,'select count(*)::int v from private.document_shares'),0)
 }finally{await db.close()}
})

test('an uncertain operation cannot silently send a different PDF from the current review',async()=>{
 const db=await setup();try{
  const original=await currentVersion(db);await prepare(db,R,original.version_id)
  await db.query("update private.finviant_email_outbox set status='uncertain' where id=$1",[R])
  await assert.rejects(()=>prepare(db,R,'99999999-9999-4999-8999-999999999999'),/PENDING_DOCUMENT_VERSION_CONFLICT/)
  assert.equal(await value(db,'select document_version_id v from private.finviant_email_outbox where id=$1',[R]),original.version_id)
  assert.equal(await value(db,'select attempts v from private.finviant_email_outbox where id=$1',[R]),0)
  assert.equal((await prepare(db,R,original.version_id)).id,R)
 }finally{await db.close()}
})

test('reviewed recipient overload checks the exact PDF version atomically',async()=>{
 const db=await setup();try{
  const original=await currentVersion(db)
  await db.query('update public.invoice_items set description=$1 where invoice_id=$2',['Changed scope',I])
  await assert.rejects(()=>value(db,'select public.prepare_review_document_email($1,$2,$3,$4,$5,$6,$7,$8) v',[U,B,'invoice',I,R,'https://finviant.com','jordan@example.test',original.version_id]),/DOCUMENT_VERSION_CHANGED/)
  assert.equal(await value(db,'select count(*)::int v from private.finviant_email_outbox'),0)
  assert.equal(await value(db,'select count(*)::int v from public.messages'),0)
 }finally{await db.close()}
})

test('older dispatchers cannot lease a versioned operation without a saved PDF',async()=>{
 const db=await setup();try{
  await prepare(db)
  const old=await value(db,'select public.claim_document_email($1) v',[R])
  assert.equal(old.status,'pdf_artifact_required')
  assert.equal(await value(db,'select attempts v from private.finviant_email_outbox where id=$1',[R]),0)
  const capable=await value(db,'select public.claim_document_email($1,true) v',[R])
  assert.equal(capable.status,'claimed')
  assert.ok(capable.document_version_id)
  assert.ok(capable.lease)
 }finally{await db.close()}
})

test('artifact preparation failure releases its lease without consuming a provider attempt',async()=>{
 const db=await setup();try{
  await prepare(db)
  const claimed=await value(db,'select public.claim_document_email($1,true) v',[R])
  assert.equal(await value(db,'select attempts v from private.finviant_email_outbox where id=$1',[R]),1)
  assert.equal(await value(db,'select public.release_document_pdf_claim($1,$2) v',[R,R2]),false)
  assert.equal(await value(db,'select public.release_document_pdf_claim($1,$2) v',[R,claimed.lease]),true)
  assert.equal(await value(db,'select attempts v from private.finviant_email_outbox where id=$1',[R]),0)
  assert.equal(await value(db,'select status v from private.finviant_email_outbox where id=$1',[R]),'queued')
  assert.equal((await value(db,'select public.claim_document_email($1,true) v',[R])).status,'busy')
 }finally{await db.close()}
})

test('PDF metadata and email attachment are immutable and reject stale lease or changed bytes',async()=>{
 const db=await setup();try{
  const version=await currentVersion(db);await prepare(db,R,version.version_id)
  const body='%PDF-1.7\ncanonical frozen invoice\n%%EOF',content=Buffer.from(body).toString('base64')
  const sha=await value(db,"select encode(sha256(convert_to($1,'UTF8')),'hex') v",[body])
  const path=`${B}/invoice/${I}/${version.version_id}.pdf`
  await assert.rejects(()=>value(db,'select public.register_document_pdf_artifact($1,$2,$3) v',[version.version_id,sha,Buffer.byteLength(body)]),/PDF_OBJECT_NOT_SAVED/)
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['finviant-document-pdfs',path])
  await value(db,'select public.register_document_pdf_artifact($1,$2,$3) v',[version.version_id,sha,Buffer.byteLength(body)])
  await assert.rejects(()=>value(db,'select public.register_document_pdf_artifact($1,$2,$3) v',[version.version_id,'a'.repeat(64),Buffer.byteLength(body)]),/PDF_ARTIFACT_CONFLICT/)
  const claimed=await value(db,'select public.claim_document_email($1,true) v',[R])
  await assert.rejects(()=>value(db,'select public.freeze_document_email_attachment($1,$2,$3,$4,$5,$6) v',[R,R2,version.version_id,'Invoice.pdf',content,sha]),/STALE_SEND_LEASE/)
  await assert.rejects(()=>value(db,'select public.freeze_document_email_attachment($1,$2,$3,$4,$5,$6) v',[R,claimed.lease,version.version_id,'Invoice.pdf',Buffer.from('wrong').toString('base64'),sha]),/PDF_ATTACHMENT_INTEGRITY_FAILED/)
  const payload=await value(db,'select public.freeze_document_email_attachment($1,$2,$3,$4,$5,$6) v',[R,claimed.lease,version.version_id,'Invoice.pdf',content,sha])
  assert.equal(payload.attachments[0].content,content)
  assert.equal(payload.attachments[0].content_type,'application/pdf')
  const again=await value(db,'select public.freeze_document_email_attachment($1,$2,$3,$4,$5,$6) v',[R,claimed.lease,version.version_id,'Changed.pdf','ignored',sha])
  assert.deepEqual(again,payload,'once frozen, provider retry receives the identical saved payload')
 }finally{await db.close()}
})

test('PDF artifact service helpers are unavailable to anonymous and owner browser roles',async()=>{
 const db=await setup();try{
  for(const role of ['anon','authenticated']){
   assert.equal(await value(db,'select has_function_privilege($1,$2,$3) v',[role,'public.document_pdf_artifact_context(uuid)','EXECUTE']),false)
   assert.equal(await value(db,'select has_function_privilege($1,$2,$3) v',[role,'public.register_document_pdf_artifact(uuid,text,integer)','EXECUTE']),false)
   assert.equal(await value(db,'select has_function_privilege($1,$2,$3) v',[role,'public.freeze_document_email_attachment(uuid,uuid,uuid,text,text,text)','EXECUTE']),false)
  }
  assert.equal(await value(db,"select public v from storage.buckets where id='finviant-document-pdfs'"),false)
 }finally{await db.close()}
})

test('new PDF reservations respect shared storage quota and retry without double charging',async()=>{
 const db=await setup();try{
  for(const signature of ['private.business_storage_usage(uuid)','private.reserve_attachment(uuid,text,text,bigint)']){
   const definition=await value(db,'select pg_get_functiondef($1::regprocedure) v',[signature])
   assert.match(definition,/bucket_id in \('finviant-record-photos','velnu-business-logos','finviant-document-pdfs'\)/)
   if(signature.includes('reserve_attachment'))assert.match(definition,/p_bucket not in \('finviant-record-photos','velnu-business-logos'\)/)
  }
  const version=await currentVersion(db)
  await db.exec("create or replace function private.attachment_plan(b uuid) returns text language sql as $$select 'free'::text$$")
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['finviant-record-photos',B+'/existing.jpg',JSON.stringify({size:99999995})])
  await assert.rejects(()=>value(db,'select public.reserve_document_pdf_artifact($1,$2) v',[version.version_id,50]),/PDF_STORAGE_ALLOWANCE_REACHED/)
  assert.equal(await value(db,'select count(*)::int v from private.attachment_reservations'),0)
  await db.query("update storage.objects set metadata='{}'")
  await value(db,'select public.reserve_document_pdf_artifact($1,$2) v',[version.version_id,50])
  await value(db,'select public.reserve_document_pdf_artifact($1,$2) v',[version.version_id,50])
  assert.equal(await value(db,'select count(*)::int v from private.attachment_reservations'),1)
  const path=`${B}/invoice/${I}/${version.version_id}.pdf`
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['finviant-document-pdfs',path,JSON.stringify({size:50})])
  assert.equal(await value(db,'select private.business_storage_usage($1)::int v',[B]),50)
  await value(db,'select public.register_document_pdf_artifact($1,$2,$3) v',[version.version_id,'a'.repeat(64),50])
  assert.equal(await value(db,'select count(*)::int v from private.attachment_reservations'),0)
 }finally{await db.close()}
})
