-- Expense allocation has one canonical job; excluding a duplicate cost does not
-- delete a bookkeeping transaction or change an invoice/payment balance.
alter table private.job_time_entries add column version integer not null default 1;
create table private.job_cost_exclusions(
 business_id uuid not null,job_id uuid not null,expense_id uuid primary key references public.bookkeeping_entries(id) on delete cascade,
 reason text not null check(length(btrim(reason)) between 1 and 240),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(job_id,business_id) references public.jobs(id,business_id)
);
create index job_cost_exclusions_job on private.job_cost_exclusions(business_id,job_id);
create index job_cost_exclusions_actor on private.job_cost_exclusions(created_by);
alter table private.job_cost_exclusions enable row level security;
revoke all on private.job_cost_exclusions from public,anon,authenticated,service_role;
create function private.expense_job(e public.bookkeeping_entries) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(e.job_id,(select job_id from public.invoices where business_id=e.business_id and id=e.invoice_id),(select job_id from public.estimates where business_id=e.business_id and id=e.estimate_id))
$$;
create function private.job_expense_total(b uuid,j uuid) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(e.amount),0) from public.bookkeeping_entries e where e.business_id=b and e.direction='expense' and e.currency='USD' and private.expense_job(e)=j and not exists(select 1 from private.job_cost_exclusions x where x.business_id=b and x.job_id=j and x.expense_id=e.id)
$$;
revoke all on function private.expense_job(public.bookkeeping_entries),private.job_expense_total(uuid,uuid) from public,anon,authenticated,service_role;
alter function private.get_job_workspace(uuid,uuid) rename to get_job_workspace_base;
create function private.get_job_workspace(p_business uuid,p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;
begin
 d:=private.get_job_workspace_base(p_business,p_job);
 if (d->>'financial_access')::boolean then d:=d||jsonb_build_object('recorded_expenses',private.job_expense_total(p_business,p_job),'pending_time_minutes',(select coalesce(sum(minutes),0) from private.field_time_submissions where business_id=p_business and job_id=p_job and status='pending'),'uncalculated_expenses',(select count(*) from public.bookkeeping_entries e where e.business_id=p_business and private.expense_job(e)=p_job and e.direction='expense' and e.currency<>'USD'));end if;return d;
end $$;
revoke all on function private.get_job_workspace_base(uuid,uuid),private.get_job_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_job_workspace(uuid,uuid) to authenticated;
create or replace function public.get_job_workspace(p_business uuid,p_job uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.get_job_workspace(p_business,p_job)$$;

create function public.get_job_cost_review(p_business uuid,p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.job_workspace_access(p_business,true) or not exists(select 1 from public.jobs where business_id=p_business and id=p_job) then raise exception 'Financial and job access required.' using errcode='42501';end if;
 return jsonb_build_object('pending_time',coalesce((select jsonb_agg(to_jsonb(t)-'business_id'-'job_id'-'submitted_by'-'reviewed_by' order by created_at) from private.field_time_submissions t where business_id=p_business and job_id=p_job and status='pending'),'[]'::jsonb),
 'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'date',e.entry_date,'amount',e.amount,'description',e.description,'category',e.category,'currency',e.currency,'excluded',x.expense_id is not null,'reason',x.reason) order by e.entry_date,e.id) from public.bookkeeping_entries e left join private.job_cost_exclusions x on x.expense_id=e.id and x.job_id=p_job and x.business_id=p_business where e.business_id=p_business and e.direction='expense' and private.expense_job(e)=p_job),'[]'::jsonb),
 'possible_duplicate_time',coalesce((select jsonb_agg(to_jsonb(g)) from(select worked_on,worker_id,minutes,count(*) as entries from private.job_time_entries where business_id=p_business and job_id=p_job group by worked_on,worker_id,minutes having count(*)>1) g),'[]'::jsonb));
end $$;
create function public.manage_job_cost_review(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare t private.field_time_submissions%rowtype;e public.bookkeeping_entries%rowtype;labor private.job_time_entries%rowtype;rate numeric;
begin
 if not private.job_workspace_access(p_business,true) or not private.can_write_business(p_business) then raise exception 'Financial and job access required.' using errcode='42501';end if;
 perform 1 from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if p_action in('approve_time','reject_time') then
  select * into t from private.field_time_submissions where business_id=p_business and job_id=p_job and id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'Time submission unavailable.' using errcode='42501';end if;
  if t.status=(case when p_action='approve_time' then 'posted' else 'rejected' end) then
   if (p_action='approve_time' and t.approved_rate is distinct from(p_input->>'hourly_cost')::numeric) or t.review_note is distinct from coalesce(p_input->>'note','') then raise exception 'This time was already reviewed with different details. Refresh the job.' using errcode='23505';end if;return;end if;
  if t.status<>'pending' or t.version is distinct from(p_input->>'version')::integer then raise exception 'This time was already reviewed. Refresh before editing.' using errcode='40001';end if;
  if p_action='approve_time' then
   rate:=(p_input->>'hourly_cost')::numeric;
   if rate is null or rate<0 or rate>10000 then raise exception 'Enter an internal hourly cost between 0 and 10,000.' using errcode='23514';end if;
   if (select count(*) from private.job_time_entries where business_id=p_business and job_id=p_job)>=2000 then raise exception 'This job has reached 2,000 time entries.' using errcode='23514';end if;
   insert into private.job_time_entries(business_id,job_id,worker_id,worked_on,minutes,hourly_cost,note,created_by,request_id) values(p_business,p_job,t.worker_id,t.worked_on,t.minutes,rate,t.note,t.submitted_by,t.id);
  elsif length(btrim(coalesce(p_input->>'note','')))=0 then raise exception 'Enter a reason so the worker knows why time was rejected.' using errcode='23514';end if;
  update private.field_time_submissions set status=case when p_action='approve_time' then 'posted' else 'rejected' end,version=version+1,approved_rate=case when p_action='approve_time' then rate else null end,reviewed_by=auth.uid(),review_note=left(coalesce(p_input->>'note',''),400) where id=t.id;
 elsif p_action='rate' then
  select * into labor from private.job_time_entries where business_id=p_business and job_id=p_job and id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'Time entry unavailable.' using errcode='42501';end if;
  rate:=(p_input->>'hourly_cost')::numeric;
  if labor.hourly_cost=rate then return;end if;
  if labor.version is distinct from(p_input->>'version')::integer then raise exception 'This labor rate changed. Refresh before editing.' using errcode='40001';end if;
  update private.job_time_entries set hourly_cost=rate,version=version+1 where id=labor.id;
 elsif p_action in('exclude_expense','include_expense') then
  select * into e from public.bookkeeping_entries where business_id=p_business and id=(p_input->>'id')::uuid for update;
  if not found or private.expense_job(e) is distinct from p_job or e.direction<>'expense' then raise exception 'Choose an expense allocated to this job.' using errcode='42501';end if;
  if p_action='include_expense' then delete from private.job_cost_exclusions where business_id=p_business and job_id=p_job and expense_id=e.id;
  else insert into private.job_cost_exclusions values(p_business,p_job,e.id,btrim(p_input->>'reason'),auth.uid(),now()) on conflict(expense_id) do update set reason=excluded.reason,job_id=excluded.job_id,created_by=excluded.created_by,created_at=now();end if;
 else raise exception 'Unknown cost review action.' using errcode='22023';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),case p_action when 'approve_time' then 'Field time reviewed and posted to job costing' when 'reject_time' then 'Field time returned with review notes' when 'rate' then 'Internal labor rate corrected' when 'exclude_expense' then 'Expense excluded from job cost with a recorded reason' else 'Expense restored to job cost' end);
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
end $$;
revoke all on function public.get_job_cost_review(uuid,uuid),public.manage_job_cost_review(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_job_cost_review(uuid,uuid),public.manage_job_cost_review(uuid,uuid,text,jsonb) to authenticated;

-- Removing a reviewed cost also returns its field submission; a worker never
-- sees "posted" for hours that were removed from the cost ledger.
create function private.return_removed_field_time() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.field_time_submissions set status='rejected',version=version+1,reviewed_by=auth.uid(),review_note='The office removed the posted time cost. Contact the office before resubmitting.' where business_id=old.business_id and job_id=old.job_id and id=old.request_id and status='posted';return old;
end $$;
create trigger return_removed_field_time after delete on private.job_time_entries for each row execute function private.return_removed_field_time();
revoke all on function private.return_removed_field_time() from public,anon,authenticated,service_role;

-- Reports are immutable snapshots. A correction creates a new numbered version.
create table private.job_completion_reports(
 id uuid primary key,business_id uuid not null,job_id uuid not null,version integer not null,
 snapshot jsonb not null,request_fingerprint text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(business_id,job_id,version),foreign key(job_id,business_id) references public.jobs(id,business_id)
);
create index job_reports_actor on private.job_completion_reports(created_by);
alter table private.job_completion_reports enable row level security;
revoke all on private.job_completion_reports from public,anon,authenticated,service_role;
create table private.job_report_photos(
 report_id uuid not null references private.job_completion_reports(id),photo_id uuid not null references public.record_photos(id),storage_path text not null,
 primary key(report_id,photo_id)
);
create index job_report_photos_path on private.job_report_photos(storage_path);
create index job_report_photos_photo on private.job_report_photos(photo_id);
alter table private.job_report_photos enable row level security;
revoke all on private.job_report_photos from public,anon,authenticated,service_role;
create function public.get_job_reports(p_business uuid,p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.job_workspace_access(p_business) or not exists(select 1 from public.jobs where business_id=p_business and id=p_job) then raise exception 'Job access required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'snapshot',snapshot,'created_at',created_at) order by version desc) from private.job_completion_reports where business_id=p_business and job_id=p_job),'[]'::jsonb);
end $$;
create function public.create_job_report(p_business uuid,p_job uuid,p_request uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;r private.job_completion_reports%rowtype;v integer;d jsonb;fp text;photos uuid[];signed boolean;
begin
 if not private.job_workspace_access(p_business) or not private.can_write_business(p_business) or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office job access required.' using errcode='42501';end if;
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 fp:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into r from private.job_completion_reports where id=p_request;
 if found then
  if r.business_id<>p_business or r.job_id<>p_job or r.request_fingerprint<>fp then raise exception 'This report request already saved different content.' using errcode='23505';end if;
  return jsonb_build_object('id',r.id,'version',r.version,'snapshot',r.snapshot,'created_at',r.created_at);
 end if;
 if j.status<>'completed' then raise exception 'Complete the job before publishing its completion report.' using errcode='23514';end if;
 if length(btrim(coalesce(p_input->>'summary',''))) not between 1 and 4000 then raise exception 'Describe the work performed, up to 4,000 characters.' using errcode='23514';end if;
 photos:=array(select jsonb_array_elements_text(coalesce(p_input->'photos','[]'::jsonb)))::uuid[];
 if cardinality(photos)>12 or cardinality(photos)<>(select count(distinct x) from unnest(photos) x) or exists(select 1 from unnest(photos) requested(id) where not exists(select 1 from public.record_photos p where p.business_id=p_business and p.job_id=p_job and p.id=requested.id and p.expense_id is null and exists(select 1 from storage.objects o where o.bucket_id='finviant-record-photos' and o.name=p.storage_path))) then raise exception 'Select up to 12 fully uploaded job photos.' using errcode='23514';end if;
 signed:=coalesce((p_input->>'customer_present')::boolean,false);
 if signed and (length(btrim(coalesce(p_input->>'signer',''))) not between 2 and 160 or p_input->>'consent' is distinct from 'I acknowledge the work described in this completion report.') then raise exception 'The customer must enter their name and acknowledge the report on this device.' using errcode='23514';end if;
 select coalesce(max(version),0)+1 into v from private.job_completion_reports where business_id=p_business and job_id=p_job;
 if v>100 then raise exception 'This job has reached 100 report versions.' using errcode='23514';end if;
 d:=jsonb_build_object('business',(select jsonb_build_object('name',name,'phone',phone,'email',email) from public.businesses where id=p_business),
 'job',jsonb_build_object('id',j.id,'title',j.title,'completed_at',j.completed_at,'customer',(select concat_ws(' ',first_name,last_name) from public.customers where business_id=p_business and id=j.customer_id),'address',(select concat_ws(', ',address_line1,address_line2,city,state,postal_code) from public.properties where business_id=p_business and id=j.property_id)),
 'summary',btrim(p_input->>'summary'),'tasks',coalesce((select jsonb_agg(jsonb_build_object('title',title,'completed',completed) order by created_at,id) from private.job_tasks where business_id=p_business and job_id=p_job),'[]'::jsonb),
 'visits',coalesce((select jsonb_agg(jsonb_build_object('title',title,'starts_at',starts_at,'ends_at',ends_at,'status',status) order by starts_at,id) from public.appointments where business_id=p_business and job_id=p_job),'[]'::jsonb),
 'photos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',file_name,'path',storage_path,'media_type',media_type) order by created_at,id) from public.record_photos where business_id=p_business and job_id=p_job and id=any(photos)),'[]'::jsonb),
 'signoff',case when signed then jsonb_build_object('name',btrim(p_input->>'signer'),'statement',p_input->>'consent','method','Typed in person','captured_at',now(),'captured_by',auth.uid()) else null end,'created_at',now(),'version',v);
 insert into private.job_completion_reports values(p_request,p_business,p_job,v,d,fp,auth.uid(),now());
 insert into private.job_report_photos(report_id,photo_id,storage_path) select p_request,id,storage_path from public.record_photos where business_id=p_business and job_id=p_job and id=any(photos);
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),'Completion report published, version '||v::text||case when signed then ', typed customer acknowledgement captured in person' else ', no customer acknowledgement' end);
 return jsonb_build_object('id',p_request,'version',v,'snapshot',d,'created_at',now());
