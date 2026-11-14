-- Fail closed when membership helpers return NULL for an unknown user.
create or replace function private.job_workspace_access(b uuid, finance boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and private.member_module_access(b,auth.uid(),'jobs')
 and (not finance or (private.member_module_access(b,auth.uid(),'finances') and private.has_business_role(b,array['owner','admin','office']))),false);
$$;
-- Persistent job management. Existing job/document/payment records remain authoritative.
alter table private.job_tasks add column priority text not null default 'normal' check(priority in ('low','normal','high'));
create table private.job_materials (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 job_id uuid not null, name text not null check(length(btrim(name)) between 1 and 240),
 quantity numeric(12,3) not null check(quantity>0 and quantity<=1000000), unit text not null default '' check(length(unit)<=40),
 supplier text not null default '' check(length(supplier)<=160), status text not null default 'needed' check(status in('needed','ordered','received','used')),
 estimated_cost numeric(14,2) check(estimated_cost between 0 and 100000000),version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade
);
create index job_materials_workspace on private.job_materials(business_id,job_id,created_at,id);
create table private.job_task_templates (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
 created_at timestamptz not null default now(),unique(business_id,id)
);
create index job_task_templates_business on private.job_task_templates(business_id,created_at,id);
create table private.job_template_applications (
 business_id uuid not null references public.businesses(id) on delete cascade,job_id uuid not null,request_id uuid not null,template_id uuid not null,
 primary key(business_id,request_id),foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade
);
alter table private.job_materials enable row level security;
alter table private.job_task_templates enable row level security;
alter table private.job_template_applications enable row level security;
revoke all on private.job_materials,private.job_task_templates,private.job_template_applications from public,anon,authenticated,service_role;

create function private.get_job_management(p_business uuid,p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;j public.jobs%rowtype;billing boolean;finance boolean;calendar boolean;source uuid;
begin
 result:=private.get_job_workspace(p_business,p_job);
 select * into j from public.jobs where business_id=p_business and id=p_job;
 finance:=(result->>'financial_access')::boolean;
 billing:=private.member_module_access(p_business,auth.uid(),'billing') and private.has_business_role(p_business,array['owner','admin','office']);
 calendar:=private.member_module_access(p_business,auth.uid(),'calendar');
 result:=result||jsonb_build_object('billing_access',billing,'calendar_access',calendar,
 'materials',coalesce((select jsonb_agg((to_jsonb(m)-'business_id'-'job_id')-case when finance then '__none__' else 'estimated_cost' end order by m.created_at,m.id) from private.job_materials m where business_id=p_business and job_id=p_job),'[]'::jsonb),
 'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'count',jsonb_array_length(t.items)) order by t.name,t.id) from private.job_task_templates t where business_id=p_business),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'event',a.event,'created_at',a.created_at,'actor',case when a.actor_id is null then 'System' when a.actor_id=auth.uid() then 'You' else coalesce(nullif(u.raw_user_meta_data->>'full_name',''),'Team member') end) order by a.id desc)
 from (select * from private.job_activity where business_id=p_business and job_id=p_job order by id desc limit 50) a left join auth.users u on u.id=a.actor_id),'[]'::jsonb),
 'visits',case when calendar then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status) order by a.starts_at desc,a.id) from public.appointments a where business_id=p_business and job_id=p_job),'[]'::jsonb) else '[]'::jsonb end);
 if billing then
 select e.id into source from public.estimates e where e.business_id=p_business and (e.id=j.source_estimate_id or e.job_id=j.id) and e.status in('accepted','converted') order by (e.id=j.source_estimate_id) desc nulls last,e.created_at limit 1;
 result:=result||jsonb_build_object('source_estimate',case when source is null then null else (select jsonb_build_object('id',e.id,'number',e.estimate_number,'total',e.total) from public.estimates e where id=source) end,
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.invoice_number,'status',i.status,'total',i.total,'balance_due',i.balance_due,'amount_paid',i.amount_paid,'deposit',i.deposit_estimate_id is not null) order by i.created_at,i.id) from public.invoices i where i.business_id=p_business and (i.job_id=j.id or i.estimate_id=source or i.deposit_estimate_id=source)),'[]'::jsonb),
 'changes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.change_order_number,'title',c.title,'status',c.status,'estimate_id',c.estimate_id,'source_invoice_id',c.source_invoice_id,'billing_action',case when c.status='approved' then private.change_order_billing_state(c)->>'action' end,'total',coalesce((c.change_totals->>'change_amount')::numeric,c.total)) order by c.created_at,c.id) from public.change_orders c where c.business_id=p_business and (c.job_id=j.id or c.estimate_id=source or c.source_invoice_id in(select i.id from public.invoices i where i.business_id=p_business and (i.job_id=j.id or i.estimate_id=source)))),'[]'::jsonb));
 end if;
 return result;
