-- Additive operations workspace. No bank feeds, paid services or plan changes.
create table private.job_tasks (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 job_id uuid not null, title text not null check(length(btrim(title)) between 1 and 240),
 completed boolean not null default false, due_on date, worker_id uuid,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade,
 foreign key(business_id,worker_id) references private.worker_profiles(business_id,id)
);
create index job_tasks_workspace on private.job_tasks(business_id,job_id,created_at,id);
create table private.job_time_entries (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 job_id uuid not null, worker_id uuid, worked_on date not null, minutes integer not null check(minutes between 1 and 1440),
 hourly_cost numeric(12,2) not null default 0 check(hourly_cost between 0 and 10000),
 note text not null default '' check(length(note)<=400), created_by uuid not null references auth.users(id),
 request_id uuid not null, created_at timestamptz not null default now(), unique(business_id,request_id),
 foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade,
 foreign key(business_id,worker_id) references private.worker_profiles(business_id,id)
);
create index job_time_workspace on private.job_time_entries(business_id,job_id,worked_on,id);
create table private.job_budgets (
 business_id uuid not null references public.businesses(id) on delete cascade, job_id uuid not null,
 revenue numeric(14,2) not null default 0 check(revenue between 0 and 100000000),
 cost numeric(14,2) not null default 0 check(cost between 0 and 100000000),
 hours numeric(8,2) not null default 0 check(hours between 0 and 100000),
 version integer not null default 1, updated_at timestamptz not null default now(), primary key(business_id,job_id),
 foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade
);
create table private.job_activity (
 id bigint generated always as identity primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 job_id uuid not null, actor_id uuid references auth.users(id), event text not null check(length(event)<=400),
 created_at timestamptz not null default now(),foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade
);
create index job_activity_workspace on private.job_activity(business_id,job_id,id desc);
alter table private.job_tasks enable row level security;
alter table private.job_time_entries enable row level security;
alter table private.job_budgets enable row level security;
alter table private.job_activity enable row level security;
revoke all on private.job_tasks,private.job_time_entries,private.job_budgets,private.job_activity from public,anon,authenticated,service_role;

create function private.job_workspace_access(b uuid, finance boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.member_module_access(b,auth.uid(),'jobs')
 and (not finance or (private.member_module_access(b,auth.uid(),'finances') and private.has_business_role(b,array['owner','admin','office'])));
$$;
revoke all on function private.job_workspace_access(uuid,boolean) from public,anon,authenticated,service_role;

create function private.get_job_workspace(p_business uuid,p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; financial boolean;
begin
 if not private.job_workspace_access(p_business) or not exists(select 1 from public.jobs where id=p_job and business_id=p_business) then raise exception 'Job access required.' using errcode='42501';end if;
 financial:=private.job_workspace_access(p_business,true) and (select currency from public.businesses where id=p_business)='USD';
 result:=jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from private.job_tasks t where business_id=p_business and job_id=p_job),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select id,event,created_at from private.job_activity where business_id=p_business and job_id=p_job order by id desc limit 50) a),'[]'::jsonb),'financial_access',financial);
 if financial then
 result:=result||jsonb_build_object('budget',(select to_jsonb(b) from private.job_budgets b where business_id=p_business and job_id=p_job),
 'time',coalesce((select jsonb_agg(to_jsonb(t) order by t.worked_on desc,t.id) from private.job_time_entries t where business_id=p_business and job_id=p_job),'[]'::jsonb),
 'recorded_expenses',coalesce((select sum(amount) from public.bookkeeping_entries e where e.business_id=p_business and direction='expense' and currency='USD' and (e.job_id=p_job or e.invoice_id in(select id from public.invoices where business_id=p_business and job_id=p_job) or e.estimate_id in(select id from public.estimates where business_id=p_business and job_id=p_job))),0),
 'invoiced',coalesce((select sum(total) from public.invoices where business_id=p_business and job_id=p_job and status not in('draft','void') and deposit_estimate_id is null),0),
 'collected',coalesce((select sum(amount_paid) from public.invoices where business_id=p_business and job_id=p_job and status<>'void'),0),'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',invoice_number,'status',status,'total',total,'balance_due',balance_due) order by issue_date,id) from public.invoices where business_id=p_business and job_id=p_job),'[]'::jsonb));
 end if;
 return result;
