-- Approved work gets one unscheduled job; approving work never books or messages a customer.
create function private.ensure_approved_management_job(p_estimate uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype;j uuid;scope text;title text;
begin
 select * into e from public.estimates where id=p_estimate for update;
 if not found or e.status not in('accepted','converted') then raise exception 'An approved estimate is required.' using errcode='23514';end if;
 if e.job_id is not null then return e.job_id;end if;
 select id into j from public.jobs where business_id=e.business_id and source_estimate_id=e.id;
 if j is null then
  select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) into scope from public.estimate_items where business_id=e.business_id and estimate_id=e.id;
  select left(description,200) into title from public.estimate_items where business_id=e.business_id and estimate_id=e.id order by sort_order,id limit 1;
  if scope is null then raise exception 'The approved estimate has no scope.' using errcode='23514';end if;
  insert into public.jobs(business_id,customer_id,property_id,title,description,status,source_estimate_id)
   values(e.business_id,e.customer_id,e.property_id,coalesce(title,'Approved work'),scope,'lead',e.id) returning id into j;
 end if;
 update public.estimates set job_id=j where id=e.id and business_id=e.business_id;
 update public.invoices set job_id=j where estimate_id=e.id and business_id=e.business_id and job_id is null and deposit_estimate_id is null;
 return j;
end $$;
revoke all on function private.ensure_approved_management_job(uuid) from public,anon,authenticated,service_role;
create function private.capture_approved_management_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('accepted','converted') and (tg_op='INSERT' or old.status is distinct from new.status) then perform private.ensure_approved_management_job(new.id);end if;
 return new;
end $$;
revoke all on function private.capture_approved_management_job() from public,anon,authenticated,service_role;
create trigger approved_management_job after insert or update of status on public.estimates for each row execute function private.capture_approved_management_job();

create function private.get_approved_management_queue(p_business uuid,p_customer uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.job_workspace_access(p_business),false) or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Job and billing access required.' using errcode='42501';end if;
 if p_offset<0 or p_offset is null then raise exception 'Invalid page.' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select e.id,e.estimate_number,e.customer_id,e.total,
 coalesce((select left(description,200) from public.estimate_items where business_id=p_business and estimate_id=e.id order by sort_order,id limit 1),'Approved work') title,
 coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer') customer
 from public.estimates e join public.customers c on c.id=e.customer_id and c.business_id=p_business
 where e.business_id=p_business and (p_customer is null or e.customer_id=p_customer) and e.status in('accepted','converted') and e.job_id is null
 and not exists(select 1 from public.invoices i where i.business_id=p_business and i.estimate_id=e.id and i.work_completed)
 order by e.id limit 200 offset p_offset)x),'[]'::jsonb);
end $$;
create function private.prepare_approved_management_job(p_business uuid,p_estimate uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.job_workspace_access(p_business),false) or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) or not exists(select 1 from public.estimates where business_id=p_business and id=p_estimate) then raise exception 'Job and billing access required.' using errcode='42501';end if;
 return private.ensure_approved_management_job(p_estimate);
