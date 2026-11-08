-- Customer booking remains one narrow token capability. Reviewed offer details
-- are frozen; availability and the resulting appointment are always live.
alter table private.scheduling_offers add column public_snapshot jsonb;
alter table private.scheduling_offers add column confirmed_snapshot jsonb;

create function private.scheduling_offer_public_snapshot(p_offer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('business_name',b.name,'business_phone',b.phone,'business_email',b.email,
   'business_logo_path',b.logo_path,'document_accent',b.document_accent,'title',o.title,'note',o.customer_note,
   'timezone',b.timezone,'estimate_number',e.estimate_number,
   'address',(select concat_ws(', ',p.address_line1,p.address_line2,p.city,p.state,p.postal_code)
     from public.properties p where p.id=o.property_id and p.business_id=o.business_id and p.customer_id=e.customer_id))
 from private.scheduling_offers o join public.businesses b on b.id=o.business_id
 join public.estimates e on e.id=o.estimate_id and e.business_id=o.business_id where o.id=p_offer;
$$;
update private.scheduling_offers set public_snapshot=private.scheduling_offer_public_snapshot(id);

create function private.guard_reviewed_scheduling_offer() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.id,new.business_id,new.estimate_id,new.property_id,new.title,new.assigned_user_ids,new.token_hash,
   new.approved_by,new.approved_at,new.expires_at,new.customer_note,new.recipient_email,new.request_fingerprint)
   is distinct from (old.id,old.business_id,old.estimate_id,old.property_id,old.title,old.assigned_user_ids,old.token_hash,
   old.approved_by,old.approved_at,old.expires_at,old.customer_note,old.recipient_email,old.request_fingerprint)
   or (old.public_snapshot is not null and new.public_snapshot is distinct from old.public_snapshot) then
   raise exception 'Reviewed appointment options are immutable. Issue new options instead.' using errcode='23514';end if;
 if old.status in ('booked','revoked') and new.status<>old.status then raise exception 'A closed invitation cannot be reopened.' using errcode='23514';end if;
 if old.status='booked' and (new.job_id,new.selected_slot_id,new.customer_name,new.booked_at,new.confirmed_snapshot)
   is distinct from (old.job_id,old.selected_slot_id,old.customer_name,old.booked_at,old.confirmed_snapshot) then
   raise exception 'The original booking receipt is immutable. Change the job appointment instead.' using errcode='23514';end if;
 return new;
end $$;
create trigger reviewed_scheduling_offer_immutable before update on private.scheduling_offers
 for each row execute function private.guard_reviewed_scheduling_offer();

