-- One scheduling authority: approved scope -> reviewed offer -> atomic booking.
-- Customer tokens are hashed; email and invoice operations are server-only.
alter table public.estimates add column property_id uuid;
alter table public.estimates add constraint estimates_property_business_fkey
  foreign key(property_id,business_id) references public.properties(id,business_id);
create index estimates_property_business_idx on public.estimates(property_id,business_id) where property_id is not null;
alter table public.jobs add column assigned_user_ids uuid[] not null default '{}';
alter table public.jobs add column source_estimate_id uuid;
alter table public.jobs add constraint jobs_source_estimate_business_fkey
  foreign key(source_estimate_id,business_id) references public.estimates(id,business_id);
create unique index jobs_one_source_estimate_idx on public.jobs(source_estimate_id) where source_estimate_id is not null;
create index jobs_active_schedule_idx on public.jobs(business_id,scheduled_start,scheduled_end)
  where status in('scheduled','in_progress');

create table private.scheduling_preferences(
  business_id uuid primary key references public.businesses(id) on delete cascade,
  work_days integer[] not null default array[1,2,3,4,5],
  start_minutes integer not null default 480 check(start_minutes between 0 and 1380),
  end_minutes integer not null default 1020 check(end_minutes between 60 and 1440),
  duration_minutes integer not null default 120 check(duration_minutes between 15 and 720),
  buffer_minutes integer not null default 30 check(buffer_minutes between 0 and 180),
  notice_hours integer not null default 24 check(notice_hours between 0 and 336),
  updated_at timestamptz not null default now(),
  check(end_minutes>start_minutes), check(cardinality(work_days) between 1 and 7),
  check(work_days <@ array[1,2,3,4,5,6,7])
);
create table private.worker_time_off(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  starts_at timestamptz not null,ends_at timestamptz not null,
  note text not null default '' check(length(note)<=200),
  check(ends_at>starts_at),
  foreign key(business_id,user_id) references public.business_members(business_id,user_id) on delete cascade
);
create index worker_time_off_lookup on private.worker_time_off(business_id,user_id,starts_at,ends_at);
create table private.scheduling_offers(
  id uuid primary key, business_id uuid not null references public.businesses(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id),
  property_id uuid, title text not null check(length(btrim(title)) between 1 and 200),
  assigned_user_ids uuid[] not null, token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'approved' check(status in('approved','booked','revoked')),
  approved_by uuid not null references auth.users(id),approved_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  customer_note text not null default '' check(length(customer_note)<=1000),
  recipient_email text,
  request_fingerprint text not null,job_id uuid references public.jobs(id),
  selected_slot_id uuid,customer_name text,booked_at timestamptz,
  foreign key(property_id,business_id) references public.properties(id,business_id)
);
create index scheduling_offers_estimate_idx on private.scheduling_offers(business_id,estimate_id,approved_at desc);
create unique index scheduling_one_active_offer on private.scheduling_offers(estimate_id) where status='approved';
create table private.scheduling_offer_slots(
  id uuid primary key default gen_random_uuid(),offer_id uuid not null references private.scheduling_offers(id) on delete cascade,
  starts_at timestamptz not null,ends_at timestamptz not null,check(ends_at>starts_at),
  unique(offer_id,starts_at)
);
create index scheduling_offer_slots_offer_idx on private.scheduling_offer_slots(offer_id);
create table private.job_invoice_results(
  job_id uuid primary key references public.jobs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid references public.invoices(id),error_code text,updated_at timestamptz not null default now()
);
create index job_invoice_results_business_idx on private.job_invoice_results(business_id);
alter table private.scheduling_preferences enable row level security;
alter table private.worker_time_off enable row level security;
alter table private.scheduling_offers enable row level security;
alter table private.scheduling_offer_slots enable row level security;
alter table private.job_invoice_results enable row level security;
revoke all on private.scheduling_preferences,private.worker_time_off,private.scheduling_offers,
  private.scheduling_offer_slots,private.job_invoice_results from public,anon,authenticated;

