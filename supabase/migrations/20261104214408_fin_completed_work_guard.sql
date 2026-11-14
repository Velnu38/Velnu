-- Reject an edit that the existing invoice work-tracking trigger would otherwise undo silently.
create or replace function private.fin_apply_account_change(b uuid,op text,target jsonb,f jsonb,rid uuid,customer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=f->>'resource';vals jsonb:=f->'values';cfg jsonb:=private.fin_account_catalog()->'resources'->r;combined jsonb;created jsonb;tab text;pk text:='id';scope_col text:='business_id';cols text;worker uuid;other jsonb;item jsonb;n integer:=0;removing boolean:=op='remove_account_record';creating boolean:=op='create_account_record';completion jsonb;
begin
 if not private.fin_access(b,r,true) then raise exception 'Account permissions changed' using errcode='42501';end if;
 perform private.fin_validate_account_values(b,r,vals,creating);
 if removing then
  if not coalesce((cfg->>'remove')::boolean,false) or vals<>'{}'::jsonb then raise exception 'This record cannot be removed here';end if;
  case r
  when 'bookkeeping_entries' then delete from public.bookkeeping_entries where business_id=b and id=(target->>'id')::uuid;
  when 'worker_time_off' then perform public.manage_worker_time_off(b,(target->>'user_id')::uuid,(target->>'starts_at')::timestamptz,(target->>'ends_at')::timestamptz,target->>'note',(target->>'id')::uuid);
  when 'team_members' then perform public.manage_team_member(b,(target->>'id')::uuid,'remove',null,null);
  when 'team_invitations' then perform public.manage_team_member(b,(target->>'id')::uuid,'revoke',null,null);
  else raise exception 'Unsupported removal';end case;
  return jsonb_build_object('id',target->>'id');
 end if;
 if vals='{}'::jsonb then raise exception 'Specify a field to change';end if;
 combined:=coalesce(target,'{}')||vals;
 if r='invoices' and vals->>'work_completed'='false' then perform 1 from public.jobs where id=(target->>'job_id')::uuid and business_id=b for share;end if;
 if r='invoices' and vals->>'work_completed'='false' and exists(select 1 from public.jobs where id=(target->>'job_id')::uuid and business_id=b and status='completed') then raise exception 'This invoice belongs to a completed job. Change the job status first; completed work cannot be cleared here.' using errcode='22023';end if;
 if coalesce((cfg->>'draft_only')::boolean,false) and target->>'status'<>'draft' then raise exception 'Only drafts can be edited';end if;
 if cfg ? 'draft_fields' and target->>'status'<>'draft' and exists(select 1 from jsonb_object_keys(vals)x where cfg->'draft_fields' ? x) then raise exception 'Issued financial history cannot be overwritten; create a change order';end if;
 if r in ('customers','business_profile') and nullif(btrim(case when r='customers' then concat_ws('',combined->>'first_name',combined->>'last_name',combined->>'company') else combined->>'name' end),'') is null then raise exception 'A name is required';end if;
 if r='properties' and nullif(btrim(combined->>'address_line1'),'') is null then raise exception 'A street address is required';end if;
 if r in ('jobs','appointments','change_orders') and nullif(btrim(combined->>'title'),'') is null then raise exception 'A title is required';end if;
 if r='reminders' and (nullif(btrim(combined->>'note'),'') is null or nullif(combined->>'due_at','') is null) then raise exception 'A reminder and due time are required';end if;
 if vals ? 'property_id' and vals->>'property_id' is not null then
  other:=private.fin_resolve_ref(b,'properties:'||(vals->>'property_id'),'[]',array['properties']);
  if other->>'customer_id' is distinct from target->>'customer_id' then raise exception 'This service address belongs to a different customer';end if;
 end if;
 if r='team_members' then
  perform public.manage_team_member(b,(target->>'id')::uuid,'update',combined->>'role',array(select jsonb_array_elements_text(combined->'access_modules')));
  return jsonb_build_object('id',target->>'id');
 end if;
 if r='scheduling_preferences' then perform public.save_scheduling_preferences(b,combined);return jsonb_build_object('id',b);end if;
 if r='worker_time_off' then
  worker:=(combined->>'user_id')::uuid;perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));perform private.validate_scheduling_workers(b,array[worker]);
  if (combined->>'ends_at')::timestamptz<=(combined->>'starts_at')::timestamptz or (combined->>'ends_at')::timestamptz-(combined->>'starts_at')::timestamptz>interval '90 days' then raise exception 'Check the blocked time';end if;
  if creating then insert into private.worker_time_off(id,business_id,user_id,starts_at,ends_at,note) values(rid,b,worker,(combined->>'starts_at')::timestamptz,(combined->>'ends_at')::timestamptz,coalesce(combined->>'note',''));
  else update private.worker_time_off set user_id=worker,starts_at=(combined->>'starts_at')::timestamptz,ends_at=(combined->>'ends_at')::timestamptz,note=coalesce(combined->>'note','') where id=(target->>'id')::uuid and business_id=b;end if;
  return jsonb_build_object('id',case when creating then rid::text else target->>'id' end);
 end if;
 if r='appointments' then
  if target->>'job_id' is not null then raise exception 'Change this linked work through Jobs to preserve crew and document links';end if;
  if (combined->>'ends_at')::timestamptz<=(combined->>'starts_at')::timestamptz then raise exception 'End time must be after start time';end if;
  if creating then vals:=vals||jsonb_build_object('assigned_user_id',coalesce(vals->>'assigned_user_id',auth.uid()::text),'customer_id',customer->>'id','status','scheduled');end if;
 end if;
 if r='bookkeeping_entries' then
  if nullif(btrim(combined->>'description'),'') is null or nullif(btrim(combined->>'category'),'') is null or combined->>'entry_date' is null or combined->>'amount' is null or combined->>'direction' not in ('income','expense') then raise exception 'Complete the transaction fields';end if;
  if num_nonnulls(combined->>'job_id',combined->>'estimate_id',combined->>'invoice_id')>1 or num_nonnulls(combined->>'job_id',combined->>'estimate_id',combined->>'invoice_id')>0 and combined->>'direction'<>'expense' then raise exception 'Link one work record to an expense only';end if;
  if creating then vals:=vals||jsonb_build_object('currency','USD','created_by',auth.uid());end if;
 end if;
 if r='properties' and creating then if customer is null or coalesce((customer->>'archived')::boolean,false) then raise exception 'Choose an active customer';end if;vals:=vals||jsonb_build_object('customer_id',customer->>'id');end if;
 if r='jobs' and vals ? 'status' then
  if vals->>'status'='completed' then completion:=public.complete_job_workflow((target->>'id')::uuid,auth.uid(),false);
  else perform public.set_job_status_atomic((target->>'id')::uuid,vals->>'status');end if;
  vals:=vals-'status';
 end if;
 if r='reminders' and vals ? 'status' then vals:=vals||jsonb_build_object('completed_at',case when vals->>'status'='completed' then now() else null end);end if;
 tab:=case r when 'business_profile' then 'businesses' when 'document_settings' then 'business_settings' else r end;
 if r='business_profile' then scope_col:='id';end if;
 if r='document_settings' then
  insert into public.business_settings(business_id) values(b) on conflict do nothing;pk:='business_id';
 end if;
 if r not in ('customers','properties','business_profile','document_settings','invoices','estimates','change_orders','jobs','appointments','reminders','bookkeeping_entries') then raise exception 'This action requires its secure account control';end if;
 if vals ? 'items' then
  if r<>'change_orders' then raise exception 'Use the document editor for these items';end if;
  delete from public.change_order_items where change_order_id=(target->>'id')::uuid and business_id=b;
  for item in select value from jsonb_array_elements(vals->'items') loop
   insert into public.change_order_items(change_order_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values((target->>'id')::uuid,b,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'tax_rate')::numeric,n);n:=n+1;
  end loop;vals:=vals-'items';
 end if;
 if creating then
  vals:=vals||jsonb_build_object('id',rid,'business_id',b);
  select string_agg(format('%I',key),',') into cols from jsonb_object_keys(vals)key;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',tab,cols,cols,tab,tab) into created using vals;
 elsif vals<>'{}'::jsonb then
  select string_agg(format('%I',key),',') into cols from jsonb_object_keys(vals)key;
  execute format('update public.%I a set (%s)=(select %s from jsonb_populate_record(null::public.%I,$3)) where %I=$1 and %I=$2 returning to_jsonb(a)',tab,cols,cols,tab,pk,scope_col) into created using (target->>'id')::uuid,b,vals;
 else created:=target;end if;
 if created is null then raise exception 'The record is no longer available' using errcode='40001';end if;
 return jsonb_build_object('id',coalesce(created->>'id',b::text),'completion',completion);
end $$;