create function private.schedule_window_valid_at(b uuid,s timestamptz,e timestamptz,checked_at timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p private.scheduling_preferences%rowtype;zone text;local_start timestamp;local_end timestamp;work_date date;
begin
 p:=private.schedule_defaults(b);select timezone into zone from public.businesses where id=b;
 if s is null or e is null or checked_at is null or zone is null or e<=s or e-s<interval '15 minutes' or e-s>interval '12 hours'
   or s<checked_at+make_interval(hours=>p.notice_hours) or s>checked_at+interval '60 days' then return false;end if;
 local_start:=s at time zone zone;local_end:=e at time zone zone;work_date:=local_start::date;
 -- Timestamp boundaries retain seconds/fractions and support a genuine 24:00
 -- closing time. Durations are elapsed minutes even across a DST transition.
 return extract(isodow from local_start)::integer=any(p.work_days)
   and local_start>=work_date::timestamp+make_interval(mins=>p.start_minutes)
   and local_start<work_date::timestamp+make_interval(mins=>p.end_minutes)
   and local_end>=work_date::timestamp+make_interval(mins=>p.start_minutes)
   and local_end<=work_date::timestamp+make_interval(mins=>p.end_minutes)
   and local_end>=work_date::timestamp;
end $$;
create or replace function private.schedule_window_valid(b uuid,s timestamptz,e timestamptz) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.schedule_window_valid_at(b,s,e,clock_timestamp());
$$;

create or replace function private.suggest_scheduling_slots(b uuid,workers uuid[],duration integer,first_day date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.scheduling_preferences%rowtype;zone text;result jsonb;checked timestamptz:=clock_timestamp();
begin
 if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform private.validate_scheduling_workers(b,workers);p:=private.schedule_defaults(b);
 if duration is null or duration not between 15 and 720 or duration%15<>0 then raise exception 'Choose a duration in 15-minute steps, up to 12 hours.' using errcode='22023';end if;
 select timezone into zone from public.businesses where id=b;
 if first_day is null or first_day<(checked at time zone zone)::date or first_day>(checked at time zone zone)::date+45 then
   raise exception 'Choose a start date within the next 45 days.' using errcode='22023';end if;
 with starts as (
   select day::date+make_interval(mins=>minute) local_start,
     (day::date+make_interval(mins=>minute)) at time zone zone s
   from generate_series(first_day::timestamp,(first_day+13)::timestamp,interval '1 day') day
   cross join generate_series(p.start_minutes,p.end_minutes-duration,30) minute
   where extract(isodow from day)::integer=any(p.work_days)
 ), candidates as (select local_start,s,s+make_interval(mins=>duration) e from starts),
 available as (
   select *,row_number() over(partition by local_start::date order by s) position from candidates
   where s at time zone zone=local_start and private.schedule_window_valid_at(b,s,e,checked)
     and private.scheduling_slot_free(b,workers,s,e)
 ), limited as (select s,e from available where position<=3 order by s limit 12)
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',s,'ends_at',e) order by s),'[]'::jsonb) into result from limited;
 return result;
end $$;

alter function private.approve_scheduling_offer(uuid,uuid,jsonb,text) rename to approve_scheduling_offer_before_live;
create function private.approve_scheduling_offer(estimate uuid,request uuid,input jsonb,hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;result jsonb;
begin
 select business_id into b from public.estimates where id=estimate;
 if b is null or not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Approved estimate and dispatch access are required.' using errcode='42501';end if;
 if private.effective_plan(b)<>'pro' then raise exception 'Customer self-booking requires Business Pro.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if not exists(select 1 from private.scheduling_offers where id=request) and
   (select count(*) from private.scheduling_offers where business_id=b and approved_at>clock_timestamp()-interval '1 hour')>=100 then
   raise exception 'Reuse the existing invitation or try again later.' using errcode='54000';end if;
 result:=private.approve_scheduling_offer_before_live(estimate,request,input,hash);
 update private.scheduling_offers set public_snapshot=private.scheduling_offer_public_snapshot(id)
   where id=request and public_snapshot is null;
 return result;
end $$;
create or replace function public.approve_scheduling_offer(p_estimate uuid,p_request uuid,p_input jsonb,p_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select private.approve_scheduling_offer(p_estimate,p_request,p_input,p_hash) $$;

create or replace function private.customer_schedule_offer(hash text,slot uuid default null,chosen_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.scheduling_offers%rowtype;t private.scheduling_offer_slots%rowtype;b uuid;booking jsonb;view jsonb;
  state text;reason text;slots jsonb:='[]'::jsonb;job public.jobs%rowtype;quote public.estimates%rowtype;confirmed jsonb;
begin
 if hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 select business_id into b from private.scheduling_offers where token_hash=hash;
 if b is null then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 if slot is not null then perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));end if;
 select * into o from private.scheduling_offers where token_hash=hash for update;
 view:=coalesce(o.public_snapshot,private.scheduling_offer_public_snapshot(o.id));
 state:=o.status;reason:='Choose an available appointment. The time is checked again when you confirm.';
 if o.status='booked' then
   if slot is not null and o.selected_slot_id<>slot then raise exception 'This appointment is already confirmed. Contact the business to change it.' using errcode='23514';end if;
   select * into job from public.jobs where id=o.job_id and business_id=b;
   if job.status='canceled' then state:='canceled';reason:='This appointment was canceled. Contact the business to arrange another time.';
   elsif job.status='completed' then reason:='This appointment is complete.';
   elsif job.id is not null and (job.scheduled_start is null or job.scheduled_end is null) then
     state:='paused';reason:='The business is reviewing the appointment time. Contact them to confirm the current schedule.';
   else reason:='Your appointment is confirmed. Contact the business if you need a change.';end if;
   confirmed:=coalesce(o.confirmed_snapshot,'{}'::jsonb)||jsonb_build_object(
     'starts_at',coalesce(job.scheduled_start,(o.confirmed_snapshot->>'starts_at')::timestamptz),
     'ends_at',coalesce(job.scheduled_end,(o.confirmed_snapshot->>'ends_at')::timestamptz),'status',coalesce(job.status,'scheduled'));
 else
   if o.status='revoked' then state:='revoked';reason:='These options were replaced. Contact the business for the current invitation.';
   elsif private.effective_plan(b)<>'pro' then state:='paused';reason:='Online scheduling is paused. Contact the business to arrange a time.';
   elsif o.expires_at<=clock_timestamp() then state:='expired';reason:='This invitation expired. Contact the business for new appointment options.';
   elsif not private.can_manage_schedule(b,o.approved_by) or not private.member_module_access(b,o.approved_by,'billing') then
     state:='paused';reason:='The business needs to review these appointment options again.';
   else
     select * into quote from public.estimates where id=o.estimate_id and business_id=b;
     if not found or quote.status not in ('accepted','converted') or quote.job_id is not null then
       state:='unavailable';reason:='This work is no longer awaiting an appointment. Contact the business for its current schedule.';
     elsif o.property_id is not null and not exists(select 1 from public.properties where id=o.property_id and business_id=b and customer_id=quote.customer_id) then
       state:='paused';reason:='The business needs to confirm the service address.';
     elsif (private.scheduling_offer_public_snapshot(o.id)->'address') is distinct from (view->'address') or
       (private.scheduling_offer_public_snapshot(o.id)->'timezone') is distinct from (view->'timezone') then
       state:='paused';reason:='The service location or business timezone changed. Ask the business for reviewed options.';
     else
       begin perform private.validate_scheduling_workers(b,o.assigned_user_ids);
       exception when insufficient_privilege or invalid_parameter_value then
         state:='paused';reason:='The business needs to review the available crew before you can book.';end;
     end if;
   end if;
   if slot is not null then
     if state<>'approved' then raise exception '%',reason using errcode='23514';end if;
     if length(btrim(coalesce(chosen_name,''))) not between 2 and 200 then raise exception 'Enter your name to confirm the appointment.' using errcode='22023';end if;
     select * into t from private.scheduling_offer_slots where id=slot and offer_id=o.id;
     if not found then raise exception 'Choose a time from this invitation.' using errcode='22023';end if;
     booking:=private.book_estimate_job(o.estimate_id,o.property_id,o.title,o.assigned_user_ids,t.starts_at,t.ends_at);
     if (booking->>'already_booked')::boolean then raise exception 'This work has already been scheduled. Contact the business.' using errcode='23514';end if;
     confirmed:=jsonb_build_object('starts_at',booking->'starts_at','ends_at',booking->'ends_at','status','scheduled');
     update private.scheduling_offers set status='booked',job_id=(booking->>'job_id')::uuid,selected_slot_id=slot,
       customer_name=btrim(chosen_name),booked_at=clock_timestamp(),confirmed_snapshot=confirmed where id=o.id returning * into o;
     state:='booked';reason:='Your appointment is confirmed. Contact the business if you need a change.';
   elsif state='approved' then
     select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'starts_at',x.starts_at,'ends_at',x.ends_at) order by x.starts_at),'[]'::jsonb) into slots
       from private.scheduling_offer_slots x where x.offer_id=o.id and private.schedule_window_valid(b,x.starts_at,x.ends_at)
         and private.scheduling_slot_free(b,o.assigned_user_ids,x.starts_at,x.ends_at);
     if jsonb_array_length(slots)=0 then reason:='No appointment options remain. Contact the business for new times.';end if;
   end if;
 end if;
 -- No tenant IDs, staff identities, internal notes, customer contacts, or financial
 -- history are returned. A reference identifies a receipt, not an authority.
 return view||jsonb_build_object('status',state,'status_reason',reason,'can_book',state='approved' and jsonb_array_length(slots)>0,
   'expires_at',o.expires_at,'slots',slots,'confirmed',confirmed,'booked_at',o.booked_at,
   'booking_reference',case when o.status='booked' then 'FV-'||upper(substr(encode(sha256(convert_to(o.id::text||o.token_hash,'UTF8')),'hex'),1,12)) end,
   'checked_at',clock_timestamp(),'availability_scope','finviant');