end $$;

create function private.manage_job_workspace(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; t private.job_tasks%rowtype; changed integer; tid uuid; v integer; entry private.job_time_entries%rowtype; event_text text;
begin
 if not private.job_workspace_access(p_business) or not private.can_write_business(p_business) then raise exception 'Job editing access required.' using errcode='42501';end if;
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if p_action='add_task' then
   if j.status in('completed','canceled') then raise exception 'Reopen the job before adding work.' using errcode='23514';end if;
   if (select count(*) from private.job_tasks where business_id=p_business and job_id=p_job)>=100 then raise exception 'A job can contain up to 100 checklist items.' using errcode='23514';end if;
   tid:=(p_payload->>'id')::uuid;
   select * into t from private.job_tasks where id=tid;
   if found then
     if t.business_id<>p_business or t.job_id<>p_job or t.title is distinct from btrim(p_payload->>'title') or t.due_on is distinct from nullif(p_payload->>'due_on','')::date or t.worker_id is distinct from nullif(p_payload->>'worker_id','')::uuid then raise exception 'Request already contains different work.' using errcode='23505';end if;
     return public.get_job_workspace(p_business,p_job);
   end if;
   insert into private.job_tasks(id,business_id,job_id,title,due_on,worker_id) values(tid,p_business,p_job,btrim(p_payload->>'title'),nullif(p_payload->>'due_on','')::date,nullif(p_payload->>'worker_id','')::uuid);
   event_text:='Checklist item added';
 elsif p_action in('complete_task','remove_task') then
   if j.status in('completed','canceled') then raise exception 'Reopen the job before changing its checklist.' using errcode='23514';end if;
   tid:=(p_payload->>'id')::uuid;
   select * into t from private.job_tasks where business_id=p_business and job_id=p_job and id=tid for update;
   if not found or t.version is distinct from (p_payload->>'version')::integer then raise exception 'This checklist changed. Refresh before editing.' using errcode='40001';end if;
   if p_action='remove_task' then delete from private.job_tasks where id=tid;event_text:='Checklist item removed';
   else update private.job_tasks set completed=(p_payload->>'completed')::boolean,version=version+1,updated_at=now() where id=tid;event_text:=case when (p_payload->>'completed')::boolean then 'Checklist item completed' else 'Checklist item reopened' end;end if;
 elsif p_action in('save_budget','add_time','remove_time') then
   if not private.job_workspace_access(p_business,true) then raise exception 'Financial and job access required.' using errcode='42501';end if;
   if p_action='save_budget' then
     select version into v from private.job_budgets where business_id=p_business and job_id=p_job for update;
     if coalesce(v,0) is distinct from (p_payload->>'version')::integer then raise exception 'The budget changed. Refresh before editing.' using errcode='40001';end if;
     insert into private.job_budgets(business_id,job_id,revenue,cost,hours) values(p_business,p_job,(p_payload->>'revenue')::numeric,(p_payload->>'cost')::numeric,(p_payload->>'hours')::numeric)
     on conflict(business_id,job_id) do update set revenue=excluded.revenue,cost=excluded.cost,hours=excluded.hours,version=private.job_budgets.version+1,updated_at=now();
     event_text:='Job budget updated';
   elsif p_action='add_time' then
     select * into entry from private.job_time_entries where business_id=p_business and request_id=(p_payload->>'request_id')::uuid;
     if found then
       if entry.job_id<>p_job or entry.minutes is distinct from (p_payload->>'minutes')::integer or entry.hourly_cost is distinct from (p_payload->>'hourly_cost')::numeric or entry.worked_on is distinct from (p_payload->>'worked_on')::date or entry.worker_id is distinct from nullif(p_payload->>'worker_id','')::uuid or entry.note is distinct from coalesce(p_payload->>'note','') then raise exception 'Time request already saved different content.' using errcode='23505';end if;
       return public.get_job_workspace(p_business,p_job);
     end if;
     if (select count(*) from private.job_time_entries where business_id=p_business and job_id=p_job)>=2000 then raise exception 'This job has reached 2,000 time entries.' using errcode='23514';end if;
     if (p_payload->>'worked_on')::date > (now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date then raise exception 'Time must be recorded for today or earlier.' using errcode='23514';end if;
     insert into private.job_time_entries(business_id,job_id,worker_id,worked_on,minutes,hourly_cost,note,created_by,request_id)
     values(p_business,p_job,nullif(p_payload->>'worker_id','')::uuid,(p_payload->>'worked_on')::date,(p_payload->>'minutes')::integer,(p_payload->>'hourly_cost')::numeric,coalesce(p_payload->>'note',''),auth.uid(),(p_payload->>'request_id')::uuid);
     event_text:='Time and labor cost recorded';
   else
     delete from private.job_time_entries where business_id=p_business and job_id=p_job and id=(p_payload->>'id')::uuid;get diagnostics changed=row_count;
     if changed<>1 then raise exception 'Time entry unavailable. Refresh the job.' using errcode='40001';end if;
     event_text:='Time entry removed';
   end if;
 else raise exception 'Unknown job action.' using errcode='23514';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),event_text);
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
 return public.get_job_workspace(p_business,p_job);