end $$;

create function private.manage_job_management(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;m private.job_materials%rowtype;t private.job_tasks%rowtype;template private.job_task_templates%rowtype;application private.job_template_applications%rowtype;item jsonb;event_text text;new_id uuid;previous integer;
begin
 if not coalesce(private.job_workspace_access(p_business),false) or not coalesce(private.can_write_business(p_business),false) then raise exception 'Job editing access required.' using errcode='42501';end if;
 -- Serialize template limits and checklist application consistently before locking a job.
 perform pg_advisory_xact_lock(hashtextextended('finviant-job-management:'||p_business::text,0));
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if j.status in('completed','canceled') then raise exception 'Reopen this job before changing its work plan.' using errcode='23514';end if;
 if p_action in('save_material','remove_material') then
  new_id:=(p_payload->>'id')::uuid;
  select * into m from private.job_materials where id=new_id for update;
  if found and (m.business_id<>p_business or m.job_id<>p_job) then raise exception 'Material unavailable.' using errcode='42501';end if;
  if p_action='remove_material' then
   if m.id is null or m.version is distinct from (p_payload->>'version')::integer then raise exception 'Materials changed. Refresh before editing.' using errcode='40001';end if;
   delete from private.job_materials where id=new_id;event_text:='Material removed: '||m.name;
  else
   if m.id is not null and m.name=btrim(p_payload->>'name') and m.quantity=(p_payload->>'quantity')::numeric and m.unit=coalesce(p_payload->>'unit','') and m.supplier=coalesce(p_payload->>'supplier','') and m.status=p_payload->>'status' and (not (p_payload?'estimated_cost') or m.estimated_cost is not distinct from nullif(p_payload->>'estimated_cost','')::numeric) then return private.get_job_management(p_business,p_job);end if;
   if coalesce(m.version,0) is distinct from (p_payload->>'version')::integer then raise exception 'Materials changed. Refresh before editing.' using errcode='40001';end if;
   if m.id is null and (select count(*) from private.job_materials where business_id=p_business and job_id=p_job)>=200 then raise exception 'A job supports up to 200 materials.' using errcode='23514';end if;
   if p_payload?'estimated_cost' and not coalesce(private.job_workspace_access(p_business,true),false) then raise exception 'Financial access required for costs.' using errcode='42501';end if;
   insert into private.job_materials(id,business_id,job_id,name,quantity,unit,supplier,status,estimated_cost)
   values(new_id,p_business,p_job,btrim(p_payload->>'name'),(p_payload->>'quantity')::numeric,coalesce(p_payload->>'unit',''),coalesce(p_payload->>'supplier',''),p_payload->>'status',nullif(p_payload->>'estimated_cost','')::numeric)
   on conflict(id) do update set name=excluded.name,quantity=excluded.quantity,unit=excluded.unit,supplier=excluded.supplier,status=excluded.status,estimated_cost=case when p_payload?'estimated_cost' then excluded.estimated_cost else private.job_materials.estimated_cost end,version=private.job_materials.version+1,updated_at=now();
   event_text:='Material '||case when m.id is null then 'added: ' else 'updated: ' end||btrim(p_payload->>'name');
  end if;
 elsif p_action='edit_task' then
  select * into t from private.job_tasks where business_id=p_business and job_id=p_job and id=(p_payload->>'id')::uuid for update;
  if not found or t.version is distinct from (p_payload->>'version')::integer then raise exception 'Checklist changed. Refresh before editing.' using errcode='40001';end if;
  if nullif(p_payload->>'worker_id','') is not null and not exists(select 1 from private.worker_profiles where business_id=p_business and id=(p_payload->>'worker_id')::uuid and active) then raise exception 'Choose an active worker from this business.' using errcode='23514';end if;
  update private.job_tasks set title=btrim(p_payload->>'title'),due_on=nullif(p_payload->>'due_on','')::date,worker_id=nullif(p_payload->>'worker_id','')::uuid,priority=p_payload->>'priority',version=version+1,updated_at=now() where id=t.id;
  event_text:='Checklist item updated: '||btrim(p_payload->>'title');
 elsif p_action='save_template' then
  if not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office access required to manage shared templates.' using errcode='42501';end if;
  new_id:=(p_payload->>'id')::uuid;
  select * into template from private.job_task_templates where id=new_id;
  if found then
   if template.business_id<>p_business or template.name<>btrim(p_payload->>'name') then raise exception 'Template request already used.' using errcode='23505';end if;
   return private.get_job_management(p_business,p_job);
  end if;
  if (select count(*) from private.job_task_templates where business_id=p_business)>=50 then raise exception 'A business supports up to 50 templates.' using errcode='23514';end if;
  insert into private.job_task_templates(id,business_id,name,items)
   select new_id,p_business,btrim(p_payload->>'name'),jsonb_agg(jsonb_build_object('title',title,'priority',priority) order by created_at,id) from private.job_tasks where business_id=p_business and job_id=p_job;
  event_text:='Checklist saved as template';
 elsif p_action='apply_template' then
  select * into template from private.job_task_templates where business_id=p_business and id=(p_payload->>'template_id')::uuid;
  if not found then raise exception 'Template unavailable.' using errcode='42501';end if;
  select * into application from private.job_template_applications where business_id=p_business and request_id=(p_payload->>'request_id')::uuid;
  if found then
   if application.job_id<>p_job or application.template_id<>template.id then raise exception 'Template request already used.' using errcode='23505';end if;
   return private.get_job_management(p_business,p_job);
  end if;
  if (select count(*) from private.job_tasks where business_id=p_business and job_id=p_job)+jsonb_array_length(template.items)>100 then raise exception 'A job supports up to 100 checklist items.' using errcode='23514';end if;
  insert into private.job_template_applications values(p_business,p_job,(p_payload->>'request_id')::uuid,template.id);
  for item in select value from jsonb_array_elements(template.items) loop
   insert into private.job_tasks(business_id,job_id,title,priority) values(p_business,p_job,item->>'title',coalesce(item->>'priority','normal'));
  end loop;
  event_text:='Checklist template applied: '||template.name;
 elsif p_action='remove_template' then
  if not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office access required to manage shared templates.' using errcode='42501';end if;
  delete from private.job_task_templates where business_id=p_business and id=(p_payload->>'id')::uuid;
  if not found then raise exception 'Template unavailable.' using errcode='40001';end if;
  event_text:='Checklist template removed';
 else raise exception 'Unknown management action.' using errcode='22023';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),left(event_text,400));
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
 return private.get_job_management(p_business,p_job);