end $$;

-- Reopening inactive work is a new claim on availability, even when its old
-- timestamps and crew did not change.
create or replace function private.guard_job_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean;checked_workers uuid[];checked_end timestamptz;
begin
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then
   changed:=(new.assigned_user_ids,new.scheduled_start,new.scheduled_end,new.property_id,new.source_estimate_id,new.customer_id)
     is distinct from(old.assigned_user_ids,old.scheduled_start,old.scheduled_end,old.property_id,old.source_estimate_id,old.customer_id)
     or (old.status not in ('scheduled','in_progress') and new.status in ('scheduled','in_progress'));
   if new.source_estimate_id is distinct from old.source_estimate_id then raise exception 'The approved estimate link cannot change.';end if;
 end if;
 if not changed then return new;end if;
 if new.property_id is not null and not exists(select 1 from public.properties where id=new.property_id and business_id=new.business_id and customer_id=new.customer_id) then
   raise exception 'Choose a service address belonging to this customer.' using errcode='23503';end if;
 if auth.uid() is not null and cardinality(new.assigned_user_ids)>0 and not private.can_manage_schedule(new.business_id) then
   raise exception 'Only dispatch staff can change worker assignments.' using errcode='42501';end if;
 if cardinality(new.assigned_user_ids)>0 then perform private.validate_scheduling_workers(new.business_id,new.assigned_user_ids);end if;
 if new.status in ('scheduled','in_progress') and new.scheduled_start is not null then
   perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
   checked_workers:=new.assigned_user_ids;
   if cardinality(checked_workers)=0 then select array_agg(m.user_id) into checked_workers from public.business_members m where m.business_id=new.business_id and m.role<>'viewer';end if;
   if new.scheduled_end is null and cardinality(new.assigned_user_ids)>0 then raise exception 'Choose an end time before assigning workers.' using errcode='22023';end if;
   checked_end:=coalesce(new.scheduled_end,new.scheduled_start+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes));
   if checked_end<=new.scheduled_start or not private.scheduling_slot_free(new.business_id,coalesce(checked_workers,'{}'::uuid[]),new.scheduled_start,checked_end,new.id) then
     raise exception 'A selected worker is already booked. Choose another time.' using errcode='23P01';end if;
 end if;
 if new.source_estimate_id is not null and not exists(select 1 from public.estimates e where e.id=new.source_estimate_id and e.business_id=new.business_id and e.customer_id=new.customer_id and e.status in ('accepted','converted')) then
   raise exception 'An approved estimate for this customer is required.' using errcode='23514';end if;
 return new;
