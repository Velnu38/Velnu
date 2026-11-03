-- A bounded, single attention queue. Read-only: no customer records are changed.
-- Both legacy workflow previews and paging share the same eligibility rules.
create function private.workflow_attention_rows(b uuid)
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
      where e.business_id=b and e.status in ('accepted','converted') and e.job_id is null
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
revoke all on function private.workflow_attention_rows(uuid) from public,anon,authenticated;

create or replace function private.workflow_next_actions(b uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with actions as materialized (select * from private.workflow_attention_rows(b)),
  ranked as (select *, row_number() over(partition by kind order by sort_at desc nulls last,id) n from actions)
  select jsonb_build_object(
    'approved_count',count(*) filter(where kind='approved'),
    'completed_count',count(*) filter(where kind='completed'),
    'approved',coalesce(jsonb_agg(data order by n) filter(where kind='approved' and n<=20),'[]'::jsonb),
    'completed',coalesce(jsonb_agg(data order by n) filter(where kind='completed' and n<=20),'[]'::jsonb)
  ) from ranked;
$$;

create function private.dashboard_attention_page(b uuid, requested_page integer, page_size integer, view_filter text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  work_items jsonb := '[]'::jsonb;
  today date;
begin
  if auth.uid() is null or not private.member_module_access(b,auth.uid(),'billing') then
    raise exception 'Billing access is required.' using errcode='42501';
  end if;
  if requested_page is null or requested_page<1 or page_size is null or page_size<1 or page_size>50
    or view_filter is null or view_filter not in ('attention','approvals') then
    raise exception 'Invalid attention page.' using errcode='22023';
  end if;
  select (now() at time zone coalesce(nullif(timezone,''),'America/New_York'))::date into today from public.businesses where id=b;
  if private.can_manage_schedule(b) then
    select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into work_items from private.workflow_attention_rows(b) w;
  end if;
  return (
    with all_items as materialized (
      select w.kind,w.id,w.sort_at,case when w.kind='approved' then 0 else 1 end priority,w.data
      from jsonb_to_recordset(work_items) w(kind text,id uuid,sort_at timestamptz,data jsonb)
      union all
      select 'reminder',r.id,r.due_at,2,jsonb_build_object('id',r.id,'kind',r.kind,'due_at',r.due_at,'note',r.note,
        'invoice_id',r.invoice_id,'estimate_id',r.estimate_id,'job_id',r.job_id,'customer_id',r.customer_id)
      from public.reminders r where r.business_id=b and r.status='pending' and r.due_at<=now()
        and private.member_module_access(b,auth.uid(),'calendar')
      union all
      select 'invoice',i.id,i.due_date::timestamptz,3,jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,
        'due_date',i.due_date,'balance_due',i.balance_due,'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.invoices i join public.customers c on c.id=i.customer_id and c.business_id=i.business_id
      where i.business_id=b and i.status in ('sent','viewed','partial','overdue') and i.balance_due>0 and i.due_date<today
      union all
      select 'estimate',e.id,e.issue_date::timestamptz,4,jsonb_build_object('id',e.id,'document_type','estimate','number',e.estimate_number,
        'title','Estimate awaiting approval','total',e.total,'issue_date',e.issue_date,'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.estimates e join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
      where e.business_id=b and e.status='sent'
      union all
      select 'change_order',o.id,o.issue_date::timestamptz,4,jsonb_build_object('id',o.id,'document_type','change_order','estimate_id',o.estimate_id,'number',o.change_order_number,
        'title',o.title,'total',o.total,'issue_date',o.issue_date,'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.change_orders o join public.customers c on c.id=o.customer_id and c.business_id=o.business_id
      where o.business_id=b and o.status='sent'
    ), visible as materialized (
      select *,row_number() over(partition by priority order by sort_at asc nulls last,kind,id) item_number
      from all_items where view_filter='attention' or priority=4
    ), counts as (
      select count(*) total,greatest(1,least(requested_page,ceil(count(*)::numeric/page_size)::integer)) page from visible
    ), page_items as (
      -- Interleave categories so the first page exposes different kinds of action.
      -- ID is the final tiebreaker, preventing skips when dates are identical.
      select * from visible order by item_number,priority,kind,id
      limit page_size offset ((select page from counts)-1)::bigint*page_size
    )
    select jsonb_build_object('page',counts.page,'page_size',page_size,'total',counts.total,
      'attention_count',(select count(*) from all_items),'approval_count',(select count(*) from all_items where priority=4),
      'items',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'data',data) order by item_number,priority,kind,id) from page_items),'[]'::jsonb)) from counts
  );
end $$;

create function public.get_dashboard_attention_page(p_business uuid,p_page integer default 1,p_page_size integer default 5,p_filter text default 'attention')
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.dashboard_attention_page(p_business,p_page,p_page_size,p_filter);
$$;
revoke all on function private.dashboard_attention_page(uuid,integer,integer,text),public.get_dashboard_attention_page(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function private.dashboard_attention_page(uuid,integer,integer,text),public.get_dashboard_attention_page(uuid,integer,integer,text) to authenticated;
