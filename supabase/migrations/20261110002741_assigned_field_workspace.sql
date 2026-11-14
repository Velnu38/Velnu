-- An owner explicitly links an existing account seat to a worker profile.
create table private.field_accounts(
 business_id uuid not null,user_id uuid not null,worker_id uuid not null,enabled boolean not null default true,version integer not null default 1,
 primary key(business_id,user_id),unique(business_id,worker_id),
 foreign key(business_id,user_id) references public.business_members(business_id,user_id) on delete cascade,
 foreign key(business_id,worker_id) references private.worker_profiles(business_id,id)
);
alter table private.field_accounts enable row level security;
revoke all on private.field_accounts from public,anon,authenticated,service_role;
create function private.field_mode(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$select actor is not null and exists(select 1 from private.field_accounts where business_id=b and user_id=actor)$$;
create function private.field_active(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.effective_plan(b)='pro' and private.velnu_has_accepted_terms() and exists(select 1 from private.field_accounts f join public.business_members m on m.business_id=f.business_id and m.user_id=f.user_id join private.worker_profiles w on w.business_id=f.business_id and w.id=f.worker_id where f.business_id=b and f.user_id=auth.uid() and m.role='technician' and f.enabled and w.active),false)
$$;
create function private.field_job_access(b uuid,jid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.field_active(b) and exists(select 1 from private.field_accounts f join public.jobs j on j.business_id=f.business_id and j.id=jid where f.business_id=b and f.user_id=auth.uid() and (f.worker_id=any(j.assigned_user_ids) or exists(select 1 from public.appointments a where a.business_id=b and a.job_id=jid and a.status not in('canceled','no_show') and f.worker_id=any(coalesce(a.visit_worker_ids,array[a.assigned_user_id])))))
$$;
revoke all on function private.field_mode(uuid,uuid),private.field_active(uuid),private.field_job_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.field_mode(uuid,uuid),private.field_active(uuid),private.field_job_access(uuid,uuid) to authenticated;

-- General workspace APIs fail closed for restricted field accounts. Narrow RPCs below
-- do not confer module-wide permission or depend on cached JWT metadata.
create or replace function private.is_business_member(target_business_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid())
$$;
create or replace function private.has_business_role(target_business_id uuid,allowed_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid() and bm.role=any(allowed_roles))
$$;
create or replace function private.can_write_business(target_business_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid() and bm.role in('owner','admin','office','technician'))
$$;
create or replace function private.member_module_access(b uuid,actor uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$
 select not private.field_mode(b,actor) and (private.effective_plan(b)='pro' or private.is_primary_owner(b,actor)) and exists(select 1 from public.business_members m where m.business_id=b and m.user_id=actor and (private.is_primary_owner(b,actor) or (feature=any(m.access_modules) and (feature not in('billing','finances') or m.role in('owner','admin','office')))))
$$;
create policy field_membership_self on public.business_members for select to authenticated using(user_id=auth.uid() and private.field_mode(business_id));
create policy field_business_profile on public.businesses for select to authenticated using(private.field_mode(id));

create function public.get_field_access_context(p_business uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('restricted',true,'active',private.field_active(p_business),'worker_id',f.worker_id) from private.field_accounts f join public.business_members m using(business_id,user_id) where f.business_id=p_business and f.user_id=auth.uid()),jsonb_build_object('restricted',false))
$$;
create function public.get_field_accounts(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(p_business) then raise exception 'Primary owner access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(f)-'business_id') from private.field_accounts f where business_id=p_business),'[]'::jsonb);
end $$;
create function public.set_field_account(p_business uuid,p_user uuid,p_worker uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if not private.is_primary_owner(p_business) or private.effective_plan(p_business)<>'pro' then raise exception 'Primary owner and Pro access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-field-accounts:'||p_business::text,0));
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_user and role='technician') then raise exception 'Choose an existing field staff account. No account seat is created here.' using errcode='23514';end if;
 select version into v from private.field_accounts where business_id=p_business and user_id=p_user for update;
 if coalesce(v,0) is distinct from p_version then raise exception 'Field access changed. Refresh before editing.' using errcode='40001';end if;
 if p_worker is null then
  if v is null then raise exception 'Choose a worker profile before enabling field access.' using errcode='23514';end if;
  update private.field_accounts set enabled=false,version=version+1 where business_id=p_business and user_id=p_user;
 else
  if not exists(select 1 from private.worker_profiles where business_id=p_business and id=p_worker and active and not is_owner) then raise exception 'Choose an active worker profile.' using errcode='23514';end if;
  insert into private.field_accounts(business_id,user_id,worker_id,enabled,version) values(p_business,p_user,p_worker,true,1) on conflict(business_id,user_id) do update set worker_id=excluded.worker_id,enabled=true,version=private.field_accounts.version+1;
 end if;
 update public.business_members set access_modules='{}'::text[] where business_id=p_business and user_id=p_user;
end $$;
create function public.clear_field_account(p_business uuid,p_user uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if not private.is_primary_owner(p_business) then raise exception 'Primary owner access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-field-accounts:'||p_business::text,0));
 select version into v from private.field_accounts where business_id=p_business and user_id=p_user for update;
 if v is distinct from p_version then raise exception 'Field access changed. Refresh before editing.' using errcode='40001';end if;
 delete from private.field_accounts where business_id=p_business and user_id=p_user;
 update public.business_members set access_modules='{}'::text[] where business_id=p_business and user_id=p_user;
