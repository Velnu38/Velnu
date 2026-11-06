-- Business-wide attachment quotas. Storage objects remain managed exclusively
-- by the Storage API: no custom triggers or direct object mutations.
alter table private.business_entitlements drop constraint business_entitlements_plan_check;
alter table private.business_entitlements add constraint business_entitlements_plan_check
  check (plan in ('free','basic','pro'));

create function private.attachment_plan(b uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select plan from private.business_entitlements
    where business_id=b and (valid_until is null or valid_until>now())), 'free');
$$;
revoke all on function private.attachment_plan(uuid) from public,anon,authenticated;

create function private.attachment_limit(plan_name text) returns bigint
language sql immutable set search_path='' as $$
  select case plan_name when 'pro' then 10000000000::bigint
    when 'basic' then 2000000000::bigint else 100000000::bigint end;
$$;
revoke all on function private.attachment_limit(text) from public,anon,authenticated;

-- Storage remains provider-owned; use its existing bucket/name indexes.
create table private.attachment_reservations (
  bucket_id text not null, object_name text not null, business_id uuid not null references public.businesses(id),
  actor_id uuid not null, bytes bigint not null check(bytes between 1 and 10000000),
  created_at timestamptz not null default now(), primary key(bucket_id,object_name)
);
create index attachment_reservations_business on private.attachment_reservations(business_id);
alter table private.attachment_reservations enable row level security;
revoke all on private.attachment_reservations from public,anon,authenticated,service_role;
create policy attachment_reservations_no_client_access on private.attachment_reservations to authenticated using(false);

create function private.business_storage_usage(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare plan_name text; used bigint; lim bigint; files bigint; pending bigint;
begin
  if auth.uid() is null or not private.is_business_member(b) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  plan_name:=private.attachment_plan(b); lim:=private.attachment_limit(plan_name);
  select coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$'
    then (metadata->>'size')::bigint else 0 end),0),count(*) into used,files
  from storage.objects where bucket_id in ('finviant-record-photos','velnu-business-logos')
    and name like b::text||'/%';
  select coalesce(sum(r.bytes),0) into pending from private.attachment_reservations r where business_id=b
    and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name);
  used:=used+pending;
  return jsonb_build_object('pending_bytes',pending,'plan',plan_name,'used_bytes',used,'limit_bytes',lim,
    'remaining_bytes',greatest(0,lim-used),'file_count',files,
    'photo_bytes_limit',10000000,'logo_bytes_limit',2000000,
    'logo_allowed',plan_name in ('basic','pro'),
    'warning',case when used>=lim then 'full' when used>=lim*0.95 then 'critical'
      when used>=lim*0.8 then 'warning' else 'none' end);
end;
$$;
revoke all on function private.business_storage_usage(uuid) from public,anon;
grant execute on function private.business_storage_usage(uuid) to authenticated;
create function public.get_business_storage_usage(p_business_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.business_storage_usage(p_business_id);
$$;
revoke all on function public.get_business_storage_usage(uuid) from public,anon;
grant execute on function public.get_business_storage_usage(uuid) to authenticated;

-- Only the authenticated upload service may create objects. The service measures
-- the binary, reserves quota transactionally, then uses the Storage API. This
-- does not depend on provider-specific RLS preflight/commit behavior.
create function private.reserve_attachment(p_actor uuid,p_bucket text,p_path text,p_bytes bigint) returns void
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
    if not found or photo.byte_size<>p_bytes or
      not private.has_business_role(b,case when photo.job_id is not null then array['owner','admin','office','technician'] else array['owner','admin','office'] end)
      or not private.member_module_access(b,p_actor,case when photo.job_id is not null then 'jobs' else 'billing' end)
    then raise exception 'Photo access or size is invalid' using errcode='42501'; end if;
  end if;
  if p_bytes is null or p_bytes<1 or p_bytes>(case when p_bucket='velnu-business-logos' then 2000000 else 10000000 end) then
    raise exception 'Pictures must be at most 10 MB and logos at most 2 MB.' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-storage:'||b::text,0));
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
revoke all on function private.reserve_attachment(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function private.reserve_attachment(uuid,text,text,bigint) to service_role;
create function public.reserve_attachment(p_actor uuid,p_bucket text,p_path text,p_bytes bigint) returns void
language sql volatile security invoker set search_path='' as $$select private.reserve_attachment(p_actor,p_bucket,p_path,p_bytes)$$;
revoke all on function public.reserve_attachment(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_attachment(uuid,text,text,bigint) to service_role;

create function private.finish_attachment(p_bucket text,p_path text) returns void
language sql volatile security definer set search_path='' as $$
  delete from private.attachment_reservations r where r.bucket_id=p_bucket and r.object_name=p_path
    and exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name and (o.metadata->>'size')::bigint=r.bytes);
$$;
revoke all on function private.finish_attachment(text,text) from public,anon,authenticated;
grant execute on function private.finish_attachment(text,text) to service_role;
create function public.finish_attachment(p_bucket text,p_path text) returns void
language sql volatile security invoker set search_path='' as $$select private.finish_attachment(p_bucket,p_path)$$;
revoke all on function public.finish_attachment(text,text) from public,anon,authenticated;
grant execute on function public.finish_attachment(text,text) to service_role;

create policy finviant_attachment_service_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id not in ('finviant-record-photos','velnu-business-logos'));
create policy finviant_attachment_no_overwrite on storage.objects as restrictive for update to authenticated
using(bucket_id not in ('finviant-record-photos','velnu-business-logos'))
with check(bucket_id not in ('finviant-record-photos','velnu-business-logos'));

-- Leave SELECT and DELETE policies unchanged: a full or downgraded workspace
-- can still read/download and remove files. No financial tables are capped.
alter table public.record_photos add constraint record_photos_upload_size
  check(byte_size<=10000000) not valid;
-- NOT VALID preserves any older 10 MiB photo; all new rows use 10 decimal MB.

-- Publish the revised agreement without invalidating existing records.
create or replace function private.velnu_has_accepted_terms() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.user_agreement_acceptances a
    where a.user_id=auth.uid() and a.terms_accepted and a.ai_disclosure_acknowledged
      and a.electronic_records_consent and a.agreement_version in
      ('2026-10-26-v1','2026-10-26-v2','2026-10-27-v3','2026-11-06-v4'));
$$;
drop policy velnu_agreement_acceptance_insert on public.user_agreement_acceptances;
create policy velnu_agreement_acceptance_insert on public.user_agreement_acceptances for insert to authenticated
with check(user_id=auth.uid() and agreement_version in ('2026-10-27-v3','2026-11-06-v4')
  and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent
  and acceptance_method='checkbox_and_button' and selected_tier_at_acceptance is not null
  and exists(select 1 from public.user_plan_preferences p where p.user_id=auth.uid()
    and p.selected_tier=selected_tier_at_acceptance));
