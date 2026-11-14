-- Canonical document artifacts are private and immutable; a bearer link is
-- validated by the function before any version or PDF is served.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finviant-document-pdfs','finviant-document-pdfs',false,8000000,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=8000000,allowed_mime_types=array['application/pdf'];
create policy finviant_pdf_service_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'finviant-document-pdfs') with check(bucket_id<>'finviant-document-pdfs');

alter table private.finviant_email_outbox
 add column if not exists document_version_id uuid references private.document_versions(id),
 add column if not exists pdf_sha256 text,
 add column if not exists pdf_frozen_at timestamptz;

create function public.document_pdf_artifact_context(p_version uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version_id',id,'business_id',business_id,'kind',kind,'document_id',document_id,
  'snapshot',snapshot,'pdf_bucket',pdf_bucket,'pdf_path',pdf_path,'pdf_sha256',pdf_sha256,'pdf_byte_size',pdf_byte_size)
 from private.document_versions where id=p_version;
$$;

-- PDF bytes share the existing business-wide storage budget. Reservations
-- remain held after an uncertain upload until the immutable object is verified.
create function public.reserve_document_pdf_artifact(p_version uuid,p_byte_size integer) returns void
language plpgsql security definer set search_path='' as $$
declare v private.document_versions%rowtype; path text; used bigint; pending bigint; actor uuid; plan_name text;
begin
 if p_version is null or p_byte_size is null or p_byte_size<9 or p_byte_size>8000000 then raise exception 'INVALID_PDF_ARTIFACT' using errcode='22023';end if;
 select * into v from private.document_versions where id=p_version;
 if not found then raise exception 'DOCUMENT_VERSION_UNAVAILABLE' using errcode='42501';end if;
 path:=v.business_id::text||'/'||v.kind||'/'||v.document_id::text||'/'||v.id::text||'.pdf';
 perform pg_advisory_xact_lock(hashtextextended('finviant-storage:'||v.business_id::text,0));
 if exists(select 1 from storage.objects where bucket_id='finviant-document-pdfs' and name=path) then return;end if;
 if exists(select 1 from private.attachment_reservations where bucket_id='finviant-document-pdfs' and object_name=path and business_id=v.business_id and bytes=p_byte_size) then return;end if;
 select
  (select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end),0) from storage.objects o
   where o.bucket_id in ('finviant-record-photos','velnu-business-logos','finviant-document-pdfs') and o.name like v.business_id::text||'/%'),
  (select coalesce(sum(r.bytes),0) from private.attachment_reservations r where r.business_id=v.business_id
   and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name))
 into used,pending;
 plan_name:=private.attachment_plan(v.business_id);
 if used+pending+p_byte_size>private.attachment_limit(plan_name) then raise exception 'PDF_STORAGE_ALLOWANCE_REACHED' using errcode='23514';end if;
 select created_by_user_id into actor from public.businesses where id=v.business_id;
 insert into private.attachment_reservations(bucket_id,object_name,business_id,actor_id,bytes)
 values('finviant-document-pdfs',path,v.business_id,actor,p_byte_size);