end $$;
revoke all on function public.clear_field_account(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.clear_field_account(uuid,uuid,integer) to authenticated;
create function private.guard_field_account_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.field_mode(new.business_id,new.user_id) and (new.role<>'technician' or cardinality(new.access_modules)>0) then raise exception 'Switch to general staff access before changing this account role or module access.' using errcode='23514';end if;return new;
end $$;
create trigger field_account_role_guard before update on public.business_members for each row execute function private.guard_field_account_role();
revoke all on function private.guard_field_account_role() from public,anon,authenticated,service_role;

create table private.field_time_submissions(
 id uuid primary key,business_id uuid not null,job_id uuid not null,visit_id uuid,worker_id uuid not null,submitted_by uuid not null references auth.users(id),
 worked_on date not null,minutes integer not null check(minutes between 1 and 1440),note text not null default '' check(length(note)<=400),
 status text not null default 'pending' check(status in('pending','posted','rejected')),approved_rate numeric(12,2),version integer not null default 1,
 reviewed_by uuid references auth.users(id),review_note text not null default '' check(length(review_note)<=400),created_at timestamptz not null default now(),
 foreign key(job_id,business_id) references public.jobs(id,business_id),foreign key(visit_id,business_id) references public.appointments(id,business_id),foreign key(business_id,worker_id) references private.worker_profiles(business_id,id)
);
create index field_time_job on private.field_time_submissions(business_id,job_id,created_at);
create index field_time_visit on private.field_time_submissions(visit_id,business_id) where visit_id is not null;
create index field_time_actor on private.field_time_submissions(submitted_by);
create index field_time_reviewer on private.field_time_submissions(reviewed_by) where reviewed_by is not null;
alter table private.field_time_submissions enable row level security;
revoke all on private.field_time_submissions from public,anon,authenticated,service_role;

create function public.get_field_jobs(p_business uuid,p_job uuid default null,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare wid uuid;
begin
 if not private.field_active(p_business) then raise exception 'Your assigned-job access is paused. Contact the business owner.' using errcode='42501';end if;
 select worker_id into wid from private.field_accounts where business_id=p_business and user_id=auth.uid();
 if p_job is not null and not private.field_job_access(p_business,p_job) then raise exception 'This job is not assigned to you.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'title',j.title,'description',j.description,'status',j.status,
 'customer',concat_ws(' ',c.first_name,c.last_name),'phone',c.phone,'address',concat_ws(', ',p.address_line1,p.city,p.state,p.postal_code),
 'visits',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status,'version',a.visit_version) order by a.starts_at,a.id) from public.appointments a where a.business_id=p_business and a.job_id=j.id and wid=any(coalesce(a.visit_worker_ids,array[a.assigned_user_id]))),'[]'::jsonb),
 'tasks',case when p_job is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'completed',t.completed,'version',t.version,'visit_id',t.visit_id,'can_update',(t.worker_id is null or t.worker_id=wid) and (t.visit_id is null or exists(select 1 from public.appointments va where va.business_id=p_business and va.job_id=j.id and va.id=t.visit_id and wid=any(coalesce(va.visit_worker_ids,array[va.assigned_user_id]))))) order by t.created_at,t.id) from private.job_tasks t where t.business_id=p_business and t.job_id=j.id),'[]'::jsonb) end,
 'time',case when p_job is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'worked_on',t.worked_on,'minutes',t.minutes,'note',t.note,'status',t.status,'review_note',t.review_note) order by t.created_at desc) from private.field_time_submissions t where t.business_id=p_business and t.job_id=j.id and t.submitted_by=auth.uid()),'[]'::jsonb) end)
 order by j.scheduled_start nulls last,j.id) from (select j0.* from public.jobs j0 where j0.business_id=p_business and (p_job is null or j0.id=p_job) and j0.status<>'canceled' and private.field_job_access(p_business,j0.id) order by j0.scheduled_start nulls last,j0.id limit case when p_job is null then 100 else 1 end offset case when p_job is null then greatest(coalesce(p_offset,0),0) else 0 end) j left join public.customers c on c.id=j.customer_id and c.business_id=j.business_id left join public.properties p on p.id=j.property_id and p.business_id=j.business_id
 where j.business_id=p_business and (p_job is null or j.id=p_job) and j.status<>'canceled' and private.field_job_access(p_business,j.id)),'[]'::jsonb);
