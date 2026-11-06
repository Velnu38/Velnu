-- Deposit requests are separate invoices; only actual received funds are credited.
alter table public.invoices add column deposit_estimate_id uuid,
 add column deposit_source_invoice_id uuid,
 add column deposit_credit numeric(12,2) not null default 0 check(deposit_credit>=0);
alter table public.invoices add constraint deposit_estimate_tenant_fk foreign key(deposit_estimate_id,business_id) references public.estimates(id,business_id),
 add constraint deposit_source_tenant_fk foreign key(deposit_source_invoice_id,business_id) references public.invoices(id,business_id),
 add constraint deposit_not_final check(deposit_estimate_id is null or (estimate_id is null and job_id is null and deposit_source_invoice_id is null and deposit_credit=0));
create unique index invoices_one_active_deposit on public.invoices(deposit_estimate_id) where deposit_estimate_id is not null and status<>'void';
create unique index invoices_one_deposit_credit on public.invoices(deposit_source_invoice_id) where deposit_source_invoice_id is not null and status<>'void';

create function private.guard_deposit_invoice() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype; d public.invoices%rowtype;
begin
 if tg_op='UPDATE' then
  if (new.deposit_estimate_id,new.deposit_source_invoice_id,new.deposit_credit) is distinct from (old.deposit_estimate_id,old.deposit_source_invoice_id,old.deposit_credit) then raise exception 'Deposit links and credits are immutable.';end if;
  if new.deposit_estimate_id is not null and (new.customer_id<>old.customer_id or new.job_id is not null) then raise exception 'Schedule the approved estimate, not its deposit invoice.';end if;
  if new.deposit_source_invoice_id is not null and new.customer_id<>old.customer_id then raise exception 'A credited invoice must keep its original customer.';end if;
  if new.deposit_estimate_id is not null and new.status not in('draft','void') and (new.total<=0 or new.total>=(select total from public.estimates where id=new.deposit_estimate_id)) then raise exception 'Deposit must be less than the estimate total.';end if;
  if new.status<>'draft' and new.subtotal+new.tax_amount<new.deposit_credit then raise exception 'Invoice charges cannot be less than the deposit credit.';end if;
  return new;
 end if;
 if new.deposit_estimate_id is not null then
  select * into e from public.estimates where id=new.deposit_estimate_id and business_id=new.business_id for update;
  if not found or e.status<>'accepted' or e.customer_id<>new.customer_id then raise exception 'An accepted estimate for this customer is required.';end if;
  if exists(select 1 from public.invoices where estimate_id=e.id) then raise exception 'A final invoice already exists.';end if;
 end if;
 if new.deposit_source_invoice_id is not null then
  select * into d from public.invoices where id=new.deposit_source_invoice_id and business_id=new.business_id for update;
  if not found or d.deposit_estimate_id is distinct from new.estimate_id or d.customer_id<>new.customer_id or d.status<>'paid' or d.amount_paid<>d.total or new.deposit_credit<>d.amount_paid then raise exception 'Only a fully received deposit for this estimate can be credited.';end if;
 elsif new.deposit_credit<>0 then raise exception 'A credit must reference its paid deposit invoice.';
 end if;
 return new;
end $$;
create trigger a_deposit_invoice_guard before insert or update on public.invoices for each row execute function private.guard_deposit_invoice();
revoke all on function private.guard_deposit_invoice() from public,anon,authenticated;