end $$;

create function private.get_job_management_signals(p_business uuid,p_jobs uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date;billing boolean;
begin
 if not coalesce(private.job_workspace_access(p_business),false) or p_jobs is null or cardinality(p_jobs)>200 or exists(select 1 from unnest(p_jobs) as requested(job_id) where requested.job_id is null or not exists(select 1 from public.jobs j where j.id=requested.job_id and j.business_id=p_business)) then raise exception 'Job access required for these records.' using errcode='42501';end if;
 select (now() at time zone coalesce(timezone,'America/New_York'))::date into today from public.businesses where id=p_business;
 billing:=private.member_module_access(p_business,auth.uid(),'billing') and private.has_business_role(p_business,array['owner','admin','office']);
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,
 'tasks_total',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id),
 'tasks_completed',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and completed),
 'due_tasks',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and not completed and due_on<=today),
 'materials_needed',(select count(*) from private.job_materials where business_id=p_business and job_id=j.id and status in('needed','ordered')),
 'pending_changes',case when billing then (select count(*) from public.change_orders c where c.business_id=p_business and (c.job_id=j.id or c.estimate_id=j.source_estimate_id or c.source_invoice_id in(select i.id from public.invoices i where i.business_id=p_business and i.job_id=j.id)) and (c.status in('draft','sent') or c.status='approved' and private.change_order_billing_state(c)->>'action' in('add_to_draft','create_invoice','verify_existing','manual_review'))) else 0 end) order by j.id),'[]'::jsonb) into result from public.jobs j where business_id=p_business and id=any(p_jobs);
 return result;
end $$;