end $$;

create function public.manage_field_job(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;j public.jobs%rowtype;t private.job_tasks%rowtype;a public.appointments%rowtype;entry private.field_time_submissions%rowtype;
begin
 if not private.field_job_access(p_business,p_job) then raise exception 'This job is not assigned to you.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||p_business::text,0));
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if j.status in('completed','canceled') then raise exception 'This job is closed. Contact the office.' using errcode='23514';end if;
 select worker_id into wid from private.field_accounts where business_id=p_business and user_id=auth.uid();
 if p_action='task' then
  select * into t from private.job_tasks where business_id=p_business and job_id=p_job and id=(p_input->>'id')::uuid for update;
  if not found or t.worker_id is not null and t.worker_id<>wid or t.visit_id is not null and not exists(select 1 from public.appointments va where va.id=t.visit_id and va.business_id=p_business and va.job_id=p_job and wid=any(coalesce(va.visit_worker_ids,array[va.assigned_user_id]))) then raise exception 'This task is not assigned to you.' using errcode='42501';end if;
  if t.completed=(p_input->>'completed')::boolean then return;end if;
  if t.version is distinct from(p_input->>'version')::integer then raise exception 'Task changed. Refresh before updating.' using errcode='40001';end if;
  update private.job_tasks set completed=(p_input->>'completed')::boolean,version=version+1,updated_at=now() where id=t.id;
 elsif p_action='time' then
  select * into entry from private.field_time_submissions where id=(p_input->>'id')::uuid;
  if found then
   if (entry.business_id,entry.job_id,entry.submitted_by,entry.worked_on,entry.minutes,entry.note,entry.visit_id) is distinct from(p_business,p_job,auth.uid(),(p_input->>'worked_on')::date,(p_input->>'minutes')::integer,coalesce(p_input->>'note',''),nullif(p_input->>'visit_id','')::uuid) then raise exception 'This request already saved different time.' using errcode='23505';end if;return;
  end if;
  if (p_input->>'worked_on')::date>(now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date then raise exception 'Record time for today or earlier.' using errcode='23514';end if;
  if nullif(p_input->>'visit_id','') is not null and not exists(select 1 from public.appointments where id=(p_input->>'visit_id')::uuid and business_id=p_business and job_id=p_job and wid=any(coalesce(visit_worker_ids,array[assigned_user_id]))) then raise exception 'Choose one of your visits for this job.' using errcode='42501';end if;
  if (select coalesce(sum(minutes),0) from private.field_time_submissions where business_id=p_business and worker_id=wid and worked_on=(p_input->>'worked_on')::date and status<>'rejected')+(p_input->>'minutes')::integer>1440 then raise exception 'Daily submitted time cannot exceed 24 hours.' using errcode='23514';end if;
  if (select count(*) from private.field_time_submissions where business_id=p_business and job_id=p_job)>=2000 then raise exception 'This job has reached 2,000 time submissions.' using errcode='23514';end if;
  insert into private.field_time_submissions(id,business_id,job_id,visit_id,worker_id,submitted_by,worked_on,minutes,note) values((p_input->>'id')::uuid,p_business,p_job,nullif(p_input->>'visit_id','')::uuid,wid,auth.uid(),(p_input->>'worked_on')::date,(p_input->>'minutes')::integer,coalesce(p_input->>'note',''));
 elsif p_action in('start_visit','finish_visit') then
  select * into a from public.appointments where id=(p_input->>'id')::uuid and business_id=p_business and job_id=p_job and wid=any(coalesce(visit_worker_ids,array[assigned_user_id])) for update;
  if not found then raise exception 'This visit is not assigned to you.' using errcode='42501';end if;
  if a.status=(case p_action when 'start_visit' then 'in_progress' else 'completed' end) then return;end if;
  if a.visit_version is distinct from(p_input->>'version')::integer then raise exception 'Visit changed. Refresh before updating.' using errcode='40001';end if;
  if a.status not in('scheduled','confirmed','in_progress') or a.starts_at>now() then raise exception 'Only a current, open visit can be updated.' using errcode='23514';end if;
  update public.appointments set status=case p_action when 'start_visit' then 'in_progress' else 'completed' end where id=a.id;
 else raise exception 'Unknown field action.' using errcode='22023';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),case p_action when 'time' then 'Field time submitted for office review' when 'task' then 'Field checklist updated' when 'start_visit' then 'Field visit started' else 'Field visit finished; job remains open' end);
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
end $$;