end $$;

create or replace function private.guard_appointment_crew() returns trigger language plpgsql security definer set search_path='' as $$
declare workers uuid[];
begin
 if new.status not in ('scheduled','confirmed','in_progress') then return new;end if;
 if tg_op='UPDATE' and (new.assigned_user_id,new.starts_at,new.ends_at,new.job_id) is not distinct from(old.assigned_user_id,old.starts_at,old.ends_at,old.job_id)
   and old.status in ('scheduled','confirmed','in_progress') then return new;end if;
 if new.assigned_user_id is not null then
   if auth.uid() is not null and not private.can_manage_schedule(new.business_id) then raise exception 'Dispatch access is required to change assignments.' using errcode='42501';end if;
   perform private.validate_scheduling_workers(new.business_id,array[new.assigned_user_id]);
 end if;
 select assigned_user_ids into workers from public.jobs where id=new.job_id and business_id=new.business_id;
 if coalesce(cardinality(workers),0)=0 and new.assigned_user_id is not null then workers:=array[new.assigned_user_id];end if;
 if coalesce(cardinality(workers),0)=0 then select array_agg(m.user_id) into workers from public.business_members m where m.business_id=new.business_id and m.role<>'viewer';end if;
 if coalesce(cardinality(workers),0)>0 then
   perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
   if not private.scheduling_slot_free(new.business_id,workers,new.starts_at,coalesce(new.ends_at,new.starts_at+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes)),new.job_id,new.id) then
     raise exception 'The assigned crew is already booked. Choose another time.' using errcode='23P01';end if;
 end if;
 return new;
end $$;