create function private.finish_job_visit(p_business uuid,p_job uuid,p_appointment uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;a public.appointments%rowtype;
begin
 j:=private.lock_job_for_scheduling(p_job);
 if j.business_id<>p_business then raise exception 'Job access required.' using errcode='42501';end if;
 select * into a from public.appointments where business_id=p_business and job_id=p_job and id=p_appointment for update;
 if not found then raise exception 'Visit unavailable.' using errcode='42501';end if;
 if a.status='completed' then return;end if;
 if a.status not in('scheduled','confirmed','in_progress') or (a.starts_at,a.ends_at) is distinct from (j.scheduled_start,j.scheduled_end) then raise exception 'The appointment changed. Refresh before finishing this visit.' using errcode='40001';end if;
 if a.starts_at>now() then raise exception 'A future visit cannot be marked finished.' using errcode='23514';end if;
 update public.appointments set status='completed' where id=a.id and business_id=p_business;
 update public.jobs set scheduled_start=null,scheduled_end=null,status='in_progress' where id=j.id and business_id=p_business;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),'Visit finished; job remains open for further work');
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
end $$;

create function public.get_job_management(p_business uuid,p_job uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_job_management(p_business,p_job)$$;
create function public.manage_job_management(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.manage_job_management(p_business,p_job,p_action,p_payload)$$;
create function public.get_job_management_signals(p_business uuid,p_jobs uuid[]) returns jsonb language sql security invoker set search_path='' as $$select private.get_job_management_signals(p_business,p_jobs)$$;
create function public.finish_job_visit(p_business uuid,p_job uuid,p_appointment uuid) returns void language sql security invoker set search_path='' as $$select private.finish_job_visit(p_business,p_job,p_appointment)$$;
revoke all on function private.get_job_management(uuid,uuid),private.manage_job_management(uuid,uuid,text,jsonb),private.get_job_management_signals(uuid,uuid[]),private.finish_job_visit(uuid,uuid,uuid),public.get_job_management(uuid,uuid),public.manage_job_management(uuid,uuid,text,jsonb),public.get_job_management_signals(uuid,uuid[]),public.finish_job_visit(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_job_management(uuid,uuid),private.manage_job_management(uuid,uuid,text,jsonb),private.get_job_management_signals(uuid,uuid[]),private.finish_job_visit(uuid,uuid,uuid),public.get_job_management(uuid,uuid),public.manage_job_management(uuid,uuid,text,jsonb),public.get_job_management_signals(uuid,uuid[]),public.finish_job_visit(uuid,uuid,uuid) to authenticated;

create or replace function private.manage_job_workspace(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; t private.job_tasks%rowtype; changed integer; tid uuid; v integer; entry private.job_time_entries%rowtype; event_text text;
begin
 if not private.job_workspace_access(p_business) or not private.can_write_business(p_business) then raise exception 'Job editing access required.' using errcode='42501';end if;
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if p_action='add_task' then
   if j.status in('completed','canceled') then raise exception 'Reopen the job before adding work.' using errcode='23514';end if;
   tid:=(p_payload->>'id')::uuid;
   select * into t from private.job_tasks where id=tid;
   if found then
     if t.business_id<>p_business or t.job_id<>p_job or t.title is distinct from btrim(p_payload->>'title') or t.due_on is distinct from nullif(p_payload->>'due_on','')::date or t.worker_id is distinct from nullif(p_payload->>'worker_id','')::uuid or t.priority is distinct from coalesce(p_payload->>'priority','normal') then raise exception 'Request already contains different work.' using errcode='23505';end if;
     return public.get_job_workspace(p_business,p_job);
   end if;
   if (select count(*) from private.job_tasks where business_id=p_business and job_id=p_job)>=100 then raise exception 'A job can contain up to 100 checklist items.' using errcode='23514';end if;
   if nullif(p_payload->>'worker_id','') is not null and not exists(select 1 from private.worker_profiles where business_id=p_business and id=(p_payload->>'worker_id')::uuid and active) then raise exception 'Choose an active worker from this business.' using errcode='23514';end if;
   insert into private.job_tasks(id,business_id,job_id,title,due_on,worker_id,priority) values(tid,p_business,p_job,btrim(p_payload->>'title'),nullif(p_payload->>'due_on','')::date,nullif(p_payload->>'worker_id','')::uuid,coalesce(p_payload->>'priority','normal'));
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
