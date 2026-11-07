-- Google review links are chosen by the primary owner. Saved links can be
-- cleared at any tier, and are retained if the business downgrades.
alter table public.businesses add column google_review_url text;
alter table public.businesses add constraint businesses_google_review_url_check
  check (google_review_url is null or google_review_url ~ '^https://(g[.]page/(r/)?[A-Za-z0-9_-]{1,220}/review|search[.]google[.]com/local/writereview[?]placeid=[A-Za-z0-9_-]{1,220})$');

create function private.guard_google_review_url() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.google_review_url is not null and
    (not private.is_primary_owner(new.id) or private.effective_plan(new.id) not in ('basic','pro')) then
    raise exception 'A paid plan and primary owner access are required to save a Google review link.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and auth.uid() is not null and not private.is_primary_owner(new.id) then
    raise exception 'Only the primary owner can change the Google review link.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger guard_google_review_url_update before update of google_review_url on public.businesses
  for each row when (old.google_review_url is distinct from new.google_review_url) execute function private.guard_google_review_url();
create trigger guard_google_review_url_insert before insert on public.businesses
  for each row when (new.google_review_url is not null) execute function private.guard_google_review_url();

-- The scan allowance is charged atomically before contacting AWS. Keep only
-- operation IDs and timestamps, never raw images or OCR content in this ledger.
create table private.receipt_scan_requests (
  business_id uuid not null references public.businesses(id) on delete cascade,
  request_id uuid not null,
  scan_month date not null,
  primary key(business_id, request_id)
);
create index receipt_scan_requests_month on private.receipt_scan_requests(business_id, scan_month);
alter table private.receipt_scan_requests enable row level security;
revoke all on private.receipt_scan_requests from public,anon,authenticated,service_role;
create policy receipt_scan_requests_no_client_access on private.receipt_scan_requests to authenticated using(false);