end $$;

create function private.capture_job_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
 insert into private.job_activity(business_id,job_id,actor_id,event) values(new.business_id,new.id,auth.uid(),'Job created');
 elsif old.status is distinct from new.status then
 insert into private.job_activity(business_id,job_id,actor_id,event) values(new.business_id,new.id,auth.uid(),'Status changed to '||replace(new.status,'_',' '));
 elsif old.description is distinct from new.description then
 insert into private.job_activity(business_id,job_id,actor_id,event) values(new.business_id,new.id,auth.uid(),'Work details updated');
 elsif old.assigned_user_ids is distinct from new.assigned_user_ids or old.scheduled_start is distinct from new.scheduled_start or old.scheduled_end is distinct from new.scheduled_end then
 insert into private.job_activity(business_id,job_id,actor_id,event) values(new.business_id,new.id,auth.uid(),'Crew or appointment updated');
 end if;
 return new;
end $$;
revoke all on function private.capture_job_activity() from public,anon,authenticated,service_role;
create trigger job_workspace_activity after insert or update on public.jobs for each row execute function private.capture_job_activity();

create function private.get_financial_overview(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare today date; result jsonb;
begin
 if auth.uid() is null or not private.member_module_access(p_business,auth.uid(),'finances') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Financial access required.' using errcode='42501';end if;
 select (now() at time zone coalesce(timezone,'America/New_York'))::date into today from public.businesses where id=p_business;
 if (select currency from public.businesses where id=p_business) is distinct from 'USD' then return jsonb_build_object('currency_supported',false);end if;
 with due as (
 select i.id,i.invoice_number,i.customer_id,i.due_date,i.balance_due,i.status,
 case when i.status='overdue' and (i.due_date is null or i.due_date>=today) then 'date_review' when i.due_date is null or i.due_date>=today then 'current' when today-i.due_date<=30 then '1–30 days' when today-i.due_date<=60 then '31–60 days' when today-i.due_date<=90 then '61–90 days' else '91+ days' end bucket
 from public.invoices i where i.business_id=p_business and i.status in('sent','viewed','partial','overdue') and i.balance_due>0
 ),summary as(select count(*) invoices,coalesce(sum(balance_due),0) outstanding,coalesce(sum(balance_due) filter(where due_date<today or status='overdue'),0) overdue,count(*) filter(where due_date<today or status='overdue') overdue_count from due),
 buckets as(select bucket,count(*) count,sum(balance_due) amount from due group by bucket),
 customers as(select d.customer_id,coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer') customer,sum(d.balance_due) balance,count(*) invoices from due d join public.customers c on c.id=d.customer_id and c.business_id=p_business group by d.customer_id,c.first_name,c.last_name,c.company order by sum(d.balance_due) desc,d.customer_id limit 8)
 select jsonb_build_object('currency_supported',true,'as_of',today,'receivables',to_jsonb(s),'aging',coalesce((select jsonb_agg(to_jsonb(b)) from buckets b),'[]'::jsonb),'customers',coalesce((select jsonb_agg(to_jsonb(c)) from customers c),'[]'::jsonb),
 'oldest',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,invoice_number,due_date,balance_due from due where due_date<today order by due_date,id limit 8)x),'[]'::jsonb)) into result from summary s;
 return result;