create function private.can_manage_schedule(b uuid,actor uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select actor is not null and exists(select 1 from public.business_members m where m.business_id=b and m.user_id=actor
 and m.role in('owner','admin','office')) and private.member_module_access(b,actor,'jobs')
 and private.member_module_access(b,actor,'calendar');
$$;
create function private.schedule_defaults(b uuid) returns private.scheduling_preferences
language plpgsql stable security definer set search_path='' as $$
declare r private.scheduling_preferences%rowtype;
begin select * into r from private.scheduling_preferences where business_id=b;
 if not found then r.business_id:=b;r.work_days:=array[1,2,3,4,5];r.start_minutes:=480;r.end_minutes:=1020;
 r.duration_minutes:=120;r.buffer_minutes:=30;r.notice_hours:=24;end if;return r;end $$;
create function private.validate_scheduling_workers(b uuid,workers uuid[]) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if workers is null or cardinality(workers) not between 1 and 5 or array_position(workers,null) is not null
 or cardinality(workers)<>(select count(distinct x) from unnest(workers) x) then
 raise exception 'Choose between one and five different team members.' using errcode='22023';end if;
 if exists(select 1 from unnest(workers) w where not exists(select 1 from public.business_members m where m.business_id=b
 and m.user_id=w and m.role<>'viewer' and private.member_module_access(b,w,'jobs') and private.member_module_access(b,w,'calendar'))) then
 raise exception 'A selected worker is no longer available to this business. Refresh the team.' using errcode='42501';end if;
end $$;
create function private.scheduling_slot_free(b uuid,workers uuid[],s timestamptz,e timestamptz,exclude_job uuid default null,exclude_appointment uuid default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare prefs private.scheduling_preferences%rowtype;pad interval;
begin
 if s is null or e is null or e<=s then return false;end if;
 prefs:=private.schedule_defaults(b);pad:=make_interval(mins=>prefs.buffer_minutes);
 -- Old work without an assignment blocks all crews until the dispatcher assigns it.
 if exists(select 1 from public.jobs j where j.business_id=b and j.id is distinct from exclude_job
 and j.status in('scheduled','in_progress') and j.scheduled_start is not null
 and (cardinality(j.assigned_user_ids)=0 or j.assigned_user_ids && workers)
 and j.scheduled_start<e+pad and coalesce(j.scheduled_end,j.scheduled_start+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.appointments a left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
 where a.business_id=b and (exclude_job is null or a.job_id is distinct from exclude_job) and a.id is distinct from exclude_appointment and a.status in('scheduled','confirmed','in_progress')
 and (a.job_id is null or j.scheduled_start is null)
 and (a.assigned_user_id is null or a.assigned_user_id=any(workers))
 and a.starts_at<e+pad and coalesce(a.ends_at,a.starts_at+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.document_schedules d where d.business_id=b and d.status in('planned','scheduled')
 and d.scheduled_start_time<e+pad and d.scheduled_end_time>s-pad) then return false;end if;
 return not exists(select 1 from private.worker_time_off t where t.business_id=b and t.user_id=any(workers)
 and t.starts_at<e and t.ends_at>s);
end $$;
create function private.schedule_window_valid(b uuid,s timestamptz,e timestamptz) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p private.scheduling_preferences%rowtype;zone text;local_start timestamp;local_end timestamp;
begin
 p:=private.schedule_defaults(b);select timezone into zone from public.businesses where id=b;
 if s is null or e is null or e<=s or e-s<interval '15 minutes' or e-s>interval '12 hours'
 or s<now()+make_interval(hours=>p.notice_hours) or s>now()+interval '60 days' then return false;end if;
 local_start:=s at time zone zone;local_end:=e at time zone zone;
 return local_start::date=local_end::date and extract(isodow from local_start)::integer=any(p.work_days)
 and local_start::time>=(time '00:00'+make_interval(mins=>p.start_minutes))
 and (extract(hour from local_end)*60+extract(minute from local_end))<=p.end_minutes;
end $$;

-- Guard all existing job editors as well as the new booking endpoints.
create function private.guard_job_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean;checked_workers uuid[];checked_end timestamptz;
begin
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then changed:=(new.assigned_user_ids,new.scheduled_start,new.scheduled_end,new.property_id,new.source_estimate_id)
 is distinct from(old.assigned_user_ids,old.scheduled_start,old.scheduled_end,old.property_id,old.source_estimate_id);
 if new.source_estimate_id is distinct from old.source_estimate_id then raise exception 'The approved estimate link cannot change.';end if;end if;
 if not changed then return new;end if;
 if auth.uid() is not null and cardinality(new.assigned_user_ids)>0 and not private.can_manage_schedule(new.business_id) then
 raise exception 'Only dispatch staff can change worker assignments.' using errcode='42501';end if;
 if cardinality(new.assigned_user_ids)>0 then
 perform private.validate_scheduling_workers(new.business_id,new.assigned_user_ids);
 end if;
 if new.status in('scheduled','in_progress') and new.scheduled_start is not null then
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 checked_workers:=new.assigned_user_ids;
 if cardinality(checked_workers)=0 then select array_agg(m.user_id) into checked_workers from public.business_members m where m.business_id=new.business_id and m.role<>'viewer';end if;
 if new.scheduled_end is null and cardinality(new.assigned_user_ids)>0 then raise exception 'Choose an end time before assigning workers.' using errcode='22023';end if;
 checked_end:=coalesce(new.scheduled_end,new.scheduled_start+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes));
 if checked_end<=new.scheduled_start or not private.scheduling_slot_free(new.business_id,coalesce(checked_workers,'{}'::uuid[]),new.scheduled_start,checked_end,new.id) then
 raise exception 'A selected worker is already booked. Choose another time.' using errcode='23P01';end if;end if;
 if new.source_estimate_id is not null and not exists(select 1 from public.estimates e where e.id=new.source_estimate_id
 and e.business_id=new.business_id and e.customer_id=new.customer_id and e.status in('accepted','converted')) then
 raise exception 'An approved estimate for this customer is required.' using errcode='23514';end if;
 return new;
end $$;
create trigger guided_job_schedule before insert or update on public.jobs for each row execute function private.guard_job_schedule();

create function private.scheduling_context(b uuid,estimate uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.estimates%rowtype;result jsonb;
begin
 if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 result:=jsonb_build_object('preferences',to_jsonb(private.schedule_defaults(b)),
 'team',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'label',coalesce(nullif(split_part(u.email,'@',1),''),'Team member'),'role',m.role,'is_you',m.user_id=auth.uid()) order by m.created_at)
 from public.business_members m join auth.users u on u.id=m.user_id where m.business_id=b and m.role<>'viewer'
 and private.member_module_access(b,m.user_id,'jobs') and private.member_module_access(b,m.user_id,'calendar')),'[]'::jsonb),
 'time_off',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'starts_at',t.starts_at,'ends_at',t.ends_at,'note',t.note) order by t.starts_at)
 from private.worker_time_off t where t.business_id=b and t.ends_at>now() and t.starts_at<now()+interval '60 days'),'[]'::jsonb));
 if estimate is not null then
 if not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Estimate access is required.' using errcode='42501';end if;
 select * into e from public.estimates where id=estimate and business_id=b;
 if not found or e.status not in('accepted','converted') then raise exception 'Approve the estimate before scheduling.' using errcode='23514';end if;
 result:=result||jsonb_build_object('estimate',jsonb_build_object('id',e.id,'number',e.estimate_number,'customer_id',e.customer_id,'job_id',e.job_id,'property_id',e.property_id,
 'title',coalesce((select left(description,200) from public.estimate_items where estimate_id=e.id order by sort_order,id limit 1),'Service visit'),
 'scope',coalesce((select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) from public.estimate_items where estimate_id=e.id),''),
 'customer_name',(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') from public.customers where id=e.customer_id),
 'customer_email',(select email from public.customers where id=e.customer_id)),
 'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'address',concat_ws(', ',p.address_line1,p.address_line2,p.city,p.state,p.postal_code)))
 from public.properties p where p.business_id=b and p.customer_id=e.customer_id),'[]'::jsonb),
 'offer',(select jsonb_build_object('id',o.id,'status',o.status,'expires_at',o.expires_at,'job_id',o.job_id) from private.scheduling_offers o where o.estimate_id=e.id order by approved_at desc limit 1));
 end if;return result;