-- Availability settings cannot change halfway through a booking transaction.
create function private.lock_scheduling_availability() returns trigger language plpgsql set search_path='' as $$
declare b uuid;
begin
 b:=case when tg_op='DELETE' then old.business_id else new.business_id end;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger scheduling_preferences_serial before insert or update or delete on private.scheduling_preferences for each row execute function private.lock_scheduling_availability();
create trigger scheduling_time_off_serial before insert or update or delete on private.worker_time_off for each row execute function private.lock_scheduling_availability();

-- An unassigned document reservation blocks every crew in the existing model.
-- Its write path must use the same lock and overlap rules as customer bookings.
create function private.guard_document_schedule_availability() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.scheduling_preferences%rowtype;pad interval;
begin
 if new.status not in ('planned','scheduled') then return new;end if;
 if tg_op='UPDATE' and old.status in ('planned','scheduled') and
   (new.scheduled_start_time,new.scheduled_end_time) is not distinct from (old.scheduled_start_time,old.scheduled_end_time) then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 p:=private.schedule_defaults(new.business_id);pad:=make_interval(mins=>p.buffer_minutes);
 if exists(select 1 from public.jobs j where j.business_id=new.business_id and j.status in ('scheduled','in_progress') and j.scheduled_start is not null
   and j.scheduled_start<new.scheduled_end_time+pad and coalesce(j.scheduled_end,j.scheduled_start+make_interval(mins=>p.duration_minutes))>new.scheduled_start_time-pad)
 or exists(select 1 from public.appointments a left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
   where a.business_id=new.business_id and a.status in ('scheduled','confirmed','in_progress') and (a.job_id is null or j.scheduled_start is null)
   and a.starts_at<new.scheduled_end_time+pad and coalesce(a.ends_at,a.starts_at+make_interval(mins=>p.duration_minutes))>new.scheduled_start_time-pad)
 or exists(select 1 from public.document_schedules d where d.business_id=new.business_id and d.id is distinct from new.id and d.status in ('planned','scheduled')
   and d.scheduled_start_time<new.scheduled_end_time+pad and d.scheduled_end_time>new.scheduled_start_time-pad) then
   raise exception 'This time overlaps scheduled work. Choose another time or manage the existing appointment.' using errcode='23P01';end if;
 return new;
end $$;
create trigger scheduling_document_availability before insert or update on public.document_schedules for each row execute function private.guard_document_schedule_availability();

-- Every relevant write invalidates one tenant-scoped activity counter. Consumers
-- refetch their own authorized projections instead of receiving business data.
create function private.scheduling_slot_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 select business_id into b from private.scheduling_offers where id=case when tg_op='DELETE' then old.offer_id else new.offer_id end;
 if b is not null then insert into public.business_activity(business_id) values(b) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=clock_timestamp();end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$declare tab text;begin
 foreach tab in array array['appointments','document_schedules'] loop
   execute format('create trigger finviant_scheduling_activity after insert or update or delete on public.%I for each row execute function private.bump_business_activity()',tab);
 end loop;
 foreach tab in array array['scheduling_offers','scheduling_preferences','worker_time_off'] loop
   execute format('create trigger finviant_scheduling_activity after insert or update or delete on private.%I for each row execute function private.bump_business_activity()',tab);
 end loop;
end $$;
create trigger finviant_scheduling_slot_activity after insert or update or delete on private.scheduling_offer_slots for each row execute function private.scheduling_slot_activity();

revoke all on function private.scheduling_offer_public_snapshot(uuid),private.guard_reviewed_scheduling_offer(),private.schedule_window_valid_at(uuid,timestamptz,timestamptz,timestamptz),
 private.approve_scheduling_offer_before_live(uuid,uuid,jsonb,text),private.approve_scheduling_offer(uuid,uuid,jsonb,text),private.customer_schedule_offer(text,uuid,text),
 private.schedule_window_valid(uuid,timestamptz,timestamptz),private.guard_job_schedule(),private.guard_appointment_crew(),private.lock_scheduling_availability(),private.scheduling_slot_activity(),private.guard_document_schedule_availability()
 from public,anon,authenticated,service_role;
grant execute on function private.approve_scheduling_offer(uuid,uuid,jsonb,text) to authenticated;
-- Keep the existing anonymous public wrapper; only the hashed-token private
-- implementation changes. No new general-purpose service endpoint is exposed.