end $$;
create function public.get_approved_management_queue(p_business uuid,p_customer uuid default null,p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$select private.get_approved_management_queue(p_business,p_customer,p_offset)$$;
create function public.prepare_approved_management_job(p_business uuid,p_estimate uuid) returns uuid language sql security invoker set search_path='' as $$select private.prepare_approved_management_job(p_business,p_estimate)$$;
revoke all on function private.get_approved_management_queue(uuid,uuid,integer),private.prepare_approved_management_job(uuid,uuid),public.get_approved_management_queue(uuid,uuid,integer),public.prepare_approved_management_job(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_approved_management_queue(uuid,uuid,integer),private.prepare_approved_management_job(uuid,uuid),public.get_approved_management_queue(uuid,uuid,integer),public.prepare_approved_management_job(uuid,uuid) to authenticated;

-- Existing scheduling calls must reuse the new unscheduled record, including customer booking links.
create or replace function private.book_estimate_job(estimate uuid,site uuid,title text,workers uuid[],s timestamptz,e timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare quote public.estimates%rowtype;j public.jobs%rowtype;appointment uuid;jobid uuid;
begin
 select * into quote from public.estimates where id=estimate for update;
 if not found or quote.status not in('accepted','converted') then raise exception 'The approved estimate is unavailable.' using errcode='23514';end if;
 jobid:=private.ensure_approved_management_job(quote.id);
 select * into j from public.jobs where id=jobid and business_id=quote.business_id for update;
 if j.status in('completed','canceled') then raise exception 'Reopen this job before scheduling more work.' using errcode='23514';end if;
 if exists(select 1 from public.appointments where job_id=j.id and business_id=j.business_id and status in('scheduled','confirmed','in_progress')) then return jsonb_build_object('job_id',j.id,'already_booked',true);end if;
 perform private.validate_scheduling_workers(quote.business_id,workers);
 if not private.schedule_window_valid(quote.business_id,s,e) or not private.scheduling_slot_free(quote.business_id,workers,s,e,j.id) then raise exception 'That time was just booked. Please choose another option.' using errcode='23P01';end if;
 if site is not null and not exists(select 1 from public.properties p where p.id=site and p.business_id=quote.business_id and p.customer_id=quote.customer_id) then raise exception 'The service address is unavailable.' using errcode='23503';end if;
 update public.jobs set property_id=site,title=book_estimate_job.title,scheduled_start=s,scheduled_end=e,assigned_user_ids=workers,status=case when status='in_progress' then status else 'scheduled' end where id=j.id and business_id=j.business_id;
 insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id) values(j.business_id,j.customer_id,j.id,book_estimate_job.title,s,e,'confirmed',workers[1]) returning id into appointment;
 update public.estimates set property_id=site where id=quote.id;
 delete from public.document_schedules where estimate_id=quote.id;
 return jsonb_build_object('job_id',j.id,'appointment_id',appointment,'starts_at',s,'ends_at',e,'already_booked',false);
end $$;

create or replace function private.approve_scheduling_offer_before_live(estimate uuid,request uuid,input jsonb,hash text) returns jsonb
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
 if e.status not in('accepted','converted') or (e.job_id is not null and exists(select 1 from public.jobs j where j.id=e.job_id and j.business_id=e.business_id and (j.status in('completed','canceled') or exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=j.business_id and a.status in('scheduled','confirmed','in_progress'))))) then raise exception 'This estimate is not awaiting a new job.' using errcode='23514';end if;
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
     if not found or quote.status not in ('accepted','converted') or (quote.job_id is not null and exists(select 1 from public.jobs j where j.id=quote.job_id and j.business_id=quote.business_id and (j.status in('completed','canceled') or exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=j.business_id and a.status in('scheduled','confirmed','in_progress'))))) then
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

-- Keep Home scheduling attention visible until an actual appointment is saved.
create or replace function private.workflow_attention_rows(b uuid)
returns table(kind text, id uuid, sort_at timestamptz, data jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then
    raise exception 'Workflow access is required.' using errcode='42501';
  end if;
  return query
    with approved as materialized (
      select e.id, e.estimate_number, e.updated_at,
        coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company, 'Customer') customer_name,
        (select jsonb_build_object('status', o.status, 'expires_at', o.expires_at)
          from private.scheduling_offers o
          where o.estimate_id=e.id and o.business_id=b
          order by o.approved_at desc, o.id limit 1) offer
      from public.estimates e
      join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
      where e.business_id=b and e.status in ('accepted','converted') and (e.job_id is null or exists(select 1 from public.jobs j where j.id=e.job_id and j.business_id=b and j.status not in('completed','canceled') and not exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=b and a.status in('scheduled','confirmed','in_progress'))))
        and not exists (
          select 1 from public.calendar_work w
          where w.business_id=b and (
            (w.document_kind='estimate' and w.document_id=e.id)
            or (w.document_kind='invoice' and exists (
              select 1 from public.invoices i
              where i.business_id=b and i.id=w.document_id and i.estimate_id=e.id
            ))
          )
        )
    ), completed as materialized (
      select j.id, j.title, j.completed_at,
        i.id invoice_id, i.status invoice_status, r.error_code
      from public.jobs j
      left join private.job_invoice_results r on r.job_id=j.id
      left join lateral (
        select invoice.id, invoice.status from public.invoices invoice
        where invoice.job_id=j.id and invoice.business_id=b and invoice.status<>'void'
        order by invoice.created_at, invoice.id limit 1
      ) i on true
      where j.business_id=b and j.status='completed'
        and (r.job_id is not null or j.source_estimate_id is not null)
        and not exists (
          select 1 from public.invoices invoice where invoice.job_id=j.id
            and invoice.business_id=b and invoice.status not in ('draft','void')
        )
    )
    select 'approved'::text, a.id, a.updated_at, to_jsonb(a)-'updated_at' from approved a
    union all
    select 'completed'::text, c.id, c.completed_at, to_jsonb(c)-'completed_at' from completed c;
end $$;