end $$;
create function public.get_scheduling_context(p_business uuid,p_estimate uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.scheduling_context(p_business,p_estimate)$$;

create function private.suggest_scheduling_slots(b uuid,workers uuid[],duration integer,first_day date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.scheduling_preferences%rowtype;zone text;result jsonb;
begin
 if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform private.validate_scheduling_workers(b,workers);p:=private.schedule_defaults(b);
 if duration is null or duration not between 15 and 720 or duration%15<>0 then raise exception 'Choose a duration in 15-minute steps, up to 12 hours.' using errcode='22023';end if;
 select timezone into zone from public.businesses where id=b;
 if first_day is null or first_day<(now() at time zone zone)::date or first_day>(now() at time zone zone)::date+45 then
 raise exception 'Choose a start date within the next 45 days.' using errcode='22023';end if;
 with candidates as(
 select day::date+make_interval(mins=>minute) local_start,
 (day::date+make_interval(mins=>minute)) at time zone zone s,
 (day::date+make_interval(mins=>minute+duration)) at time zone zone e
 from generate_series(first_day::timestamp,(first_day+13)::timestamp,interval '1 day') day
 cross join generate_series(p.start_minutes,p.end_minutes-duration,30) minute
 where extract(isodow from day)::integer=any(p.work_days)),
 available as(select *,row_number() over(partition by local_start::date order by s) position from candidates
 where s at time zone zone=local_start and private.schedule_window_valid(b,s,e) and private.scheduling_slot_free(b,workers,s,e)),
 limited as(select s,e from available where position<=3 order by s limit 12)
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',s,'ends_at',e) order by s),'[]'::jsonb) into result from limited;
 return result;
end $$;
create function public.suggest_scheduling_slots(p_business uuid,p_workers uuid[],p_duration integer,p_from date) returns jsonb
language sql security invoker set search_path='' as $$select private.suggest_scheduling_slots(p_business,p_workers,p_duration,p_from)$$;

create function private.approve_scheduling_offer(estimate uuid,request uuid,input jsonb,hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype;o private.scheduling_offers%rowtype;b uuid;workers uuid[];site uuid;slot jsonb;s timestamptz;t timestamptz;fingerprint text;
begin
 select business_id into b from public.estimates where id=estimate;
 if b is null or not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then
 raise exception 'Approved estimate and dispatch access are required.' using errcode='42501';end if;
 if request is null or input is null or jsonb_typeof(input)<>'object' or hash is null or hash !~ '^[a-f0-9]{64}$' then
 raise exception 'Invalid scheduling request.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 fingerprint:=encode(sha256(convert_to(input::text||hash,'UTF8')),'hex');
 select * into o from private.scheduling_offers where id=request;
 if found then if o.business_id<>b or o.estimate_id<>estimate or o.request_fingerprint<>fingerprint then raise exception 'This retry has different scheduling details.' using errcode='23505';end if;
 return jsonb_build_object('id',o.id,'status',o.status,'expires_at',o.expires_at);end if;
 select * into e from public.estimates where id=estimate and business_id=b for update;
 if e.status not in('accepted','converted') or e.job_id is not null then raise exception 'This estimate is not awaiting a new job.' using errcode='23514';end if;
 if input->>'recipient_email' is distinct from(select email from public.customers where id=e.customer_id and business_id=b) then
 raise exception 'The customer email changed. Refresh before approving an invitation.' using errcode='23514';end if;
 select array_agg(x::uuid order by x) into workers from jsonb_array_elements_text(input->'workers') x;
 perform private.validate_scheduling_workers(b,workers);
 site:=coalesce(nullif(input->>'property_id','')::uuid,e.property_id);
 if site is not null and not exists(select 1 from public.properties p where p.id=site and p.business_id=b and p.customer_id=e.customer_id) then
 raise exception 'Choose a service address for this customer.' using errcode='23503';end if;
 if nullif(btrim(input->>'title'),'') is null or length(input->>'title')>200 or length(coalesce(input->>'note',''))>1000 then raise exception 'Check the job title and message.' using errcode='22023';end if;
 if jsonb_typeof(input->'slots') is distinct from 'array' or jsonb_array_length(input->'slots') not between 1 and 6 then raise exception 'Choose one to six appointment options.' using errcode='22023';end if;
 for slot in select value from jsonb_array_elements(input->'slots') loop
 s:=(slot->>'starts_at')::timestamptz;t:=(slot->>'ends_at')::timestamptz;
 if not private.schedule_window_valid(b,s,t) or not private.scheduling_slot_free(b,workers,s,t) then raise exception 'An offered time is no longer available. Refresh the suggestions.' using errcode='23P01';end if;end loop;
 update private.scheduling_offers set status='revoked' where estimate_id=e.id and status='approved';
 insert into private.scheduling_offers(id,business_id,estimate_id,property_id,title,assigned_user_ids,token_hash,approved_by,customer_note,recipient_email,request_fingerprint,expires_at)
 values(request,b,e.id,site,btrim(input->>'title'),workers,hash,auth.uid(),coalesce(btrim(input->>'note'),''),(select email from public.customers where id=e.customer_id and business_id=b),fingerprint,
 least(now()+interval '7 days',(select max((v->>'starts_at')::timestamptz) from jsonb_array_elements(input->'slots') v)));
 insert into private.scheduling_offer_slots(offer_id,starts_at,ends_at) select request,(v->>'starts_at')::timestamptz,(v->>'ends_at')::timestamptz from jsonb_array_elements(input->'slots') v;
 return jsonb_build_object('id',request,'status','approved','expires_at',(select expires_at from private.scheduling_offers where id=request));
end $$;
create function public.approve_scheduling_offer(p_estimate uuid,p_request uuid,p_input jsonb,p_hash text) returns jsonb
language sql security invoker set search_path='' as $$select private.approve_scheduling_offer(p_estimate,p_request,p_input,p_hash)$$;

-- This private helper is deliberately unreachable by browser roles.
create function private.book_estimate_job(estimate uuid,site uuid,title text,workers uuid[],s timestamptz,e timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare quote public.estimates%rowtype;j public.jobs%rowtype;scope text;appointment uuid;
begin
 select * into quote from public.estimates where id=estimate for update;
 if not found or quote.status not in('accepted','converted') then raise exception 'The approved estimate is unavailable.' using errcode='23514';end if;
 if quote.job_id is not null then return jsonb_build_object('job_id',quote.job_id,'already_booked',true);end if;
 perform private.validate_scheduling_workers(quote.business_id,workers);
 if not private.schedule_window_valid(quote.business_id,s,e) or not private.scheduling_slot_free(quote.business_id,workers,s,e) then
 raise exception 'That time was just booked. Please choose another option.' using errcode='23P01';end if;
 if site is not null and not exists(select 1 from public.properties p where p.id=site and p.business_id=quote.business_id and p.customer_id=quote.customer_id) then raise exception 'The service address is unavailable.' using errcode='23503';end if;
 select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) into scope from public.estimate_items where estimate_id=quote.id;
 if scope is null then raise exception 'The approved estimate has no scope.' using errcode='23514';end if;
 insert into public.jobs(business_id,customer_id,property_id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,source_estimate_id)
 values(quote.business_id,quote.customer_id,site,title,scope,'scheduled',s,e,workers,quote.id) returning * into j;
 insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id)
 values(j.business_id,j.customer_id,j.id,j.title,s,e,'confirmed',workers[1]) returning id into appointment;
 update public.estimates set job_id=j.id,property_id=site where id=quote.id;
 update public.invoices set job_id=j.id where estimate_id=quote.id and business_id=quote.business_id and job_id is null;
 delete from public.document_schedules where estimate_id=quote.id;
 return jsonb_build_object('job_id',j.id,'appointment_id',appointment,'starts_at',s,'ends_at',e,'already_booked',false);
end $$;
create function private.book_approved_estimate(estimate uuid,input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;workers uuid[];r jsonb;
begin
 select business_id into b from public.estimates where id=estimate;
 if b is null or not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select array_agg(x::uuid order by x) into workers from jsonb_array_elements_text(input->'workers') x;
 if nullif(btrim(input->>'title'),'') is null or length(input->>'title')>200 then raise exception 'Enter a job title.' using errcode='22023';end if;
 r:=private.book_estimate_job(estimate,nullif(input->>'property_id','')::uuid,btrim(input->>'title'),workers,(input->>'starts_at')::timestamptz,(input->>'ends_at')::timestamptz);
 update private.scheduling_offers set status='revoked' where estimate_id=estimate and status='approved';return r;
end $$;
create function public.book_approved_estimate(p_estimate uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.book_approved_estimate(p_estimate,p_input)$$;

create function private.customer_schedule_offer(hash text,slot uuid default null,chosen_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.scheduling_offers%rowtype;t private.scheduling_offer_slots%rowtype;b uuid;zone text;booking jsonb;
begin
 if hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 select business_id into b from private.scheduling_offers where token_hash=hash;
 if b is null then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 if slot is not null then perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));end if;
 select * into o from private.scheduling_offers where token_hash=hash for update;
 if o.status='revoked' then raise exception 'This scheduling link was replaced. Ask the business for new options.' using errcode='P0002';end if;
 if o.status='approved' and o.expires_at<=now() then raise exception 'This scheduling link has expired. Ask the business for new times.' using errcode='P0002';end if;
 select timezone into zone from public.businesses where id=b;
 if slot is not null then
 if o.status='booked' then
 if o.selected_slot_id<>slot then raise exception 'This appointment is already confirmed. Contact the business to change it.' using errcode='23514';end if;
 else
 if length(btrim(coalesce(chosen_name,''))) not between 2 and 200 then raise exception 'Enter your name to confirm the appointment.' using errcode='22023';end if;
 if not private.can_manage_schedule(b,o.approved_by) or not private.member_module_access(b,o.approved_by,'billing') then raise exception 'The business needs to review these options again.' using errcode='42501';end if;
 select * into t from private.scheduling_offer_slots where id=slot and offer_id=o.id;
 if not found then raise exception 'Choose a time from this invitation.' using errcode='22023';end if;
 booking:=private.book_estimate_job(o.estimate_id,o.property_id,o.title,o.assigned_user_ids,t.starts_at,t.ends_at);
 if (booking->>'already_booked')::boolean then raise exception 'This work has already been scheduled. Contact the business.' using errcode='23514';end if;
 update private.scheduling_offers set status='booked',job_id=(booking->>'job_id')::uuid,selected_slot_id=slot,customer_name=btrim(chosen_name),booked_at=now() where id=o.id returning * into o;
 end if;end if;
 -- No tenant IDs, staff names/emails, internal notes or financial history leave this endpoint.
 return jsonb_build_object('business_name',(select name from public.businesses where id=b),'business_phone',(select phone from public.businesses where id=b),
 'title',o.title,'timezone',zone,'note',o.customer_note,'status',case when o.status='booked' and exists(select 1 from public.jobs where id=o.job_id and status='canceled') then 'canceled' else o.status end,'expires_at',o.expires_at,
 'address',(select concat_ws(', ',address_line1,address_line2,city,state,postal_code) from public.properties where id=o.property_id and business_id=b),
 'confirmed',case when o.status='booked' then (select jsonb_build_object('starts_at',scheduled_start,'ends_at',scheduled_end) from public.jobs where id=o.job_id and business_id=b) else null end,
 'slots',case when o.status='approved' then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'starts_at',x.starts_at,'ends_at',x.ends_at) order by x.starts_at)
 from private.scheduling_offer_slots x where x.offer_id=o.id and private.schedule_window_valid(b,x.starts_at,x.ends_at)
 and private.scheduling_slot_free(b,o.assigned_user_ids,x.starts_at,x.ends_at)),'[]'::jsonb) else '[]'::jsonb end);