create function public.create_estimate_deposit(p_estimate uuid,p_amount numeric,p_due date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype; d public.invoices%rowtype; iid uuid;
begin
 select * into e from public.estimates where id=p_estimate;
 if auth.uid() is null or e.id is null or not private.member_module_access(e.business_id,auth.uid(),'billing') or not private.can_write_business(e.business_id) then raise exception 'Billing access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||e.business_id::text,0));
 select * into e from public.estimates where id=p_estimate for update;
 select * into d from public.invoices where deposit_estimate_id=e.id and status<>'void' for update;
 if found then
  if d.total<>p_amount then raise exception 'A deposit invoice already exists with a different amount. Open it before creating another.';end if;
  return d.id;
 end if;
 if p_amount is null or p_amount<=0 or p_amount>=e.total or p_amount<>round(p_amount,2) then raise exception 'Enter a deposit greater than zero and less than the estimate total, with two decimal places.';end if;
 if p_due is not null and p_due<(now() at time zone(select timezone from public.businesses where id=e.business_id))::date then raise exception 'Due date cannot be in the past.';end if;
 insert into public.invoices(business_id,customer_id,deposit_estimate_id,due_date,customer_message,payment_links,payment_instructions)
 values(e.business_id,e.customer_id,e.id,p_due,'Deposit toward estimate '||coalesce(e.estimate_number,e.id::text)||'. This payment will be credited on the final invoice. Final work and taxes are itemized on that invoice.',coalesce(e.payment_links,(select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce(e.payment_instructions,(select payment_instructions from public.business_settings where business_id=e.business_id),'')) returning id into iid;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order)
 values(iid,e.business_id,'Deposit toward estimate '||coalesce(e.estimate_number,e.id::text),1,p_amount,0,0);
 return iid;
end $$;
revoke all on function public.create_estimate_deposit(uuid,numeric,date) from public,anon;
grant execute on function public.create_estimate_deposit(uuid,numeric,date) to authenticated;

create function private.prepare_estimate_final(p_estimate uuid,p_due date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype; d public.invoices%rowtype; iid uuid; co record; n integer;
begin
 select * into e from public.estimates where id=p_estimate for update;
 if not found then raise exception 'Estimate unavailable.';end if;
 select id into iid from public.invoices where estimate_id=e.id;
 if iid is not null then return iid;end if;
 if e.status<>'accepted' then raise exception 'Accept the estimate before creating its final invoice.';end if;
 if p_due is not null and p_due<(now() at time zone(select timezone from public.businesses where id=e.business_id))::date then raise exception 'Due date cannot be in the past.';end if;
 select * into d from public.invoices where deposit_estimate_id=e.id and status<>'void' for update;
 if found and (d.status<>'paid' or d.amount_paid<>d.total) then raise exception 'Settle the deposit invoice first, or void it if no payment was received, then prepare the final invoice.' using errcode='23514';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=e.id) then raise exception 'The approved estimate has no line items.';end if;
 insert into public.invoices(business_id,customer_id,job_id,estimate_id,due_date,notes,customer_message,payment_links,payment_instructions,deposit_source_invoice_id,deposit_credit)
 values(e.business_id,e.customer_id,e.job_id,e.id,p_due,e.notes,concat_ws(E'\n\n',e.customer_message,case when d.id is not null then 'Deposit received on '||coalesce(d.invoice_number,d.id::text)||': $'||d.amount_paid::text||'. This amount is credited in the final balance below.' end),coalesce(e.payment_links,(select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce(e.payment_instructions,(select payment_instructions from public.business_settings where business_id=e.business_id),''),d.id,coalesce(d.amount_paid,0)) returning id into iid;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order)
 select iid,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=e.id order by sort_order;
 select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 -- Approved additions are copied once, together with the original approved scope.
 for co in select c.id,c.change_order_number,c.title from public.change_orders c where c.business_id=e.business_id and c.status='approved' and c.source_invoice_id is null and (c.estimate_id=e.id or (c.estimate_id is null and c.job_id=e.job_id)) order by c.created_at,c.id loop
  insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order)
  select iid,business_id,left('Change order '||coalesce(co.change_order_number,co.title)||': '||description,1000),quantity,unit_price,tax_rate,n+row_number() over(order by sort_order,id)::integer from public.change_order_items where change_order_id=co.id order by sort_order,id;
  select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 end loop;
 update public.estimates set status='converted' where id=e.id;
 return iid;
end $$;
revoke all on function private.prepare_estimate_final(uuid,date) from public,anon,authenticated;

create or replace function public.convert_estimate_to_invoice(target_estimate_id uuid,target_due_date date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 select business_id into b from public.estimates where id=target_estimate_id;
 if auth.uid() is null or b is null or not private.member_module_access(b,auth.uid(),'billing') or not private.can_write_business(b) then raise exception 'Billing access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 return private.prepare_estimate_final(target_estimate_id,target_due_date);
end $$;

CREATE OR REPLACE FUNCTION private.commerce_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare parent uuid;b uuid;st numeric(12,2);tx numeric(12,2);kind text;begin if tg_op='DELETE' then parent:=coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid;b:=old.business_id;else parent:=coalesce(to_jsonb(new)->>'invoice_id',to_jsonb(new)->>'estimate_id')::uuid;b:=new.business_id;end if;kind:=case when tg_table_name='invoice_items' then 'invoices' else 'estimates' end;execute format('select coalesce(sum(line_total),0),coalesce(sum(round(line_total*tax_rate/100,2)),0) from public.%I where %I=$1 and business_id=$2',tg_table_name,case when kind='invoices' then 'invoice_id' else 'estimate_id' end) into st,tx using parent,b;if kind='invoices' then update public.invoices set subtotal=st,tax_amount=tx,total=greatest(st+tx-deposit_credit,0) where id=parent and business_id=b;else update public.estimates set subtotal=st,tax_amount=tx,total=st+tx where id=parent and business_id=b;end if;if tg_op='DELETE' then return old;end if;return new;end$function$;


create or replace function public.complete_job_workflow(p_job uuid,p_actor uuid,p_retry_only boolean default false) returns jsonb
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
 invoice:=private.prepare_estimate_final(quote.id,null);
 exception when others then invoice:=null;failure:=case when sqlstate in('23514','P0001') then case when exists(select 1 from public.invoices where deposit_estimate_id=quote.id and status not in('paid','void')) then 'deposit_needs_settlement' else 'document_limit_or_review' end else 'invoice_preparation_failed' end;end;
 else failure:='pricing_required';end if;end if;
 insert into private.job_invoice_results(job_id,business_id,invoice_id,error_code) values(j.id,b,invoice,failure)
 on conflict(job_id) do update set invoice_id=excluded.invoice_id,error_code=excluded.error_code,updated_at=now();
 return jsonb_build_object('job_id',j.id,'status','completed','invoice_ready',invoice is not null,'invoice_id',case when finance then invoice else null end,
 'needs_pricing',failure='pricing_required','needs_review',failure is not null);
end $$;

-- A credited receipt cannot be reversed independently of its final invoice.
create function private.guard_credited_deposit_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.invoices where deposit_source_invoice_id=old.invoice_id and status<>'void') then
  raise exception 'This deposit is credited on a final invoice. Its receipt cannot be changed independently.';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger a_credited_deposit_payment before update or delete on public.payments for each row execute function private.guard_credited_deposit_payment();
revoke all on function private.guard_credited_deposit_payment() from public,anon,authenticated;
