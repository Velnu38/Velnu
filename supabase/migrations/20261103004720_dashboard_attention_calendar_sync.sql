-- Keep next steps aligned with the same projection used to render the calendar.
-- This replaces one private read helper; it changes no customer records or grants.
create or replace function private.workflow_next_actions(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_manage_schedule(b)
    or not private.member_module_access(b, auth.uid(), 'billing') then
    raise exception 'Workflow access is required.' using errcode='42501';
  end if;

  return (
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
    select jsonb_build_object(
      'approved_count', (select count(*) from approved),
      'completed_count', (select count(*) from completed),
      'approved', coalesce((select jsonb_agg(to_jsonb(x)-'updated_at' order by x.updated_at desc, x.id)
        from (select * from approved order by updated_at desc, id limit 20) x), '[]'::jsonb),
      'completed', coalesce((select jsonb_agg(to_jsonb(x)-'completed_at' order by x.completed_at desc nulls last, x.id)
        from (select * from completed order by completed_at desc nulls last, id limit 20) x), '[]'::jsonb)
    )
  );
end $$;