end $$;
create function private.report_photo_retained(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.job_report_photos where storage_path=path)
$$;
create policy protect_completion_report_photos on storage.objects as restrictive for delete to authenticated using(bucket_id<>'finviant-record-photos' or not private.report_photo_retained(name));
create function private.protect_report_photo() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.report_photo_retained(old.storage_path) then raise exception 'This photo is retained by a published completion report.' using errcode='23514';end if;return old;
end $$;
create trigger protect_completion_report_photo before delete on public.record_photos for each row execute function private.protect_report_photo();
revoke all on function public.get_job_reports(uuid,uuid),public.create_job_report(uuid,uuid,uuid,jsonb),private.report_photo_retained(text),private.protect_report_photo() from public,anon,authenticated,service_role;
grant execute on function public.get_job_reports(uuid,uuid),public.create_job_report(uuid,uuid,uuid,jsonb),private.report_photo_retained(text) to authenticated;
-- Bounded dashboard reads. Existing full workspaces remain the editing source of truth.
create or replace function private.get_job_plan_summaries(p_business uuid,p_jobs uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare financial boolean; today date; result jsonb;
begin
 if private.job_workspace_access(p_business) is not true or p_jobs is null or cardinality(p_jobs)>4
 or (select count(*) from public.jobs where business_id=p_business and id=any(p_jobs))<>cardinality(p_jobs)
 then raise exception 'Job overview access required.' using errcode='42501';end if;
 financial:=(private.job_workspace_access(p_business,true) and (select currency from public.businesses where id=p_business)='USD') is true;
 select (now() at time zone coalesce(timezone,'UTC'))::date into today from public.businesses where id=p_business;
 select coalesce(jsonb_agg(jsonb_build_object(
  'job_id',j.id,'tasks_total',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id),
  'tasks_completed',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and completed),
  'due_tasks',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and not completed and due_on<=today),
  'financial_access',financial
 )||case when financial then jsonb_build_object(
  'hours',coalesce((select sum(minutes)/60.0 from private.job_time_entries where business_id=p_business and job_id=j.id),0),
  'tracked_cost',round(coalesce((select sum(round(minutes/60.0*hourly_cost,2)) from private.job_time_entries where business_id=p_business and job_id=j.id),0)+
   private.job_expense_total(p_business,j.id),2),
  'budget_cost',(select cost from private.job_budgets where business_id=p_business and job_id=j.id)
 ) else '{}'::jsonb end order by array_position(p_jobs,j.id)),'[]'::jsonb) into result
 from public.jobs j where j.business_id=p_business and j.id=any(p_jobs);
 return result;
end $$;
revoke all on function private.get_job_plan_summaries(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.get_job_plan_summaries(uuid,uuid[]) to authenticated;
