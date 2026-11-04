-- Recheck reminder snapshots and the selected customer before confirmation.
create or replace function private.fin_execute_review(b uuid,t uuid,r uuid,v integer,approved boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare review private.fin_reviews%rowtype;x private.fin_threads%rowtype;s jsonb;f jsonb;op text;target jsonb;customer jsonb;created jsonb;results jsonb:='[]';rid uuid;resource text;workers uuid[];k text;
begin
 if not private.fin_access(b,'profile',true) or approved is distinct from true then raise exception 'Review and confirm these changes first.' using errcode='42501';end if;
 select * into x from private.fin_threads where id=t and business_id=b and user_id=auth.uid() for update;
 if not found then raise exception 'Conversation unavailable.' using errcode='42501';end if;
 select * into review from private.fin_reviews where id=r and thread_id=t and business_id=b and user_id=auth.uid() and version=v for update;
 if not found then raise exception 'Review unavailable.' using errcode='42501';end if;
 if x.scope is distinct from private.fin_scope(b) then raise exception 'Permissions changed. Start a fresh review.' using errcode='42501';end if;
 if review.status='executed' then return review.result;end if;
 if review.status<>'pending' or review.version<>x.revision or review.expires_at<now() then raise exception 'This review expired or changed. Ask Fin to refresh it.' using errcode='40001';end if;
 for s in select value from jsonb_array_elements(review.steps) loop
  op:=s->>'operation';f:=s->'fields';rid:=(s->>'request_id')::uuid;target:=null;customer:=null;created:=null;
  resource:=case when op in ('create_invoice','update_invoice','void_invoice','record_payment','schedule_invoice') then 'invoices' when op in ('create_estimate','update_estimate','convert_estimate') then 'estimates' when op='create_change_order' then 'change_orders' when op in ('create_job','update_job','schedule_job','cancel_job') then 'jobs' when op in ('create_reminder','complete_reminder') then 'reminders' when op='save_business_knowledge' then 'knowledge' else 'customers' end;
  if not private.fin_access(b,resource,true) then raise exception 'Your permission changed. No changes were saved.' using errcode='42501';end if;
  if op in ('update_invoice','void_invoice','record_payment','schedule_invoice') then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices']);
  elsif op in ('update_estimate','convert_estimate') then target:=private.fin_resolve_ref(b,s->>'target',results,array['estimates']);
  elsif op in ('update_customer','archive_customer') then target:=private.fin_resolve_ref(b,s->>'target',results,array['customers']);
  elsif op in ('update_job','schedule_job','cancel_job') then target:=private.fin_resolve_ref(b,s->>'target',results,array['jobs']);
  elsif op='complete_reminder' then target:=private.fin_resolve_ref(b,s->>'target',results,array['reminders']);
  elsif op='create_change_order' then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices','estimates']);
  elsif op='review_delivery' then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices','estimates','change_orders']);end if;
  if target is not null and s->>'target' not like '$step:%' then
   -- An earlier step may intentionally change this record inside this transaction.
   if not exists(select 1 from jsonb_array_elements(results) z where z->>'id'=target->>'id') and ((target ? 'updated_at' and (target->>'updated_at')::timestamptz is distinct from (s->>'expected')::timestamptz) or (not(target ? 'updated_at') and not(target @> (s->'record')))) then raise exception 'A reviewed record changed. No changes were saved. Refresh the plan.' using errcode='40001';end if;
  end if;
  if s->>'customer' is not null then customer:=private.fin_resolve_ref(b,s->>'customer',results,array['customers']);if (customer->>'archived')::boolean then raise exception 'Customer is archived.' using errcode='23514';end if;
   if s->>'customer' not like '$step:%' and (customer->>'updated_at')::timestamptz is distinct from (s->'customer_record'->>'updated_at')::timestamptz then raise exception 'The selected customer changed. Refresh this review.' using errcode='40001';end if;
  end if;
  case op
  when 'create_customer' then
   if nullif(btrim(concat_ws('',f->>'first_name',f->>'last_name',f->>'company')),'') is null then raise exception 'Customer name is required.';end if;
   if nullif(f->>'email','') is not null and f->>'email' !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Invalid email.';end if;
   if nullif(f->>'address_line1','') is not null then created:=public.create_customer_with_address(b,rid,f||jsonb_build_object('address',f));
   else insert into public.customers(id,business_id,first_name,last_name,company,email,phone,notes) values(rid,b,nullif(f->>'first_name',''),nullif(f->>'last_name',''),nullif(f->>'company',''),nullif(f->>'email',''),nullif(f->>'phone',''),nullif(f->>'notes','')) returning to_jsonb(customers) into created;end if;
  when 'create_invoice','create_estimate' then
   if customer is null then raise exception 'Select a customer.';end if;
   created:=public.create_document(b,case when op='create_invoice' then 'invoice' else 'estimate' end,rid,f||jsonb_build_object('customer_id',customer->>'id'));
  when 'update_invoice','update_estimate' then
   created:=public.update_draft_document(b,case when op='update_invoice' then 'invoice' else 'estimate' end,(target->>'id')::uuid,(target->>'updated_at')::timestamptz,target||f);
  when 'create_job' then
   if customer is null then raise exception 'Select a customer.';end if;
   created:=public.create_job_atomic(b,rid,f||jsonb_build_object('customer_id',customer->>'id'));
  when 'update_customer' then
   f:=target||f;if nullif(btrim(concat_ws('',f->>'first_name',f->>'last_name',f->>'company')),'') is null then raise exception 'Customer name is required.';end if;
   if nullif(f->>'email','') is not null and f->>'email' !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Invalid email.';end if;
   update public.customers set first_name=nullif(f->>'first_name',''),last_name=nullif(f->>'last_name',''),company=nullif(f->>'company',''),email=nullif(f->>'email',''),phone=nullif(f->>'phone',''),notes=nullif(f->>'notes','') where id=(target->>'id')::uuid and business_id=b returning to_jsonb(customers) into created;
  when 'update_job' then
   f:=target||f;update public.jobs set title=f->>'title',description=f->>'description' where id=(target->>'id')::uuid and business_id=b returning to_jsonb(jobs) into created;
  when 'schedule_job' then
   select array_agg(value::uuid) into workers from jsonb_array_elements_text(coalesce(target->'assigned_user_ids','[]'));
   workers:=coalesce(workers,array[auth.uid()]);perform public.dispatch_job((target->>'id')::uuid,workers,(f->>'starts_at')::timestamptz,(f->>'ends_at')::timestamptz);created:=target;resource:='jobs';
  when 'schedule_invoice' then
   created:=public.book_invoice_job((target->>'id')::uuid,rid,jsonb_build_object('title',f->>'title','workers',jsonb_build_array(auth.uid()),'starts_at',f->>'starts_at','ends_at',f->>'ends_at','property_id',null));created:=jsonb_build_object('id',created->>'job_id');resource:='jobs';
  when 'convert_estimate' then
   if target->>'status' not in ('accepted','converted') then raise exception 'The estimate must be approved before conversion.' using errcode='23514';end if;
   created:=jsonb_build_object('id',public.convert_estimate_to_invoice((target->>'id')::uuid,nullif(f->>'due_date','')::date));resource:='invoices';
  when 'create_change_order' then
   created:=public.create_document_change_order(case when target->>'_resource'='estimates' then 'estimate' else 'invoice' end,(target->>'id')::uuid,rid,f);
  when 'record_payment' then
   if f->>'payment_method' not in ('cash','check','card','ach','other') or (f->>'amount')::numeric<=0 then raise exception 'Invalid payment.';end if;
   perform public.record_manual_payment(b,(target->>'id')::uuid,rid,(f->>'amount')::numeric,f->>'payment_method',coalesce(f->>'notes',''));created:=target;
  when 'create_reminder' then
   if nullif(btrim(f->>'description'),'') is null or nullif(f->>'starts_at','') is null then raise exception 'Reminder and due date are required.';end if;
   insert into public.reminders(id,business_id,customer_id,kind,note,due_at,status) values(rid,b,(customer->>'id')::uuid,'manual',f->>'description',(f->>'starts_at')::timestamptz,'pending') returning to_jsonb(reminders) into created;
  when 'complete_reminder' then update public.reminders set status='completed',completed_at=now() where id=(target->>'id')::uuid and business_id=b returning to_jsonb(reminders) into created;
  when 'archive_customer' then update public.customers set archived=true where id=(target->>'id')::uuid and business_id=b returning to_jsonb(customers) into created;
  when 'void_invoice' then
   if (target->>'amount_paid')::numeric>0 then raise exception 'This invoice has payments. Review its payment history before voiding.' using errcode='23514';end if;
   update public.invoices set status='void' where id=(target->>'id')::uuid and business_id=b returning to_jsonb(invoices) into created;
  when 'cancel_job' then perform public.set_job_status_atomic((target->>'id')::uuid,'canceled');created:=target;
  when 'save_business_knowledge' then
   k:=f->>'knowledge_field';if k not in ('business_description','services_offered','service_area','team_roles') or length(btrim(f->>'knowledge_value')) not between 1 and 4000 then raise exception 'Invalid business knowledge.';end if;
   perform 1 from public.businesses where id=b for update;
   if (select to_jsonb(businesses)->k from public.businesses where id=b) is distinct from s->'previous_knowledge' then raise exception 'Business knowledge changed. Refresh this review.' using errcode='40001';end if;
   execute format('update public.businesses set %I=$1 where id=$2',k) using f->>'knowledge_value',b;created:=jsonb_build_object('id',b);resource:='profile';
  when 'review_delivery' then
   if f->>'channel' not in ('email','sms') then raise exception 'Choose a delivery channel.';end if;
   created:=target;resource:=target->>'_resource';
  else raise exception 'Unsupported operation.' using errcode='22023';end case;
  results:=results||jsonb_build_array(jsonb_build_object('operation',op,'resource',resource,'id',created->>'id','label',s->>'label','status',case when op='review_delivery' then 'awaiting_send_review' else 'completed' end,'channel',f->>'channel'));
 end loop;
 update private.fin_reviews set status='executed',executed_at=now(),result=jsonb_build_object('steps',results,'status','completed') where id=r;
 update private.fin_threads set response=(response-'plan')||jsonb_build_object('answer','The reviewed changes were saved to this account. Customer delivery, if requested, still requires the Send action.','execution',jsonb_build_object('status','completed','steps',results)),history=history||jsonb_build_array(jsonb_build_object('execution_result',results)),updated_at=now() where id=t;
 return jsonb_build_object('steps',results,'status','completed');
end $$;