end $$;
revoke all on function public.reserve_document_pdf_artifact(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_document_pdf_artifact(uuid,integer) to service_role;

-- Existing photo/logo quota reservations must see stored PDF bytes as well.
-- Only bucket_id read filters change; upload destinations and all access checks
-- remain exactly as before.
do $$
declare signature text; definition text; patched text;
begin
 foreach signature in array array['private.business_storage_usage(uuid)','private.reserve_attachment(uuid,text,text,bigint)'] loop
  if to_regprocedure(signature) is null then raise exception 'PDF_STORAGE_QUOTA_FUNCTION_MISSING: %',signature;end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if position('bucket_id in (''finviant-record-photos'',''velnu-business-logos'')' in definition)=0 then
   raise exception 'PDF_STORAGE_QUOTA_PATCH_TARGET_MISSING: %',signature;
  end if;
  patched:=replace(definition,'bucket_id in (''finviant-record-photos'',''velnu-business-logos'')','bucket_id in (''finviant-record-photos'',''velnu-business-logos'',''finviant-document-pdfs'')');
  if patched=definition or position('bucket_id in (''finviant-record-photos'',''velnu-business-logos'',''finviant-document-pdfs'')' in patched)=0 then
   raise exception 'PDF_STORAGE_QUOTA_PATCH_FAILED: %',signature;
  end if;
  execute patched;
 end loop;
end $$;

create function public.register_document_pdf_artifact(p_version uuid,p_sha256 text,p_byte_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.document_versions%rowtype; path text;
begin
 if p_version is null or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size is null or p_byte_size<9 or p_byte_size>8000000 then raise exception 'INVALID_PDF_ARTIFACT' using errcode='22023';end if;
 select * into v from private.document_versions where id=p_version for update;
 if not found then raise exception 'DOCUMENT_VERSION_UNAVAILABLE' using errcode='42501';end if;
 path:=v.business_id::text||'/'||v.kind||'/'||v.document_id::text||'/'||v.id::text||'.pdf';
 if v.pdf_sha256 is not null and (v.pdf_sha256<>p_sha256 or v.pdf_path is distinct from path or v.pdf_bucket is distinct from 'finviant-document-pdfs' or v.pdf_byte_size is distinct from p_byte_size) then raise exception 'PDF_ARTIFACT_CONFLICT' using errcode='23514';end if;
 if not exists(select 1 from storage.objects where bucket_id='finviant-document-pdfs' and name=path) then raise exception 'PDF_OBJECT_NOT_SAVED' using errcode='23514';end if;
 delete from private.attachment_reservations where bucket_id='finviant-document-pdfs' and object_name=path and business_id=v.business_id;
 update private.document_versions set pdf_bucket='finviant-document-pdfs',pdf_path=path,pdf_sha256=p_sha256,pdf_byte_size=p_byte_size,pdf_created_at=coalesce(pdf_created_at,now()) where id=p_version;
 return public.document_pdf_artifact_context(p_version);
end $$;

create function public.freeze_document_email_attachment(p_request uuid,p_lease uuid,p_version uuid,p_filename text,p_content text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.finviant_email_outbox%rowtype;v private.document_versions%rowtype; bytes bytea;
begin
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if not found or p_lease is null or o.lease_id is distinct from p_lease or o.status<>'sending' or o.lease_until<=clock_timestamp() or o.document_version_id is distinct from p_version then raise exception 'STALE_SEND_LEASE' using errcode='23514';end if;
 select * into v from private.document_versions where id=p_version and business_id=o.business_id and document_id=o.document_id and kind=case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end;
 if not found or v.pdf_sha256 is null or v.pdf_sha256 is distinct from p_sha256 then raise exception 'PDF_ARTIFACT_NOT_READY' using errcode='23514';end if;
 if o.pdf_frozen_at is not null then
  if o.pdf_sha256 is distinct from p_sha256 or jsonb_typeof(o.payload->'attachments') is distinct from 'array' or jsonb_array_length(o.payload->'attachments')<>1 then raise exception 'PDF_PAYLOAD_CONFLICT' using errcode='23514';end if;
  return o.payload;
 end if;
 if p_filename is null or p_filename !~ '^[-A-Za-z0-9_.]{1,120}\.pdf$' or p_content is null or length(p_content)>10666672 or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_PDF_ATTACHMENT' using errcode='22023';end if;
 begin bytes:=decode(p_content,'base64');exception when others then raise exception 'INVALID_PDF_ATTACHMENT' using errcode='22023';end;
 if octet_length(bytes) is distinct from v.pdf_byte_size or encode(sha256(bytes),'hex')<>p_sha256 or substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'PDF_ATTACHMENT_INTEGRITY_FAILED' using errcode='23514';end if;
 update private.finviant_email_outbox set payload=jsonb_set(payload,'{attachments}',jsonb_build_array(jsonb_build_object('filename',p_filename,'content',p_content,'content_type','application/pdf')),true),pdf_sha256=p_sha256,pdf_frozen_at=now() where id=o.id returning payload into o.payload;
 return o.payload;
end $$;

-- This is called only on the code path before a provider request is made.
-- A failed artifact lookup must not exhaust the provider-attempt budget.
create function public.release_document_pdf_claim(p_request uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare o private.finviant_email_outbox%rowtype;
begin
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if not found or p_lease is null or o.lease_id is distinct from p_lease or o.status<>'sending' or o.document_version_id is null then return false;end if;
 update private.finviant_email_outbox set status='queued',attempts=greatest(attempts-1,0),lease_id=null,lease_until=null,
  last_code='pdf_artifact_unavailable',next_attempt_at=now()+interval '1 minute' where id=o.id;
 update public.messages set status='queued' where id=o.id and business_id=o.business_id;
 return true;
end $$;
revoke all on function public.release_document_pdf_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_document_pdf_claim(uuid,uuid) to service_role;

revoke all on function public.document_pdf_artifact_context(uuid),public.register_document_pdf_artifact(uuid,text,integer),public.freeze_document_email_attachment(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.document_pdf_artifact_context(uuid),public.register_document_pdf_artifact(uuid,text,integer),public.freeze_document_email_attachment(uuid,uuid,uuid,text,text,text) to service_role;

-- Retain the existing permission, private-beta recipient, quota, frozen-recipient
-- and request-id guards. Only newly queued documents get a canonical revision.
alter function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text) set schema private;
alter function private.prepare_document_email(uuid,uuid,text,uuid,uuid,text) rename to prepare_document_email_before_pdf;
revoke all on function private.prepare_document_email_before_pdf(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.prepare_document_email_pdf(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text,p_expected_revision_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prepared jsonb;version jsonb;share jsonb;o private.finviant_email_outbox%rowtype;token text;old_approval text;link text;label text;number text;company text;sender_name text;customer_name text;contact_text text;body_text text;new_payload jsonb;
begin
 if p_actor is null or private.member_module_access(p_business,p_actor,'billing') is distinct from true then raise exception 'Billing access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 -- An existing operation retains exactly its original payload, PDF and key.
 if exists(select 1 from private.finviant_email_outbox where id=p_request) then
  prepared:=private.prepare_document_email_before_pdf(p_actor,p_business,p_kind,p_document,p_request,p_origin);
  select * into o from private.finviant_email_outbox where id=p_request;
  if p_expected_revision_id is not null and o.document_version_id is distinct from p_expected_revision_id and o.status not in ('accepted','delivered') then raise exception 'PENDING_DOCUMENT_VERSION_CONFLICT' using errcode='23514';end if;
  return prepared;
 end if;
 version:=private.publish_document_version(p_actor,p_business,p_kind,p_document);
 if p_expected_revision_id is not null and (version->>'version_id')::uuid is distinct from p_expected_revision_id then raise exception 'DOCUMENT_VERSION_CHANGED' using errcode='23514';end if;
 prepared:=private.prepare_document_email_before_pdf(p_actor,p_business,p_kind,p_document,p_request,p_origin);
 if (prepared->>'id')::uuid<>p_request then
  select * into o from private.finviant_email_outbox where id=(prepared->>'id')::uuid;
  if p_expected_revision_id is not null and o.document_version_id is distinct from p_expected_revision_id then raise exception 'PENDING_DOCUMENT_VERSION_CONFLICT' using errcode='23514';end if;
  return prepared;
 end if;
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if not found or o.status<>'queued' or o.attempts<>0 then raise exception 'SEND_NOT_FRESH' using errcode='23514';end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 share:=private.create_document_share(p_actor,p_business,p_kind,p_document,token,(version->>'version_id')::uuid);
 -- Retire only the unused approval link that the legacy preparation just made.
 old_approval:=(regexp_match(o.payload->>'text','/\?approval=([a-f0-9]{64})'))[1];
 if old_approval is not null then update public.document_approval_links set revoked_at=now()
  where business_id=p_business and token_hash=encode(sha256(convert_to(old_approval,'UTF8')),'hex') and created_by_user_id=p_actor and revoked_at is null;end if;
 link:=p_origin||'/?document_share='||token;
 label:=case p_kind when 'invoice' then 'Invoice' when 'estimate' then 'Estimate' else 'Change order' end;
 number:=coalesce(version#>>'{snapshot,number}',label);company:=coalesce(version#>>'{snapshot,company,name}','Your business');
 sender_name:=coalesce(nullif(btrim(left(regexp_replace(company,'[^[:alnum:] ., &''()-]','','g'),80)),''),'Business');
 customer_name:=coalesce(nullif(version#>>'{snapshot,customer,name}',''),'Customer');
 contact_text:=concat_ws(' · ',nullif(version#>>'{snapshot,company,email}',''),nullif(version#>>'{snapshot,company,phone}',''));
 body_text:=company||E'\n'||label||' '||number||E'\n\nHello '||customer_name||E',\n\nYour document is attached as a PDF.\n\nView this document'||case when p_kind='invoice' then ' and its current payment status' else ' and record your decision' end||': '||link||E'\n\n'||contact_text||E'\nKeep this private document link secure.';
 new_payload:=(o.payload-'html'-'text')||jsonb_build_object('from','"'||sender_name||' via Finviant" <adminsupport@finviant.com>','text',body_text,'html','<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#193843;line-height:1.6"><p>'||private.html_escape(company)||'</p><h1>'||private.html_escape(label||' '||number)||'</h1><p>Hello '||private.html_escape(customer_name)||',</p><p>Your finished document is attached as a PDF.</p><p><a href="'||private.html_escape(link)||'">'||case when p_kind='invoice' then 'View invoice and payment options' else 'View and respond to document' end||'</a></p><p>'||private.html_escape(contact_text)||'</p><p>Keep this private document link secure.</p></body></html>');
 update private.finviant_email_outbox set document_version_id=(version->>'version_id')::uuid,payload=new_payload where id=p_request;
 update public.messages set body=body_text where id=p_request and business_id=p_business;
 return prepared||jsonb_build_object('document_version_id',version->>'version_id');
end $$;
revoke all on function private.prepare_document_email_pdf(uuid,uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.prepare_document_email(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text) returns jsonb
language sql security definer set search_path='' as $$ select private.prepare_document_email_pdf(p_actor,p_business,p_kind,p_document,p_request,p_origin,null) $$;
create function public.prepare_document_email(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text,p_expected_revision_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select private.prepare_document_email_pdf(p_actor,p_business,p_kind,p_document,p_request,p_origin,p_expected_revision_id) $$;

-- Recipient guard calls the canonical six-argument preparation above. A version
-- mismatch rolls the complete new preparation back before any provider call.
create function public.prepare_review_document_email(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text,p_recipient text,p_expected_revision_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existed boolean;prepared jsonb;version uuid;send_status text;
begin
 existed:=exists(select 1 from private.finviant_email_outbox where id=p_request);
 prepared:=public.prepare_review_document_email(p_actor,p_business,p_kind,p_document,p_request,p_origin,p_recipient);
 if p_expected_revision_id is not null then
  select document_version_id,status into version,send_status from private.finviant_email_outbox where id=(prepared->>'id')::uuid;
  if version is distinct from p_expected_revision_id then
   if existed and send_status not in ('accepted','delivered') then raise exception 'PENDING_DOCUMENT_VERSION_CONFLICT' using errcode='23514';end if;
   if not existed then raise exception 'DOCUMENT_VERSION_CHANGED' using errcode='23514';end if;
  end if;
 end if;
 return prepared;
end $$;

-- Reminder semantics and reviewed body remain intact; attach the immutable
-- invoice revision without replacing the operator-reviewed reminder text.
alter function public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb) set schema private;
alter function private.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb) rename to prepare_invoice_reminder_email_before_pdf;
revoke all on function private.prepare_invoice_reminder_email_before_pdf(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.prepare_invoice_reminder_email(p_actor uuid,p_business uuid,p_document uuid,p_request uuid,p_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existed boolean;prepared jsonb;version jsonb;
begin
 existed:=exists(select 1 from private.finviant_email_outbox where id=p_request);
 prepared:=private.prepare_invoice_reminder_email_before_pdf(p_actor,p_business,p_document,p_request,p_review);
 if not existed and (prepared->>'id')::uuid=p_request then
  version:=private.publish_document_version(p_actor,p_business,'invoice',p_document);
  update private.finviant_email_outbox set document_version_id=(version->>'version_id')::uuid where id=p_request;
 end if;
 return prepared;
end $$;
create function public.prepare_invoice_reminder_email(p_actor uuid,p_business uuid,p_document uuid,p_request uuid,p_review jsonb,p_expected_revision_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existed boolean;prepared jsonb;version uuid;send_status text;
begin
 existed:=exists(select 1 from private.finviant_email_outbox where id=p_request);
 prepared:=public.prepare_invoice_reminder_email(p_actor,p_business,p_document,p_request,p_review);
 if p_expected_revision_id is not null then
  select document_version_id,status into version,send_status from private.finviant_email_outbox where id=(prepared->>'id')::uuid;
  if version is distinct from p_expected_revision_id then
   if existed and send_status not in ('accepted','delivered') then raise exception 'PENDING_DOCUMENT_VERSION_CONFLICT' using errcode='23514';end if;
   if not existed then raise exception 'DOCUMENT_VERSION_CHANGED' using errcode='23514';end if;
  end if;
 end if;
 return prepared;
end $$;

revoke all on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.prepare_document_email(uuid,uuid,text,uuid,uuid,text,uuid),public.prepare_review_document_email(uuid,uuid,text,uuid,uuid,text,text,uuid),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.prepare_document_email(uuid,uuid,text,uuid,uuid,text,uuid),public.prepare_review_document_email(uuid,uuid,text,uuid,uuid,text,text,uuid),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb,uuid) to service_role;

-- Older workers cannot send a newly published document before its PDF is frozen.
alter function public.claim_document_email(uuid) set schema private;
alter function private.claim_document_email(uuid) rename to claim_document_email_before_pdf;
revoke all on function private.claim_document_email_before_pdf(uuid) from public,anon,authenticated,service_role;
create function public.claim_document_email(p_request uuid,p_pdf_capable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare version uuid;payload jsonb;claimed jsonb;
begin
 select document_version_id,o.payload into version,payload from private.finviant_email_outbox o where id=p_request;
 if version is not null and p_pdf_capable is distinct from true and not(payload ? 'attachments') then
  return jsonb_build_object('id',p_request,'status','pdf_artifact_required');
 end if;
 claimed:=private.claim_document_email_before_pdf(p_request);
 return case when claimed->>'status'='claimed' then claimed||jsonb_build_object('document_version_id',version) else claimed end;
end $$;
create function public.claim_document_email(p_request uuid) returns jsonb
language sql security definer set search_path='' as $$ select public.claim_document_email(p_request,false) $$;
revoke all on function public.claim_document_email(uuid),public.claim_document_email(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_document_email(uuid),public.claim_document_email(uuid,boolean) to service_role;
