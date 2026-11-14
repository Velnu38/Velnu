-- Invoice-first scheduling: carry saved customer/scope into one job and event.
-- Financial state remains independent from work scheduling.
create function private.invoice_job_context(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; result jsonb; site uuid;
begin
 select * into i from public.invoices where id=p_invoice;
 if not found or not private.can_manage_schedule(i.business_id) or not private.member_module_access(i.business_id,auth.uid(),'billing') then
  raise exception 'Invoice and scheduling access is required.' using errcode='42501';
 end if;
 if i.status='void' then raise exception 'A void invoice cannot create work.' using errcode='23514';end if;
 result:=private.scheduling_context(i.business_id);
 select property_id into site from public.estimates where id=i.estimate_id and business_id=i.business_id;
 return result||jsonb_build_object('invoice',jsonb_build_object('id',i.id,'number',i.invoice_number,'customer_id',i.customer_id,'job_id',i.job_id,'property_id',site,
 'title',coalesce((select left(description,200) from public.invoice_items where invoice_id=i.id and business_id=i.business_id order by sort_order,id limit 1),'Service visit'),
 'scope',coalesce((select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) from public.invoice_items where invoice_id=i.id and business_id=i.business_id),''),
 'customer_name',(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') from public.customers where id=i.customer_id and business_id=i.business_id)),
 'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'address',concat_ws(', ',p.address_line1,p.address_line2,p.city,p.state,p.postal_code)) order by p.id) from public.properties p where p.business_id=i.business_id and p.customer_id=i.customer_id),'[]'::jsonb),
 'schedule',(select jsonb_build_object('starts_at',d.scheduled_start_time,'ends_at',d.scheduled_end_time) from public.document_schedules d where d.invoice_id=i.id and d.business_id=i.business_id and d.status<>'cancelled' limit 1));
end $$;
create function public.get_invoice_job_context(p_invoice uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.invoice_job_context(p_invoice)$$;

create function private.book_invoice_job(p_invoice uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype;q public.estimates%rowtype;b uuid;j uuid;site uuid;workers uuid[];s timestamptz;e timestamptz;scope text;title text;source_quote uuid;
begin
 select business_id into b from public.invoices where id=p_invoice;
 if b is null or not private.can_manage_schedule(b) or not private.member_module_access(b,auth.uid(),'billing') then
  raise exception 'Invoice and scheduling access is required.' using errcode='42501';
 end if;
 if p_request is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid job request.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into i from public.invoices where id=p_invoice and business_id=b for update;
 if i.status='void' then raise exception 'A void invoice cannot create work.' using errcode='23514';end if;
 if i.job_id is not null then return jsonb_build_object('job_id',i.job_id,'already_created',true);end if;
 if i.estimate_id is not null then
  select * into q from public.estimates where id=i.estimate_id and business_id=b for update;
  if found then
   if q.customer_id<>i.customer_id then raise exception 'The invoice customer does not match the estimate.' using errcode='23514';end if;
   if q.job_id is not null then update public.invoices set job_id=q.job_id where id=i.id;
    return jsonb_build_object('job_id',q.job_id,'already_created',true);end if;
   if q.status not in('accepted','converted') then raise exception 'Approve the estimate before scheduling its work.' using errcode='23514';end if;
   source_quote:=q.id;
  end if;
 end if;
 title:=btrim(p_input->>'title');site:=nullif(p_input->>'property_id','')::uuid;
 if length(coalesce(title,'')) not between 1 and 200 then raise exception 'Enter a job title, up to 200 characters.' using errcode='22023';end if;
 if not exists(select 1 from public.customers where id=i.customer_id and business_id=b and not archived) then raise exception 'The customer is unavailable.' using errcode='23503';end if;
 if site is not null and not exists(select 1 from public.properties where id=site and business_id=b and customer_id=i.customer_id) then raise exception 'Choose this customer’s service address.' using errcode='23503';end if;
 select array_agg(x::uuid order by x) into workers from jsonb_array_elements_text(p_input->'workers') x;
 perform private.validate_scheduling_workers(b,workers);
 s:=(p_input->>'starts_at')::timestamptz;e:=(p_input->>'ends_at')::timestamptz;
 if s is null or e is null or e<=s or e-s>interval '12 hours' then raise exception 'Choose a valid start and end, up to 12 hours.' using errcode='22023';end if;
 -- Replace only this document's legacy event inside the same transaction.
 -- A subsequent failure rolls this deletion back.
 delete from public.document_schedules where business_id=b and (invoice_id=i.id or (source_quote is not null and estimate_id=source_quote));
 if not private.scheduling_slot_free(b,workers,s,e) then raise exception 'The selected crew is already booked.' using errcode='23P01';end if;
 select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) into scope from public.invoice_items where invoice_id=i.id and business_id=b;
 if scope is null then raise exception 'Add the work to the invoice before creating a job.' using errcode='23514';end if;
 if length(scope)>4000 then scope:=left(scope,3800)||E'\nFull scope: see invoice '||coalesce(i.invoice_number,i.id::text)||'.';end if;
 insert into public.jobs(business_id,customer_id,property_id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,source_estimate_id,request_id,request_fingerprint)
 values(b,i.customer_id,site,title,left(scope,4000),'scheduled',s,e,workers,source_quote,p_request,encode(sha256(convert_to(jsonb_build_object('invoice',i.id,'input',p_input)::text,'UTF8')),'hex')) returning id into j;
 insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id) values(b,i.customer_id,j,title,s,e,'confirmed',workers[1]);
 update public.invoices set job_id=j where id=i.id;
 if source_quote is not null then update public.estimates set job_id=j,property_id=site where id=source_quote;
  update private.scheduling_offers set status='revoked' where estimate_id=source_quote and status='approved';
 end if;
 delete from public.document_schedules where business_id=b and (invoice_id=i.id or (source_quote is not null and estimate_id=source_quote));
 return jsonb_build_object('job_id',j,'already_created',false);
end $$;
create function public.book_invoice_job(p_invoice uuid,p_request uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.book_invoice_job(p_invoice,p_request,p_input)$$;
revoke all on function private.invoice_job_context(uuid),private.book_invoice_job(uuid,uuid,jsonb),public.get_invoice_job_context(uuid),public.book_invoice_job(uuid,uuid,jsonb) from public,anon;
grant execute on function private.invoice_job_context(uuid),private.book_invoice_job(uuid,uuid,jsonb),public.get_invoice_job_context(uuid),public.book_invoice_job(uuid,uuid,jsonb) to authenticated;