end $$;
create function public.customer_schedule_offer(p_token text,p_slot uuid default null,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 return private.customer_schedule_offer(encode(sha256(convert_to(p_token,'UTF8')),'hex'),p_slot,p_name);end $$;

create function private.save_scheduling_preferences(b uuid,input jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare days integer[];
begin if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 select array_agg(distinct x::integer order by x::integer) into days from jsonb_array_elements_text(input->'work_days') x;
 if days is null then raise exception 'Choose working days.' using errcode='22023';end if;
 insert into private.scheduling_preferences(business_id,work_days,start_minutes,end_minutes,duration_minutes,buffer_minutes,notice_hours)
 values(b,days,(input->>'start_minutes')::integer,(input->>'end_minutes')::integer,(input->>'duration_minutes')::integer,(input->>'buffer_minutes')::integer,(input->>'notice_hours')::integer)
 on conflict(business_id) do update set work_days=excluded.work_days,start_minutes=excluded.start_minutes,end_minutes=excluded.end_minutes,
 duration_minutes=excluded.duration_minutes,buffer_minutes=excluded.buffer_minutes,notice_hours=excluded.notice_hours,updated_at=now();
end $$;
create function public.save_scheduling_preferences(p_business uuid,p_input jsonb) returns void
language sql security invoker set search_path='' as $$select private.save_scheduling_preferences(p_business,p_input)$$;
create function private.manage_worker_time_off(b uuid,worker uuid,s timestamptz,e timestamptz,note text,remove_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if remove_id is not null then delete from private.worker_time_off where id=remove_id and business_id=b;return;end if;
 perform private.validate_scheduling_workers(b,array[worker]);
 if s is null or e is null or e<=s or e-s>interval '90 days' or length(coalesce(note,''))>200 then raise exception 'Check the time-off dates and note.' using errcode='22023';end if;
 insert into private.worker_time_off(business_id,user_id,starts_at,ends_at,note) values(b,worker,s,e,coalesce(btrim(note),''));
end $$;
create function public.manage_worker_time_off(p_business uuid,p_worker uuid,p_start timestamptz,p_end timestamptz,p_note text default '',p_remove uuid default null) returns void
language sql security invoker set search_path='' as $$select private.manage_worker_time_off(p_business,p_worker,p_start,p_end,p_note,p_remove)$$;

create function private.dispatch_job(job uuid,workers uuid[],s timestamptz,e timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;j public.jobs%rowtype;
begin select business_id into b from public.jobs where id=job;
 if b is null or not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=job and business_id=b for update;
 if j.status in('completed','canceled') then raise exception 'Reopen this job before scheduling.' using errcode='23514';end if;
 perform private.validate_scheduling_workers(b,workers);
 if s is null or e is null or e<=s or e-s>interval '12 hours' then raise exception 'Choose a start and end time, up to 12 hours.' using errcode='22023';end if;
 if not private.scheduling_slot_free(b,workers,s,e,j.id) then raise exception 'A selected worker is already booked. Choose another time.' using errcode='23P01';end if;
 update public.jobs set assigned_user_ids=workers,scheduled_start=s,scheduled_end=e,status=case when status='in_progress' then status else 'scheduled' end where id=j.id;
 if exists(select 1 from public.appointments where job_id=j.id and business_id=b and status in('scheduled','confirmed','in_progress')) then
 update public.appointments set starts_at=s,ends_at=e,assigned_user_id=workers[1] where job_id=j.id and business_id=b and status in('scheduled','confirmed','in_progress');
 else insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id) values(b,j.customer_id,j.id,j.title,s,e,'confirmed',workers[1]);end if;
 return jsonb_build_object('job_id',j.id);
end $$;
create function public.dispatch_job(p_job uuid,p_workers uuid[],p_start timestamptz,p_end timestamptz) returns jsonb
language sql security invoker set search_path='' as $$select private.dispatch_job(p_job,p_workers,p_start,p_end)$$;

create function private.workflow_next_actions(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin if not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Workflow access is required.' using errcode='42501';end if;
 return jsonb_build_object('approved',coalesce((select jsonb_agg(to_jsonb(x)) from(select e.id,e.estimate_number,
 coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer') customer_name,
 (select jsonb_build_object('status',o.status,'expires_at',o.expires_at) from private.scheduling_offers o where o.estimate_id=e.id order by o.approved_at desc limit 1) offer
 from public.estimates e join public.customers c on c.id=e.customer_id and c.business_id=e.business_id where e.business_id=b
 and e.status in('accepted','converted') and e.job_id is null order by e.updated_at desc limit 20)x),'[]'::jsonb),
 'completed',coalesce((select jsonb_agg(to_jsonb(x)) from(select j.id,j.title,
 (select i.id from public.invoices i where i.job_id=j.id and i.business_id=b and i.status<>'void' order by i.created_at limit 1) invoice_id,
 (select i.status from public.invoices i where i.job_id=j.id and i.business_id=b and i.status<>'void' order by i.created_at limit 1) invoice_status,
 r.error_code from public.jobs j left join private.job_invoice_results r on r.job_id=j.id
 where j.business_id=b and j.status='completed' and (r.job_id is not null or j.source_estimate_id is not null)
 and not exists(select 1 from public.invoices i where i.job_id=j.id and i.business_id=b and i.status not in('draft','void'))
 order by j.completed_at desc nulls last limit 20)x),'[]'::jsonb));
end $$;
create function public.get_workflow_next_actions(p_business uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.workflow_next_actions(p_business)$$;

-- Caller identity is supplied by the authenticated Edge Function, never by a browser RPC.
create function public.complete_job_workflow(p_job uuid,p_actor uuid,p_retry_only boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;b uuid;quote public.estimates%rowtype;invoice uuid;failure text;finance boolean;
begin
 select business_id into b from public.jobs where id=p_job;
 if b is null or p_actor is null or not private.member_module_access(b,p_actor,'jobs') or not exists(select 1 from public.business_members where business_id=b and user_id=p_actor and role<>'viewer') then
 raise exception 'Job access is required.' using errcode='42501';end if;
 finance:=private.member_module_access(b,p_actor,'billing');
 if p_retry_only and not finance then raise exception 'Billing access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=p_job for update;
 if j.status='canceled' then raise exception 'Reopen a canceled job before completing it.' using errcode='23514';end if;
 if p_retry_only and j.status<>'completed' then raise exception 'Complete the job first.' using errcode='23514';end if;
 update public.jobs set status='completed',completed_at=coalesce(completed_at,now()) where id=j.id;
 select id into invoice from public.invoices where job_id=j.id and business_id=b and status<>'void' order by created_at limit 1;
 if invoice is null then
 select * into quote from public.estimates where business_id=b and job_id=j.id and status in('accepted','converted') order by created_at limit 1;
 if found then
 begin
 if exists(select 1 from public.invoices where estimate_id=quote.id) then raise exception 'Existing invoice needs review.' using errcode='23514';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=quote.id and business_id=b) then raise exception 'Approved scope is missing.' using errcode='23514';end if;
 insert into public.invoices(business_id,customer_id,job_id,estimate_id,notes,customer_message,payment_links,payment_instructions)
 values(b,quote.customer_id,j.id,quote.id,quote.notes,quote.customer_message,
 coalesce((select payment_links from public.business_settings where business_id=b),'[]'::jsonb),
 coalesce((select payment_instructions from public.business_settings where business_id=b),'')) returning id into invoice;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order)
 select invoice,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=quote.id and business_id=b order by sort_order;
 update public.estimates set status='converted' where id=quote.id and status='accepted';
 exception when others then invoice:=null;failure:=case when sqlstate in('23514','P0001') then 'document_limit_or_review' else 'invoice_preparation_failed' end;end;
 else failure:='pricing_required';end if;end if;
 insert into private.job_invoice_results(job_id,business_id,invoice_id,error_code) values(j.id,b,invoice,failure)
 on conflict(job_id) do update set invoice_id=excluded.invoice_id,error_code=excluded.error_code,updated_at=now();
 return jsonb_build_object('job_id',j.id,'status','completed','invoice_ready',invoice is not null,'invoice_id',case when finance then invoice else null end,
 'needs_pricing',failure='pricing_required','needs_review',failure is not null);
end $$;

-- Existing email outbox retains its lease, provider idempotency and reconciliation logic.
alter table private.finviant_email_outbox drop constraint finviant_email_outbox_document_kind_check;
alter table private.finviant_email_outbox add constraint finviant_email_outbox_document_kind_check check(document_kind in('invoice','estimate','change_order','schedule'));
create function public.prepare_scheduling_email(p_offer uuid,p_actor uuid,p_request uuid,p_token text,p_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.scheduling_offers%rowtype;existing private.finviant_email_outbox%rowtype;c record;b record;link text;body text;subject text;payload jsonb;
begin
 if p_request is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com') then raise exception 'Invalid scheduling message.' using errcode='22023';end if;
 select * into o from private.scheduling_offers where id=p_offer;
 if not found or not private.can_manage_schedule(o.business_id,p_actor) or not private.member_module_access(o.business_id,p_actor,'billing')
 or encode(sha256(convert_to(p_token,'UTF8')),'hex')<>o.token_hash then raise exception 'Scheduling message access denied.' using errcode='42501';end if;
 if o.status<>'approved' or o.expires_at<=now() then raise exception 'Review fresh appointment options before sending.' using errcode='23514';end if;
 if not exists(select 1 from private.business_entitlements where business_id=o.business_id and plan in('basic','pro') and(valid_until is null or valid_until>now())) then
 raise exception 'Customer email requires an activated plan.' using errcode='42501';end if;
 if not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then
 raise exception 'Review the account agreement before sending customer email.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||o.business_id::text,0));
 select * into existing from private.finviant_email_outbox where id=p_request;
 if found then if existing.business_id<>o.business_id or existing.document_kind<>'schedule' or existing.document_id<>o.id then raise exception 'This message identifier was already used.' using errcode='23505';end if;
 return jsonb_build_object('id',existing.id,'status',existing.status);end if;
 select * into existing from private.finviant_email_outbox where business_id=o.business_id and document_kind='schedule' and document_id=o.id order by created_at desc limit 1;
 if found then return jsonb_build_object('id',existing.id,'status',existing.status);end if;
 if(select count(*) from private.finviant_email_outbox where business_id=o.business_id and created_at>now()-interval '1 hour')>=100 then raise exception 'Email limit reached. Try later.' using errcode='P0001';end if;
 select customer_row.* into c from public.estimates e join public.customers customer_row on customer_row.id=e.customer_id and customer_row.business_id=e.business_id where e.id=o.estimate_id;
 if c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Add a valid customer email before sending.' using errcode='23514';end if;
 if c.email is distinct from o.recipient_email then raise exception 'The customer email changed. Review new appointment options before sending.' using errcode='23514';end if;
 select name,email into b from public.businesses where id=o.business_id;
 link:=p_origin||'/?booking='||p_token;subject:=regexp_replace(b.name||': choose a time for '||o.title,E'[\r\n]',' ','g');
 body:='Hello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\nYour estimate is approved. Please choose a time for '||o.title||E'.\n\n'||o.customer_note||E'\n\nChoose and confirm your appointment: '||link||E'\n\nTimes are checked again when you confirm. If none suit you, contact '||b.name||E'.\nThis private invitation expires '||to_char(o.expires_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.';
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subject,'text',body,
 'html','<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#193843;line-height:1.6"><h1>Choose your appointment</h1><p>'||private.html_escape(b.name)||' has reviewed appointment options for '||private.html_escape(o.title)||'.</p><p>'||private.html_escape(o.customer_note)||'</p><p><a href="'||private.html_escape(link)||'" style="background:#174d43;color:white;padding:14px 20px;display:inline-block;border-radius:8px">Choose an appointment</a></p><p>Times are confirmed when you book. If no time works, contact the business.</p></body></html>',
 'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then payload:=payload||jsonb_build_object('reply_to',b.email);end if;
 insert into public.messages(id,business_id,estimate_id,direction,channel,recipient,subject,body,provider,status)
 values(p_request,o.business_id,o.estimate_id,'outbound','email',c.email,subject,body,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,o.business_id,p_actor,'schedule',o.id,payload);
 return jsonb_build_object('id',p_request,'status','queued');
end $$;

-- Explicit grants; private helpers not named here remain unavailable to browser roles.
revoke all on function private.can_manage_schedule(uuid,uuid),private.schedule_defaults(uuid),private.validate_scheduling_workers(uuid,uuid[]),private.scheduling_slot_free(uuid,uuid[],timestamptz,timestamptz,uuid,uuid),private.schedule_window_valid(uuid,timestamptz,timestamptz),private.guard_job_schedule(),private.book_estimate_job(uuid,uuid,text,uuid[],timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_job_workflow(uuid,uuid,boolean),public.prepare_scheduling_email(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_job_workflow(uuid,uuid,boolean),public.prepare_scheduling_email(uuid,uuid,uuid,text,text) to service_role;
revoke all on function private.scheduling_context(uuid,uuid),private.suggest_scheduling_slots(uuid,uuid[],integer,date),private.approve_scheduling_offer(uuid,uuid,jsonb,text),private.book_approved_estimate(uuid,jsonb),private.save_scheduling_preferences(uuid,jsonb),private.manage_worker_time_off(uuid,uuid,timestamptz,timestamptz,text,uuid),private.dispatch_job(uuid,uuid[],timestamptz,timestamptz),private.workflow_next_actions(uuid) from public,anon;
grant execute on function private.scheduling_context(uuid,uuid),private.suggest_scheduling_slots(uuid,uuid[],integer,date),private.approve_scheduling_offer(uuid,uuid,jsonb,text),private.book_approved_estimate(uuid,jsonb),private.save_scheduling_preferences(uuid,jsonb),private.manage_worker_time_off(uuid,uuid,timestamptz,timestamptz,text,uuid),private.dispatch_job(uuid,uuid[],timestamptz,timestamptz),private.workflow_next_actions(uuid) to authenticated;
revoke all on function public.get_scheduling_context(uuid,uuid),public.suggest_scheduling_slots(uuid,uuid[],integer,date),public.approve_scheduling_offer(uuid,uuid,jsonb,text),public.book_approved_estimate(uuid,jsonb),public.save_scheduling_preferences(uuid,jsonb),public.manage_worker_time_off(uuid,uuid,timestamptz,timestamptz,text,uuid),public.dispatch_job(uuid,uuid[],timestamptz,timestamptz),public.get_workflow_next_actions(uuid) from public,anon;
grant execute on function public.get_scheduling_context(uuid,uuid),public.suggest_scheduling_slots(uuid,uuid[],integer,date),public.approve_scheduling_offer(uuid,uuid,jsonb,text),public.book_approved_estimate(uuid,jsonb),public.save_scheduling_preferences(uuid,jsonb),public.manage_worker_time_off(uuid,uuid,timestamptz,timestamptz,text,uuid),public.dispatch_job(uuid,uuid[],timestamptz,timestamptz),public.get_workflow_next_actions(uuid) to authenticated;
revoke all on function private.customer_schedule_offer(text,uuid,text) from public,anon,authenticated;
revoke all on function public.customer_schedule_offer(text,uuid,text) from public;
grant execute on function public.customer_schedule_offer(text,uuid,text) to anon,authenticated;

create function private.schedule_team(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.member_module_access(b,auth.uid(),'calendar') or not private.member_module_access(b,auth.uid(),'jobs') then
 raise exception 'Team schedule access is required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'label',coalesce(nullif(split_part(u.email,'@',1),''),'Team member'),'role',m.role,'is_you',m.user_id=auth.uid()) order by m.created_at)
 from public.business_members m join auth.users u on u.id=m.user_id where m.business_id=b and m.role<>'viewer'
 and private.member_module_access(b,m.user_id,'jobs') and private.member_module_access(b,m.user_id,'calendar')),'[]'::jsonb);
end $$;
create function public.get_schedule_team(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.schedule_team(p_business)$$;
revoke all on function private.schedule_team(uuid),public.get_schedule_team(uuid) from public,anon;
grant execute on function private.schedule_team(uuid),public.get_schedule_team(uuid) to authenticated;

create function private.create_job_invoice(job uuid,request uuid,items jsonb,due date default null,details jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;b uuid;existing uuid;document jsonb;
begin
 select business_id into b from public.jobs where id=job;
 if b is null or auth.uid() is null or not private.member_module_access(b,auth.uid(),'jobs') or not private.member_module_access(b,auth.uid(),'billing')
 or not exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role in('owner','admin','office')) then raise exception 'Job and billing access are required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=job and business_id=b for update;
 select id into existing from public.invoices where job_id=j.id and business_id=b and status<>'void' order by created_at limit 1;
 if existing is not null then return jsonb_build_object('id',existing,'already_created',true);end if;
 document:=public.create_document(b,'invoice',request,jsonb_build_object('customer_id',j.customer_id,'job_id',j.id,'items',items,'due_date',due,'issue_date',details->>'issue_date','notes',details->>'notes'));
 update public.invoices set job_id=j.id where id=(document->>'id')::uuid and business_id=b;
 return document||jsonb_build_object('already_created',false);
end $$;
create function public.create_job_invoice(p_job uuid,p_request uuid,p_items jsonb,p_due date default null,p_details jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.create_job_invoice(p_job,p_request,p_items,p_due,p_details)$$;
revoke all on function private.create_job_invoice(uuid,uuid,jsonb,date,jsonb),public.create_job_invoice(uuid,uuid,jsonb,date,jsonb) from public,anon;
grant execute on function private.create_job_invoice(uuid,uuid,jsonb,date,jsonb),public.create_job_invoice(uuid,uuid,jsonb,date,jsonb) to authenticated;

create function private.guard_estimate_site() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.property_id is not null and not exists(select 1 from public.properties where id=new.property_id and business_id=new.business_id and customer_id=new.customer_id) then
 raise exception 'Choose a service address belonging to this customer.' using errcode='23503';end if;return new;end $$;
create trigger guided_estimate_site before insert or update on public.estimates for each row execute function private.guard_estimate_site();
create function private.guard_appointment_crew() returns trigger language plpgsql security definer set search_path='' as $$
declare workers uuid[];
begin
 if new.status not in('scheduled','confirmed','in_progress') then return new;end if;
 if tg_op='UPDATE' then if(new.assigned_user_id,new.starts_at,new.ends_at,new.job_id) is not distinct from(old.assigned_user_id,old.starts_at,old.ends_at,old.job_id) then return new;end if;end if;
 if new.assigned_user_id is not null then
 if auth.uid() is not null and not private.can_manage_schedule(new.business_id) then raise exception 'Dispatch access is required to change assignments.' using errcode='42501';end if;
 perform private.validate_scheduling_workers(new.business_id,array[new.assigned_user_id]);end if;
 select assigned_user_ids into workers from public.jobs where id=new.job_id and business_id=new.business_id;
 if coalesce(cardinality(workers),0)=0 and new.assigned_user_id is not null then workers:=array[new.assigned_user_id];end if;
 if coalesce(cardinality(workers),0)=0 then select array_agg(m.user_id) into workers from public.business_members m where m.business_id=new.business_id and m.role<>'viewer';end if;
 if coalesce(cardinality(workers),0)>0 then
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 if not private.scheduling_slot_free(new.business_id,workers,new.starts_at,coalesce(new.ends_at,new.starts_at+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes)),new.job_id,new.id) then
 raise exception 'The assigned crew is already booked. Choose another time.' using errcode='23P01';end if;end if;
 return new;
end $$;
create trigger guided_appointment_crew before insert or update on public.appointments for each row execute function private.guard_appointment_crew();
revoke all on function private.guard_estimate_site(),private.guard_appointment_crew() from public,anon,authenticated;

create function private.create_dispatched_job(b uuid,request uuid,input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_job public.jobs%rowtype;j public.jobs%rowtype;workers uuid[];customer uuid;site uuid;s timestamptz;e timestamptz;fingerprint text;title text;
begin
 if not private.can_manage_schedule(b) then raise exception 'Dispatch access is required.' using errcode='42501';end if;
 if request is null or input is null or jsonb_typeof(input)<>'object' then raise exception 'Invalid job request.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 fingerprint:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 select * into old_job from public.jobs where business_id=b and request_id=request;
 if found then if old_job.request_fingerprint is distinct from fingerprint then raise exception 'This job retry has different details.' using errcode='23505';end if;return to_jsonb(old_job);end if;
 customer:=(input->>'customer_id')::uuid;site:=nullif(input->>'property_id','')::uuid;title:=btrim(input->>'title');
 if length(coalesce(title,'')) not between 1 and 200 or length(coalesce(input->>'description',''))>4000 then raise exception 'Check the job title and description.' using errcode='22023';end if;
 if not exists(select 1 from public.customers where id=customer and business_id=b and not archived) then raise exception 'Choose a customer in this business.' using errcode='23503';end if;
 if site is not null and not exists(select 1 from public.properties where id=site and business_id=b and customer_id=customer) then raise exception 'Choose this customer’s service address.' using errcode='23503';end if;
 select array_agg(x::uuid order by x) into workers from jsonb_array_elements_text(input->'assigned_user_ids') x;
 perform private.validate_scheduling_workers(b,workers);s:=(input->>'scheduled_start')::timestamptz;e:=(input->>'scheduled_end')::timestamptz;
 if s is null or e is null or e<=s or e-s>interval '12 hours' then raise exception 'Choose a valid job length, up to 12 hours.' using errcode='22023';end if;
 if not private.scheduling_slot_free(b,workers,s,e) then raise exception 'The selected crew is already booked.' using errcode='23P01';end if;
 insert into public.jobs(business_id,customer_id,property_id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,request_id,request_fingerprint)
 values(b,customer,site,title,input->>'description','scheduled',s,e,workers,request,fingerprint) returning * into j;
 insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id) values(b,customer,j.id,title,s,e,'confirmed',workers[1]);
 return to_jsonb(j);
end $$;
create function public.create_dispatched_job(target_business_id uuid,request_id uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.create_dispatched_job(target_business_id,request_id,payload)$$;
revoke all on function private.create_dispatched_job(uuid,uuid,jsonb),public.create_dispatched_job(uuid,uuid,jsonb) from public,anon;
grant execute on function private.create_dispatched_job(uuid,uuid,jsonb),public.create_dispatched_job(uuid,uuid,jsonb) to authenticated;

-- Optional service site is saved atomically with a new estimate.
CREATE OR REPLACE FUNCTION public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare new_id uuid;result jsonb;x jsonb;k integer:=0;customer uuid;site uuid;dt date;issued date;today date;fingerprint text;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') or request_id is null then raise exception 'Invalid document request';end if;fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where business_id=target_business_id and i.request_id=create_document.request_id;else select to_jsonb(e) into result from public.estimates e where business_id=target_business_id and e.request_id=create_document.request_id;end if;if result is not null then if result->>'request_fingerprint' is distinct from fingerprint then raise exception 'This request already saved different content. Open the saved document before starting another.' using errcode='23505';end if;return result;end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items' using errcode='23514';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;customer:=(payload->>'customer_id')::uuid;site:=nullif(payload->>'property_id','')::uuid;if site is not null and not exists(select 1 from public.properties p where p.id=site and p.business_id=target_business_id and p.customer_id=customer) then raise exception 'Choose a service address belonging to this customer' using errcode='23503';end if;today:=(now() at time zone(select timezone from public.businesses where id=target_business_id))::date;
issued:=coalesce(nullif(payload->>'issue_date','')::date,today);
if issued>today or issued<date '1900-01-01' then raise exception 'Choose an issue date from 1900 through today';end if;
if nullif(payload->>'issue_date','') is not null and (payload->>'issue_date' !~ '^\d{4}-\d{2}-\d{2}$' or issued::text<>payload->>'issue_date') then raise exception 'Choose a valid issue date';end if;
dt:=nullif(case when document_kind='invoice' then payload->>'due_date' else payload->>'expires_on' end,'')::date;
if dt is not null and dt<issued then raise exception 'Due or expiration date cannot precede the issue date';end if;if document_kind='invoice' then insert into public.invoices(business_id,customer_id,issue_date,due_date,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,coalesce((select payment_links from public.business_settings where business_id=target_business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=target_business_id),'')) returning id into new_id;else insert into public.estimates(business_id,customer_id,property_id,issue_date,expires_on,notes,customer_message,request_id,request_fingerprint) values(target_business_id,customer,site,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint) returning id into new_id;end if;for x in select value from jsonb_array_elements(payload->'items') loop if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;end loop;if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;return result;end$function$;

-- Add crew metadata without changing existing view columns or RLS behavior.
create or replace view public.calendar_work with (security_invoker=true) as
select 'appointment:'||a.id as source_key, a.business_id, a.title, ''::text as description,
 a.starts_at,a.ends_at,b.timezone,a.status,a.assigned_user_id,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end as document_kind,
 coalesce(i.id,e.id,a.job_id,a.id) as document_id, a.job_id,
 case when cardinality(j.assigned_user_ids)>0 then j.assigned_user_ids when a.assigned_user_id is not null then array[a.assigned_user_id] else '{}'::uuid[] end as assigned_user_ids
from public.appointments a join public.businesses b on b.id=a.business_id
left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
left join lateral (select id from public.invoices where job_id=a.job_id and business_id=a.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=a.job_id and business_id=a.business_id order by created_at desc,id limit 1) e on true
where a.status not in ('canceled','no_show') and (j.id is null or j.status<>'canceled')
union all
select 'job:'||j.id,j.business_id,j.title,''::text,j.scheduled_start,j.scheduled_end,b.timezone,j.status,null::uuid,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end,coalesce(i.id,e.id,j.id),j.id,j.assigned_user_ids
from public.jobs j join public.businesses b on b.id=j.business_id
left join lateral (select id from public.invoices where job_id=j.id and business_id=j.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=j.id and business_id=j.business_id order by created_at desc,id limit 1) e on true
where j.scheduled_start is not null and j.status<>'canceled' and not exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=j.business_id)
union all
select 'document:'||s.id,s.business_id,s.job_title,s.description,s.scheduled_start_time,s.scheduled_end_time,s.timezone,
 case when s.status='scheduled' then 'scheduled' else 'approved' end,null::uuid,
 case when coalesce(s.invoice_id,converted.id) is not null then 'invoice' else 'estimate' end,
 coalesce(s.invoice_id,converted.id,s.estimate_id),null::uuid,'{}'::uuid[]
from public.document_schedules s
left join public.estimates e on e.id=s.estimate_id and e.business_id=s.business_id
left join public.invoices i on i.id=s.invoice_id and i.business_id=s.business_id
left join public.invoices converted on converted.estimate_id=e.id and converted.business_id=s.business_id
where s.status<>'cancelled' and (s.status='scheduled' or e.status in ('accepted','converted'))
 and coalesce(e.status,'') not in ('declined','expired') and coalesce(i.status,converted.status,'')<>'void'
 and coalesce(e.job_id,i.job_id,converted.job_id) is null
 and (s.estimate_id is null or converted.id is null or not exists(select 1 from public.document_schedules other where other.invoice_id=converted.id));

-- Recheck an invitation immediately before the shared sender dispatches it.
CREATE OR REPLACE FUNCTION public.claim_document_email(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.document_kind='schedule' and not exists(select 1 from private.scheduling_offers x join public.estimates e on e.id=x.estimate_id and e.business_id=x.business_id join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
 where x.id=o.document_id and x.business_id=o.business_id and x.status='approved' and x.expires_at>now() and x.recipient_email=c.email and private.can_manage_schedule(x.business_id,o.actor_id)) then
 update private.finviant_email_outbox set status='reconciliation_required',last_code='schedule_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not private.member_module_access(o.business_id,o.actor_id,'billing') then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from private.business_entitlements where business_id=o.business_id and plan in('basic','pro') and (valid_until is null or valid_until>now())) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$;

