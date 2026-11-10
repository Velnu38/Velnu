-- Owner controls reuse the existing recurring draft engine. No sends or charges.
create function public.get_recurring_invoice_page(p_business uuid,p_status text default 'current',p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) or not private.member_module_access(p_business,auth.uid(),'billing') then
  raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 if p_status not in('current','all','active','paused','ended') or p_status is null or (p_before is null)<>(p_before_id is null) then
  raise exception 'Choose a valid recurring schedule page.' using errcode='22023';end if;
 with page as (
  select p.id,p.source_invoice_id,p.title,p.cadence,p.next_date,p.end_date,p.status,p.last_error,p.schedule_visit,p.timezone,p.visit_time,p.due_days,p.created_at,
   (select coalesce(jsonb_agg(to_jsonb(x) order by x.bill_date desc,x.id desc),'[]'::jsonb) from
    (select o.id,o.bill_date,o.invoice_id,o.job_id,o.schedule_error from private.recurring_invoice_occurrences o
     where o.plan_id=p.id and o.business_id=p_business order by o.bill_date desc,o.id desc limit 12)x) occurrences
  from private.recurring_invoice_plans p where p.business_id=p_business
   and (p_status='all' or (p_status='current' and p.status<>'ended') or p.status=p_status)
   and (p_before is null or (p.created_at,p.id)<(p_before,p_before_id))
  order by p.created_at desc,p.id desc limit 26
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
   (select * from page order by created_at desc,id desc limit 25)x),'[]'::jsonb),'has_more',(select count(*)>25 from page),
   'counts',(select jsonb_build_object('active',count(*) filter(where status='active'),'paused',count(*) filter(where status='paused'),'ended',count(*) filter(where status='ended')) from private.recurring_invoice_plans where business_id=p_business)) into result;
 return result;
end $$;
revoke all on function public.get_recurring_invoice_page(uuid,text,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.get_recurring_invoice_page(uuid,text,timestamptz,uuid) to authenticated;
create index recurring_plans_owner_page on private.recurring_invoice_plans(business_id,created_at desc,id desc);

-- Deposits and deposit-adjusted final bills cannot become new full-price repeats.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.create_recurring_invoice(uuid,uuid,jsonb)'::regprocedure);
 needle:=' if request is null or options is null or jsonb_typeof(options)<>''object'' or pg_column_size(options)>8192 then';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Recurring creation source changed; review before applying.';end if;
 execute replace(definition,needle,E' if i.deposit_estimate_id is not null or i.deposit_source_invoice_id is not null or coalesce(i.deposit_credit,0)<>0 then\n  raise exception ''Use a regular invoice without deposit credits as the recurring template.'' using errcode=''23514'';end if;\n'||needle);
end $$;
