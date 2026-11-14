-- One bounded management page; totals and attention predicates cover the full scope.
create function public.get_job_management_page(p_business uuid,p_customer uuid default null,p_filter text default 'active',p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;billing boolean;zone text;today date;day_start timestamptz;query_text text:=lower(btrim(coalesce(p_search,'')));
begin
 if not coalesce(private.job_workspace_access(p_business),false) then raise exception 'Job access required.' using errcode='42501';end if;
 if p_filter is null or p_filter not in('all','active','approved','unscheduled','in_progress','billing','attention','history') or p_page is null or p_page<0 or p_page>100000000 or length(query_text)>200 then raise exception 'Choose a valid management page and search of up to 200 characters.' using errcode='22023';end if;
 billing:=coalesce(private.member_module_access(p_business,auth.uid(),'billing') and private.has_business_role(p_business,array['owner','admin','office']),false);
 if p_filter='billing' and not billing then raise exception 'Billing access required.' using errcode='42501';end if;
 select coalesce(timezone,'America/New_York') into zone from public.businesses where id=p_business;
 today:=(now() at time zone zone)::date;day_start:=today::timestamp at time zone zone;
 with base as materialized (
  select j.id,j.status,j.scheduled_start,j.scheduled_end,j.assigned_user_ids,j.source_estimate_id,
   lower(concat_ws(' ',j.title,coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer'),j.id,
    concat_ws(', ',nullif(btrim(pr.address_line1),''),nullif(btrim(pr.address_line2),''),nullif(concat_ws(' ',nullif(concat_ws(', ',nullif(btrim(pr.city),''),nullif(btrim(pr.state),'')),''),nullif(btrim(pr.postal_code),'')),'')))) search_text,
   coalesce(a.starts_at=j.scheduled_start and (j.scheduled_end is null or a.ends_at is null or a.ends_at=j.scheduled_end),false) booked,
   case when billing then inv.status end invoice_status,
   case when j.status not in('completed','canceled') then
    exists(select 1 from private.job_tasks where business_id=p_business and job_id=j.id and not completed and due_on<=today)
    or exists(select 1 from private.job_materials where business_id=p_business and job_id=j.id and status in('needed','ordered'))
    or (billing and exists(select 1 from public.change_orders c where c.business_id=p_business and
     (c.job_id=j.id or c.estimate_id=j.source_estimate_id or c.source_invoice_id in(select id from public.invoices where business_id=p_business and job_id=j.id)) and
     (c.status in('draft','sent') or c.status='approved' and private.change_order_billing_state(c)->>'action' in('add_to_draft','create_invoice','verify_existing','manual_review'))))
   else false end operational_attention
  from public.jobs j left join public.customers c on c.id=j.customer_id and c.business_id=p_business
  left join public.properties pr on pr.id=j.property_id and pr.business_id=p_business
  left join lateral(select starts_at,ends_at from public.appointments where business_id=p_business and job_id=j.id and status in('scheduled','confirmed','in_progress') order by (status='in_progress') desc,starts_at,id limit 1)a on true
  left join lateral(select status from public.invoices where billing and business_id=p_business and status<>'void' and deposit_estimate_id is null and (job_id=j.id or estimate_id=j.source_estimate_id) order by (job_id=j.id) desc nulls last,created_at desc,id limit 1)inv on true
  where j.business_id=p_business and (p_customer is null or j.customer_id=p_customer)
 ), flags as materialized (
  select *,jsonb_build_object('all',true,'active',status not in('completed','canceled'),'approved',status not in('completed','canceled') and source_estimate_id is not null,
   'unscheduled',status not in('completed','canceled') and not booked,'in_progress',status='in_progress',
   'billing',billing and status='completed' and (invoice_status is null or invoice_status='draft'),
   'attention',status not in('completed','canceled') and (operational_attention or coalesce(cardinality(assigned_user_ids),0)=0 or status in('scheduled','in_progress') and booked and scheduled_start<=now() and case when scheduled_end is not null then scheduled_end<=now() else scheduled_start<day_start end),
   'history',status in('completed','canceled')) filters from base
 ), approved as materialized (
  select e.id,e.estimate_number,e.customer_id,e.total,
   coalesce((select left(description,200) from public.estimate_items where business_id=p_business and estimate_id=e.id order by sort_order,id limit 1),'Approved work') title,
   coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer') customer
  from public.estimates e join public.customers c on c.id=e.customer_id and c.business_id=p_business
  where billing and e.business_id=p_business and (p_customer is null or e.customer_id=p_customer) and e.status in('accepted','converted') and e.job_id is null
   and not exists(select 1 from public.invoices i where i.business_id=p_business and i.estimate_id=e.id and i.work_completed)
 ), matches as materialized (
  select id,'job'::text kind,1 kind_order,scheduled_start from flags where (filters->>p_filter)::boolean and (query_text='' or strpos(search_text,query_text)>0)
  union all select id,'approved',0,null::timestamptz from approved where p_filter in('all','active','approved','unscheduled') and (query_text='' or strpos(lower(concat_ws(' ',title,customer,estimate_number)),query_text)>0)
 ), totals as (select count(*) n,least(p_page,greatest(0,(count(*)-1)/10)) actual_page from matches),
 selected as materialized (select * from matches order by kind_order,scheduled_start nulls last,id limit 10 offset (select actual_page*10 from totals)),
 workflows as (select value from jsonb_array_elements(public.get_job_workflow_context(p_business,coalesce((select array_agg(id) from selected where kind='job'),'{}'::uuid[])))),
 signals as (select public.get_job_management_signals(p_business,coalesce((select array_agg(id) from selected where kind='job'),'{}'::uuid[])) value)
 select jsonb_build_object(
  'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'data',case when s.kind='approved' then to_jsonb(a) else jsonb_build_object(
   'id',j.id,'title',j.title,'status',j.status,'customer_id',j.customer_id,'source_estimate_id',j.source_estimate_id,'scheduled_start',j.scheduled_start,'scheduled_end',j.scheduled_end,'assigned_user_ids',j.assigned_user_ids,
   'customers',case when c.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)) end,
   'properties',case when pr.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('address_line1',pr.address_line1,'address_line2',pr.address_line2,'city',pr.city,'state',pr.state,'postal_code',pr.postal_code)) end,
   'active_appointment',w.value->'active_appointment','invoice',w.value->'invoice') end) order by s.kind_order,s.scheduled_start nulls last,s.id)
  from selected s left join approved a on s.kind='approved' and a.id=s.id left join public.jobs j on s.kind='job' and j.id=s.id and j.business_id=p_business
  left join public.customers c on c.id=j.customer_id and c.business_id=p_business left join public.properties pr on pr.id=j.property_id and pr.business_id=p_business
  left join workflows w on w.value->>'job_id'=j.id::text),'[]'::jsonb),
  'signals',(select value from signals),'total',(select n from totals),'page',(select actual_page from totals),'page_size',10,
  'counts',jsonb_build_object('all',(select count(*) from flags),'active',(select count(*) from flags where (filters->>'active')::boolean),
   'approved',(select count(*) from approved),'unscheduled',(select count(*) from flags where (filters->>'unscheduled')::boolean)+(select count(*) from approved),
   'in_progress',(select count(*) from flags where status='in_progress'),'attention',(select count(*) from flags where (filters->>'attention')::boolean),
   'billing',(select count(*) from flags where (filters->>'billing')::boolean),'history',(select count(*) from flags where (filters->>'history')::boolean)),
  'checked_at',now()) into result;
 return result;
end $$;
revoke all on function public.get_job_management_page(uuid,uuid,text,text,integer) from public,anon,service_role;
grant execute on function public.get_job_management_page(uuid,uuid,text,text,integer) to authenticated;