-- Photos use the same private storage and quota-controlled upload service.
drop policy owner_module_access on public.record_photos;
create policy owner_module_access on public.record_photos as restrictive for all to authenticated
 using(private.member_module_access(business_id,auth.uid(),case when job_id is not null then 'jobs' else 'billing' end) or expense_id is null and private.field_job_access(business_id,job_id))
 with check(private.member_module_access(business_id,auth.uid(),case when job_id is not null then 'jobs' else 'billing' end) or expense_id is null and private.field_job_access(business_id,job_id));
create policy field_photos_read on public.record_photos for select to authenticated using(expense_id is null and private.field_job_access(business_id,job_id));
-- Use a narrow definer to create metadata; direct table policies never grant job/customer access.
create function public.prepare_field_photo(p_business uuid,p_job uuid,p_id uuid,p_name text,p_bytes integer) returns text language plpgsql security definer set search_path='' as $$
declare result text;
begin
 if not private.field_job_access(p_business,p_job) or not exists(select 1 from public.jobs where business_id=p_business and id=p_job and status not in('completed','canceled')) then raise exception 'Assigned, open job access is required.' using errcode='42501';end if;
 insert into public.record_photos(id,business_id,job_id,file_name,byte_size,media_type,created_by) values(p_id,p_business,p_job,left(p_name,240),p_bytes,'image/jpeg',auth.uid()) returning storage_path into result;return result;
end $$;
create policy field_photos_delete on public.record_photos for delete to authenticated using(created_by=auth.uid() and expense_id is null and private.field_job_access(business_id,job_id));
create policy field_photo_objects_delete on storage.objects for delete to authenticated using(bucket_id='finviant-record-photos' and exists(select 1 from public.record_photos p where p.storage_path=name and p.created_by=auth.uid() and p.expense_id is null and private.field_job_access(p.business_id,p.job_id)));

revoke all on function public.get_field_access_context(uuid),public.get_field_accounts(uuid),public.set_field_account(uuid,uuid,uuid,integer),public.get_field_jobs(uuid,uuid,integer),public.manage_field_job(uuid,uuid,text,jsonb),public.prepare_field_photo(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_field_access_context(uuid),public.get_field_accounts(uuid),public.set_field_account(uuid,uuid,uuid,integer),public.get_field_jobs(uuid,uuid,integer),public.manage_field_job(uuid,uuid,text,jsonb),public.prepare_field_photo(uuid,uuid,uuid,text,integer) to authenticated;
CREATE OR REPLACE FUNCTION private.reserve_attachment(p_actor uuid, p_bucket text, p_path text, p_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b uuid; used bigint; pending bigint; plan_name text; photo public.record_photos;
begin
  if p_actor is null or p_bucket not in ('finviant-record-photos','velnu-business-logos')
    or p_path !~* '^[0-9a-f-]{36}/(logo-)?[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid upload' using errcode='22023';
  end if;
  b:=split_part(p_path,'/',1)::uuid;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  if not private.is_business_member(b) and not private.field_active(b) then raise exception 'Not authorized' using errcode='42501'; end if;
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
    elsif private.field_job_access(b,photo.job_id) then
      if photo.expense_id is not null or not exists(select 1 from public.jobs where id=photo.job_id and business_id=b and status not in('completed','canceled')) then raise exception 'Assigned open job required' using errcode='42501';end if;
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
      where o.bucket_id in ('finviant-record-photos','velnu-business-logos','finviant-document-pdfs') and o.name like b::text||'/%'),
    (select coalesce(sum(r.bytes),0) from private.attachment_reservations r where r.business_id=b
      and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name))
    into used,pending;
  if used+pending+p_bytes>private.attachment_limit(plan_name) then
    raise exception 'Business storage allowance reached. Remove optional attachments to make room. Existing records and payments remain available.' using errcode='23514'; end if;
  insert into private.attachment_reservations(bucket_id,object_name,business_id,actor_id,bytes) values(p_bucket,p_path,b,p_actor,p_bytes);
end;
$function$;

create or replace function private.business_storage_usage(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare plan_name text; used bigint; lim bigint; files bigint; pending bigint;
begin
  if auth.uid() is null or (not private.is_business_member(b) and not private.field_active(b)) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  plan_name:=private.attachment_plan(b); lim:=private.attachment_limit(plan_name);
  select coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$'
    then (metadata->>'size')::bigint else 0 end),0),count(*) into used,files
  from storage.objects where bucket_id in ('finviant-record-photos','velnu-business-logos','finviant-document-pdfs')
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