create function private.reserve_receipt_scan(p_business uuid,p_request uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  plan text;
  allowance integer;
  month_start date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
  if p_actor is null or p_request is null then raise exception 'Scan access required.' using errcode='42501'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  if not private.fin_access(p_business,'bookkeeping_entries',true) then
    raise exception 'Expense access is required to scan receipts.' using errcode='42501';
  end if;
  plan:=private.effective_plan(p_business);
  if plan not in ('basic','pro') then
    raise exception 'Receipt scanning requires Individual or Business Pro.' using errcode='42501';
  end if;
  allowance:=case when plan='pro' then 200 else 50 end;
  perform pg_advisory_xact_lock(hashtextextended('finviant-receipt-scans:'||p_business::text,0));
  if exists(select 1 from private.receipt_scan_requests where business_id=p_business and request_id=p_request) then
    raise exception 'This receipt was already submitted. Check the expense draft or choose the image again.' using errcode='23505';
  end if;
  if (select count(*) from private.receipt_scan_requests where business_id=p_business and scan_month=month_start)>=allowance then
    raise exception 'This workspace reached its monthly receipt scan allowance. Enter the expense manually or try again next month.' using errcode='23514';
  end if;
  insert into private.receipt_scan_requests values(p_business,p_request,month_start);
end $$;
create function public.reserve_receipt_scan(p_business uuid,p_request uuid,p_actor uuid) returns void
language sql security invoker set search_path='' as $$
  select private.reserve_receipt_scan(p_business,p_request,p_actor)
$$;
revoke all on function private.reserve_receipt_scan(uuid,uuid,uuid),public.reserve_receipt_scan(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.reserve_receipt_scan(uuid,uuid,uuid),public.reserve_receipt_scan(uuid,uuid,uuid) to service_role;

-- Receipts share the existing private photo bucket and workspace quota. A
-- receipt belongs to the ledger expense, including general overhead expenses.
alter table public.bookkeeping_entries add constraint bookkeeping_entries_id_business_key unique(id,business_id);
alter table public.record_photos
  add column expense_id uuid unique,
  drop constraint record_photos_check,
  add constraint record_photos_check check (num_nonnulls(job_id,estimate_id,invoice_id,expense_id)=1),
  add constraint record_photos_expense_fk foreign key (expense_id,business_id)
    references public.bookkeeping_entries(id,business_id) on delete cascade;
create policy record_receipts_finance_read on public.record_photos as restrictive for select to authenticated
  using (expense_id is null or private.fin_access(business_id,'bookkeeping_entries'));
create policy record_receipts_finance_insert on public.record_photos as restrictive for insert to authenticated
  with check (expense_id is null);
create policy record_receipts_finance_delete on public.record_photos as restrictive for delete to authenticated
  using (expense_id is null or private.fin_access(business_id,'bookkeeping_entries',true));
create policy record_receipt_objects_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'finviant-record-photos' or not exists(select 1 from public.record_photos
    where storage_path=name and expense_id is not null) or exists(select 1 from public.record_photos
    where storage_path=name and expense_id is not null and private.fin_access(business_id,'bookkeeping_entries',true)));

create function private.save_receipt_expense(p_entry jsonb,p_file_name text,p_byte_size integer) returns text
language plpgsql security definer set search_path='' as $$
declare
  requested public.bookkeeping_entries:=jsonb_populate_record(null::public.bookkeeping_entries,p_entry);
  existing public.bookkeeping_entries;
  photo public.record_photos;
begin
  if not private.fin_access(requested.business_id,'bookkeeping_entries',true)
    or not private.velnu_has_accepted_terms() then
    raise exception 'Expense access is required.' using errcode='42501';
  end if;
  if requested.id is null or requested.direction is distinct from 'expense' or requested.currency is distinct from 'USD'
    or requested.amount is null or (p_entry->>'amount')::numeric<>requested.amount
    or p_file_name is null or length(p_file_name) not between 1 and 240
    or p_byte_size is null or p_byte_size not between 1 and 5000000 then
    raise exception 'Check the receipt and expense details.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-receipt-expense:'||requested.id::text,0));
  select * into existing from public.bookkeeping_entries where id=requested.id and business_id=requested.business_id;
  if found then
    select * into photo from public.record_photos where expense_id=existing.id and business_id=existing.business_id;
    if existing.created_by is distinct from auth.uid() or not found or photo.byte_size<>p_byte_size or photo.file_name<>p_file_name
      or (existing.entry_date,existing.direction,existing.currency,existing.amount,existing.category,existing.description,
        existing.notes,existing.job_id,existing.estimate_id,existing.invoice_id) is distinct from
        (requested.entry_date,requested.direction,requested.currency,requested.amount,requested.category,requested.description,
        requested.notes,requested.job_id,requested.estimate_id,requested.invoice_id) then
      raise exception 'An expense was already saved with different details. Open the workbook to review it.' using errcode='23505';
    end if;
    return photo.storage_path;
  end if;
  if private.effective_plan(requested.business_id) not in ('basic','pro') then
    raise exception 'Receipt capture requires Individual or Business Pro.' using errcode='42501';
  end if;
  if (requested.job_id is not null and not private.member_module_access(requested.business_id,auth.uid(),'jobs'))
    or ((requested.estimate_id is not null or requested.invoice_id is not null)
      and not private.member_module_access(requested.business_id,auth.uid(),'billing')) then
    raise exception 'You do not have access to the linked record.' using errcode='42501';
  end if;
  if (private.business_storage_usage(requested.business_id)->>'remaining_bytes')::bigint < p_byte_size then
    raise exception 'Business storage is full. Remove an optional attachment or save the expense without the receipt.' using errcode='23514';
  end if;
  insert into public.bookkeeping_entries(id,business_id,entry_date,direction,amount,category,description,notes,currency,job_id,estimate_id,invoice_id)
    values(requested.id,requested.business_id,requested.entry_date,'expense',requested.amount,requested.category,requested.description,
      requested.notes,'USD',requested.job_id,requested.estimate_id,requested.invoice_id);
  insert into public.record_photos(id,business_id,expense_id,file_name,byte_size,media_type)
    values(requested.id,requested.business_id,requested.id,p_file_name,p_byte_size,'image/jpeg') returning * into photo;
  return photo.storage_path;
end $$;
create function public.save_receipt_expense(p_entry jsonb,p_file_name text,p_byte_size integer) returns text
language sql security invoker set search_path='' as $$
  select private.save_receipt_expense(p_entry,p_file_name,p_byte_size)
