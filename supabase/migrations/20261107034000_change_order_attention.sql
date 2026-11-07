-- Put approved changes that require billing review in the existing Finish invoices queue.
create or replace function private.dashboard_attention_page(b uuid, requested_page integer, page_size integer, view_filter text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  work_items jsonb := '[]'::jsonb;
  today date;
  can_bill boolean;
begin
  if auth.uid() is null or not private.member_module_access(b,auth.uid(),'billing') then
    raise exception 'Billing access is required.' using errcode='42501';
  end if;
  if requested_page is null or requested_page<1 or page_size is null or page_size<1 or page_size>50
    or view_filter is null or view_filter not in ('attention','approvals','schedule','invoice','overdue','follow_up') then
    raise exception 'Invalid attention page.' using errcode='22023';
  end if;
  can_bill := private.can_write_business(b);
  select (now() at time zone coalesce(nullif(timezone,''),'America/New_York'))::date into today
  from public.businesses where id=b;
  if private.can_manage_schedule(b) then
    select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into work_items
    from private.workflow_attention_rows(b) w;
  end if;
  return (
    with all_items as materialized (
      select w.kind,w.id,w.sort_at,case when w.kind='approved' then 0 else 1 end priority,w.data
      from jsonb_to_recordset(work_items) w(kind text,id uuid,sort_at timestamptz,data jsonb)
      union all
      select 'change_order_billing',o.id,coalesce(o.approved_at,o.updated_at),1,
        jsonb_build_object('id',o.id,'number',o.change_order_number,'title',o.title,
          'total',coalesce((o.change_totals->>'change_amount')::numeric,o.total),
          'action',billing.state->>'action',
          'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.change_orders o
      join public.customers c on c.id=o.customer_id and c.business_id=o.business_id
      cross join lateral (select private.change_order_billing_state(o) as state offset 0) billing
      where can_bill and o.business_id=b and o.status='approved'
        and (o.source_invoice_id is not null or o.estimate_id is not null)
        and not exists (select 1 from private.change_order_billing a where a.change_order_id=o.id)
        and billing.state->>'action' in ('add_to_draft','create_invoice','manual_review','verify_existing')
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
        'title','Estimate awaiting customer approval','total',e.total,'issue_date',e.issue_date,'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.estimates e join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
      where e.business_id=b and e.status='sent'
      union all
      select 'change_order',o.id,o.issue_date::timestamptz,4,jsonb_build_object('id',o.id,'document_type','change_order','estimate_id',o.estimate_id,
        'number',o.change_order_number,'title',o.title,'total',coalesce((o.change_totals->>'change_amount')::numeric,o.total),'issue_date',o.issue_date,'customers',jsonb_build_array(jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'company',c.company)))
      from public.change_orders o join public.customers c on c.id=o.customer_id and c.business_id=o.business_id
      where o.business_id=b and o.status='sent'
    ), visible as materialized (
      select *,row_number() over(partition by priority order by sort_at asc nulls last,kind,id) item_number
      from all_items
      where (view_filter='attention' and priority<4) or (view_filter='approvals' and priority=4)
        or (view_filter='schedule' and kind='approved')
        or (view_filter='invoice' and kind in ('completed','change_order_billing'))
        or (view_filter='overdue' and kind='invoice')
        or (view_filter='follow_up' and kind='reminder')
    ), counts as (
      select count(*) total,greatest(1,least(requested_page,ceil(count(*)::numeric/page_size)::integer)) page from visible
    ), page_items as (
      select * from visible order by item_number,priority,kind,id
      limit page_size offset ((select page from counts)-1)::bigint*page_size
    ), category_counts as (
      select count(*) filter(where kind='approved') schedule,
        count(*) filter(where kind in ('completed','change_order_billing')) invoice,
        count(*) filter(where kind='invoice') overdue,
        count(*) filter(where kind='reminder') follow_up
      from all_items where priority<4
    )
    select jsonb_build_object('page',counts.page,'page_size',page_size,'total',counts.total,
      'attention_count',(select count(*) from all_items where priority<4),
      'approval_count',(select count(*) from all_items where priority=4),
      'category_counts',jsonb_build_object('schedule',category_counts.schedule,'invoice',category_counts.invoice,
        'overdue',category_counts.overdue,'follow_up',category_counts.follow_up),
      'items',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'data',data) order by item_number,priority,kind,id) from page_items),'[]'::jsonb))
    from counts cross join category_counts
  );
end $$;