end $$;

create function private.copy_document_to_draft(p_business uuid,p_kind text,p_id uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare doc jsonb; lines jsonb; result jsonb; today date;
begin
 if auth.uid() is null or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Billing access required.' using errcode='42501';end if;
 select (now() at time zone coalesce(timezone,'America/New_York'))::date into today from public.businesses where id=p_business;
 if p_kind='invoice' then
 select to_jsonb(i) into doc from public.invoices i where id=p_id and business_id=p_business;
 select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order,id) into lines from public.invoice_items where invoice_id=p_id and business_id=p_business;
 elsif p_kind='estimate' then
 select to_jsonb(e) into doc from public.estimates e where id=p_id and business_id=p_business;
 select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order,id) into lines from public.estimate_items where estimate_id=p_id and business_id=p_business;
 end if;
 if doc is null or lines is null then raise exception 'Document unavailable.' using errcode='42501';end if;
 result:=public.create_document(p_business,p_kind,p_request,jsonb_build_object('customer_id',doc->>'customer_id','notes',coalesce(doc->>'notes',''),'customer_message',coalesce(doc->>'customer_message',''),'items',lines,'due_date',today,'expires_on',today+30));
 return result;
end $$;

create function public.get_job_workspace(p_business uuid,p_job uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_job_workspace(p_business,p_job)$$;

create function public.manage_job_workspace(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.manage_job_workspace(p_business,p_job,p_action,p_payload)$$;

create function public.get_financial_overview(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_financial_overview(p_business)$$;

create function public.copy_document_to_draft(p_business uuid,p_kind text,p_id uuid,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select private.copy_document_to_draft(p_business,p_kind,p_id,p_request)$$;

-- Do not expose finance payloads or privileged backing tables to field workers.
revoke all on function public.get_job_workspace(uuid,uuid),public.manage_job_workspace(uuid,uuid,text,jsonb),public.get_financial_overview(uuid),public.copy_document_to_draft(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_job_workspace(uuid,uuid),public.manage_job_workspace(uuid,uuid,text,jsonb),public.get_financial_overview(uuid),public.copy_document_to_draft(uuid,text,uuid,uuid) to authenticated;

revoke all on function private.get_job_workspace(uuid,uuid),private.manage_job_workspace(uuid,uuid,text,jsonb),private.get_financial_overview(uuid),private.copy_document_to_draft(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_job_workspace(uuid,uuid),private.manage_job_workspace(uuid,uuid,text,jsonb),private.get_financial_overview(uuid),private.copy_document_to_draft(uuid,text,uuid,uuid) to authenticated;

create table private.expense_invoice_drafts(
 expense_id uuid primary key references public.bookkeeping_entries(id),business_id uuid not null references public.businesses(id),
 invoice_id uuid not null references public.invoices(id),created_at timestamptz not null default now()
);
alter table private.expense_invoice_drafts enable row level security;
revoke all on private.expense_invoice_drafts from public,anon,authenticated,service_role;
create index expense_invoice_drafts_business on private.expense_invoice_drafts(business_id,invoice_id);
create function private.bill_expense_to_draft(p_business uuid,p_expense uuid,p_customer uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.bookkeeping_entries%rowtype; existing uuid;customer uuid;document jsonb;
begin
 if auth.uid() is null or not private.member_module_access(p_business,auth.uid(),'finances') or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Financial and billing access required.' using errcode='42501';end if;
 select * into e from public.bookkeeping_entries where business_id=p_business and id=p_expense for update;
 if not found then raise exception 'Expense unavailable.' using errcode='42501';end if;
 select invoice_id into existing from private.expense_invoice_drafts where business_id=p_business and expense_id=p_expense;
 if found then return jsonb_build_object('id',existing,'existing',true,'status',(select status from public.invoices where id=existing and business_id=p_business));end if;
 if e.direction<>'expense' or e.currency<>'USD' or e.invoice_id is not null then raise exception 'Choose an unbilled USD expense that is not already attached to an invoice.' using errcode='23514';end if;
 if e.job_id is not null then select customer_id into customer from public.jobs where id=e.job_id and business_id=p_business;
 elsif e.estimate_id is not null then select customer_id into customer from public.estimates where id=e.estimate_id and business_id=p_business;end if;
 if customer is not null and p_customer is distinct from customer then raise exception 'Bill this expense to the customer on its source record.' using errcode='23514';end if;
 if not exists(select 1 from public.customers where id=p_customer and business_id=p_business and not archived) then raise exception 'Choose a current customer from this business.' using errcode='42501';end if;
 document:=public.create_document(p_business,'invoice',p_request,jsonb_build_object('customer_id',p_customer,'due_date',(now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date,'notes','Expense reimbursement draft. Review the receipt, tax treatment and customer agreement before sending.','items',jsonb_build_array(jsonb_build_object('description',e.description,'quantity',1,'unit_price',e.amount,'tax_rate',0))));
 if e.job_id is not null then update public.invoices set job_id=e.job_id where id=(document->>'id')::uuid and business_id=p_business and status='draft';end if;
 insert into private.expense_invoice_drafts(expense_id,business_id,invoice_id) values(p_expense,p_business,(document->>'id')::uuid);
 return jsonb_build_object('id',document->>'id','existing',false,'status','draft');
end $$;
create function public.bill_expense_to_draft(p_business uuid,p_expense uuid,p_customer uuid,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select private.bill_expense_to_draft(p_business,p_expense,p_customer,p_request)$$;
revoke all on function private.bill_expense_to_draft(uuid,uuid,uuid,uuid),public.bill_expense_to_draft(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.bill_expense_to_draft(uuid,uuid,uuid,uuid),public.bill_expense_to_draft(uuid,uuid,uuid,uuid) to authenticated;

create function private.get_customer_statement(p_business uuid,p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype;result jsonb;
begin
 if auth.uid() is null or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Billing access required.' using errcode='42501';end if;
 select * into c from public.customers where id=p_customer and business_id=p_business;
 if not found then raise exception 'Customer unavailable.' using errcode='42501';end if;
 if (select currency from public.businesses where id=p_business) is distinct from 'USD' then raise exception 'Customer statements currently support USD.' using errcode='23514';end if;
 with issued as(select id,invoice_number,issue_date,due_date,total,amount_paid,balance_due,deposit_credit,status from public.invoices where business_id=p_business and customer_id=p_customer and status in('sent','viewed','partial','overdue','paid')),
 entries as(select * from issued order by issue_date desc,id limit 2000)
 select jsonb_build_object('as_of',(now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date,
 'customer',jsonb_build_object('id',c.id,'name',coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer'),'email',c.email),
 'company',(select jsonb_build_object('name',coalesce(nullif(legal_name,''),name),'email',email,'phone',phone) from public.businesses where id=p_business),
 'outstanding',coalesce((select sum(greatest(balance_due,0)) from issued),0),'invoice_count',(select count(*) from issued),'limited',(select count(*)>2000 from issued),
 'invoices',coalesce((select jsonb_agg(to_jsonb(e) order by issue_date,id) from entries e),'[]'::jsonb)) into result;
 return result;
end $$;
create function public.get_customer_statement(p_business uuid,p_customer uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_customer_statement(p_business,p_customer)$$;
revoke all on function private.get_customer_statement(uuid,uuid),public.get_customer_statement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_customer_statement(uuid,uuid),public.get_customer_statement(uuid,uuid) to authenticated;