$$;
revoke all on function private.save_receipt_expense(jsonb,text,integer),public.save_receipt_expense(jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_receipt_expense(jsonb,text,integer),public.save_receipt_expense(jsonb,text,integer) to authenticated;

-- Remove the binary through the Storage API before deleting receipt metadata.
-- Serialize against reservation so a racing upload cannot leave an orphan.
create function private.guard_receipt_removal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('finviant-storage:'||old.business_id::text,0));
  if exists(select 1 from storage.objects where bucket_id='finviant-record-photos' and name=old.storage_path) then
    raise exception 'Remove this expense and its receipt from Financial Performance or the job expense list.' using errcode='23503';
  end if;
  if exists(select 1 from private.attachment_reservations where bucket_id='finviant-record-photos'
    and object_name=old.storage_path and created_at>now()-interval '10 minutes') then
    raise exception 'This receipt upload is still pending. Retry the removal shortly.' using errcode='23514';
  end if;
  delete from private.attachment_reservations where bucket_id='finviant-record-photos' and object_name=old.storage_path;
  return old;
end $$;
create trigger guard_receipt_removal before delete on public.record_photos
  for each row when (old.expense_id is not null) execute function private.guard_receipt_removal();
revoke all on function private.guard_receipt_removal(),private.guard_google_review_url() from public,anon,authenticated,service_role;

create or replace function private.reserve_attachment(p_actor uuid,p_bucket text,p_path text,p_bytes bigint) returns void
language plpgsql volatile security definer set search_path='' as $$
declare b uuid; used bigint; pending bigint; plan_name text; photo public.record_photos;
begin
  if p_actor is null or p_bucket not in ('finviant-record-photos','velnu-business-logos')
    or p_path !~* '^[0-9a-f-]{36}/(logo-)?[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid upload' using errcode='22023';
  end if;
  b:=split_part(p_path,'/',1)::uuid;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  if not private.is_business_member(b) then raise exception 'Not authorized' using errcode='42501'; end if;
  plan_name:=private.attachment_plan(b);
  if p_bucket='velnu-business-logos' then
    if not private.is_primary_owner(b,p_actor) or plan_name not in ('basic','pro') then
      raise exception 'Hosted logos require owner access and an activated paid plan.' using errcode='42501'; end if;
  else
    select * into photo from public.record_photos where business_id=b and storage_path=p_path and created_by=p_actor;
    if not found or photo.byte_size<>p_bytes then
      raise exception 'Photo access or size is invalid' using errcode='42501';
    end if;
    if photo.expense_id is not null then
      if not private.fin_access(b,'bookkeeping_entries',true) then
        raise exception 'Expense access is required.' using errcode='42501';
      end if;
    elsif not private.has_business_role(b,case when photo.job_id is not null then array['owner','admin','office','technician'] else array['owner','admin','office'] end)
      or not private.member_module_access(b,p_actor,case when photo.job_id is not null then 'jobs' else 'billing' end) then
      raise exception 'Photo access or size is invalid' using errcode='42501';
    end if;
  end if;
  if p_bytes is null or p_bytes<1 or p_bytes>(case when p_bucket='velnu-business-logos' then 2000000 else 10000000 end) then
    raise exception 'Pictures must be at most 10 MB and logos at most 2 MB.' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-storage:'||b::text,0));
  if photo.expense_id is not null then
    if not exists(select 1 from public.record_photos where id=photo.id and business_id=b) then
      raise exception 'This expense was removed.' using errcode='42501';
    end if;
    -- The same receipt can safely retry an interrupted upload without
    -- charging storage twice. Storage still rejects replacing a stored file.
    if exists(select 1 from private.attachment_reservations
      where bucket_id=p_bucket and object_name=p_path and actor_id=p_actor and bytes=p_bytes) then
      update private.attachment_reservations set created_at=now()
        where bucket_id=p_bucket and object_name=p_path;
      return;
    end if;
  end if;
  -- One statement/snapshot prevents an in-flight reservation moving into
  -- storage between separate SUM queries and being counted in neither.
  select
    (select coalesce(sum((o.metadata->>'size')::bigint),0) from storage.objects o
      where o.bucket_id in ('finviant-record-photos','velnu-business-logos') and o.name like b::text||'/%'),
    (select coalesce(sum(r.bytes),0) from private.attachment_reservations r where r.business_id=b
      and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name))
    into used,pending;
  if used+pending+p_bytes>private.attachment_limit(plan_name) then
    raise exception 'Business storage allowance reached. Remove optional attachments to make room. Existing records and payments remain available.' using errcode='23514'; end if;
  insert into private.attachment_reservations(bucket_id,object_name,business_id,actor_id,bytes) values(p_bucket,p_path,b,p_actor,p_bytes);
end;
$$;
