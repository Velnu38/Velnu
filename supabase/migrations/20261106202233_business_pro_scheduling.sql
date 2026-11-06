-- Preserve existing appointments and enforce advanced scheduling at the write boundary.

create or replace function private.validate_scheduling_workers(b uuid,workers uuid[]) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if workers is null or cardinality(workers) not between 1 and 5 or array_position(workers,null) is not null
 or cardinality(workers)<>(select count(distinct x) from unnest(workers) x) then
 raise exception 'Choose between one and five different team members.' using errcode='22023';end if;
 if private.effective_plan(b)<>'pro' and (cardinality(workers)<>1 or not private.is_primary_owner(b,workers[1])) then
  raise exception 'Business Pro is required to assign other workers. Choose yourself to book manually.' using errcode='42501';
 end if;
 if exists(select 1 from unnest(workers) w where not exists(select 1 from public.business_members m where m.business_id=b
 and m.user_id=w and m.role<>'viewer' and private.member_module_access(b,w,'jobs') and private.member_module_access(b,w,'calendar'))) then
 raise exception 'A selected worker is no longer available to this business. Refresh the team.' using errcode='42501';end if;
end $$;

create or replace function private.approve_scheduling_offer(estimate uuid,request uuid,input jsonb,hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype;o private.scheduling_offers%rowtype;b uuid;workers uuid[];site uuid;slot jsonb;s timestamptz;t timestamptz;fingerprint text;
begin
 select business_id into b from public.estimates where id=estimate;
 if b is null or not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then
 raise exception 'Approved estimate and dispatch access are required.' using errcode='42501';end if;
 if private.effective_plan(b)<>'pro' then
  raise exception 'Customer self-booking requires Business Pro.' using errcode='42501';
 end if;
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

create or replace function private.customer_schedule_offer(hash text,slot uuid default null,chosen_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.scheduling_offers%rowtype;t private.scheduling_offer_slots%rowtype;b uuid;zone text;booking jsonb;
begin
 if hash is null or hash !~ '^[a-f0-9]{64}$' then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 select business_id into b from private.scheduling_offers where token_hash=hash;
 if b is null then raise exception 'This scheduling link is unavailable.' using errcode='P0002';end if;
 if slot is not null then perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));end if;
 select * into o from private.scheduling_offers where token_hash=hash for update;
 if o.status='revoked' then raise exception 'This scheduling link was replaced. Ask the business for new options.' using errcode='P0002';end if;
 if o.status='approved' and private.effective_plan(b)<>'pro' then
  raise exception 'Online scheduling is paused. Contact the business to arrange a time.' using errcode='P0002';
 end if;
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

create or replace function private.manage_worker_time_off(b uuid,worker uuid,s timestamptz,e timestamptz,note text,remove_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if remove_id is not null then
  delete from private.worker_time_off where id=remove_id and business_id=b
   and (user_id=auth.uid() or private.effective_plan(b)='pro');
  return;
 end if;
 perform private.validate_scheduling_workers(b,array[worker]);
 if s is null or e is null or e<=s or e-s>interval '90 days' or length(coalesce(note,''))>200 then raise exception 'Check the time-off dates and note.' using errcode='22023';end if;
 insert into private.worker_time_off(business_id,user_id,starts_at,ends_at,note) values(b,worker,s,e,coalesce(btrim(note),''));
end $$;
