-- Fin reads through the caller's RLS and saves immutable, expiring review plans.
create function private.fin_access(b uuid, resource text, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.business_members m where m.business_id=b and m.user_id=auth.uid()
 and m.role in ('owner','admin','office') and (not writing or private.can_write_business(b))
 and case when resource in ('invoices','estimates','change_orders') then private.member_module_access(b,auth.uid(),'billing')
 when resource='jobs' then private.member_module_access(b,auth.uid(),'jobs')
 when resource='reminders' then private.member_module_access(b,auth.uid(),'calendar')
 when resource='knowledge' then m.role='owner' and exists(select 1 from public.businesses x where x.id=b and x.created_by_user_id=auth.uid())
 else resource in ('customers','properties','profile') end)
$$;
create function public.fin_lookup_records(p_business uuid,p_query jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r text:=p_query->>'resource'; projection text; search_expr text; date_col text; sort_col text; predicate text; q text; result jsonb; rid uuid; cid uuid; off integer; total_expr text;
begin
 if not private.fin_access(p_business,r) then raise exception 'This account or module is not available to you.' using errcode='42501';end if;
 rid:=nullif(p_query->>'id','')::uuid;cid:=nullif(p_query->>'customer_id','')::uuid;
 if cid is not null and not exists(select 1 from public.customers where id=cid and business_id=p_business) then raise exception 'Customer unavailable.' using errcode='42501';end if;
 off:=coalesce((p_query->>'offset')::integer,0);if off<0 or off>1000 then raise exception 'Narrow this search.' using errcode='22023';end if;
 q:=nullif(left(btrim(p_query->>'query'),160),'');if q is not null then q:='%'||replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';end if;
 case r
 when 'customers' then projection:='id,first_name,last_name,company,email,phone,archived,updated_at,created_at';search_expr:='concat_ws('' '',first_name,last_name,company)';date_col:='created_at';
 when 'invoices' then projection:='id,invoice_number,customer_id,job_id,estimate_id,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,notes,customer_message,updated_at,created_at';search_expr:='invoice_number';date_col:='issue_date';
 when 'estimates' then projection:='id,estimate_number,customer_id,job_id,property_id,status,issue_date,expires_on,total,notes,customer_message,updated_at,created_at';search_expr:='estimate_number';date_col:='issue_date';
 when 'jobs' then projection:='id,title,description,customer_id,property_id,status,scheduled_start,scheduled_end,assigned_user_ids,updated_at,created_at';search_expr:='concat_ws('' '',title,description)';date_col:='scheduled_start';
 when 'reminders' then projection:='id,note,customer_id,job_id,invoice_id,estimate_id,due_at,status,created_at,completed_at';search_expr:='note';date_col:='due_at';
 when 'change_orders' then projection:='id,title,change_order_number,customer_id,job_id,estimate_id,source_invoice_id,status,total,updated_at,created_at';search_expr:='concat_ws('' '',title,change_order_number)';date_col:='created_at';
 when 'properties' then projection:='id,customer_id,label,address_line1,address_line2,city,state,postal_code,updated_at,created_at';search_expr:='concat_ws('' '',label,address_line1,city)';date_col:='created_at';
 else raise exception 'Unsupported search.' using errcode='22023';end case;
 sort_col:=case when p_query->>'order'='due' and r='invoices' then 'due_date' else date_col end;
 predicate:='business_id=$1 and ($2::uuid is null or id=$2) and ($3::text is null or '||search_expr||' ilike $3 escape ''\'')';
 if r<>'customers' then predicate:=predicate||' and ($4::uuid is null or customer_id=$4)';end if;
 if r not in ('customers','properties') then
 if p_query->>'status'='unpaid' and r='invoices' then predicate:=predicate||' and balance_due>0 and status not in (''draft'',''void'')';
 else predicate:=predicate||' and ($5::text is null or status=$5)';end if;
 elsif r='customers' and rid is null then predicate:=predicate||' and not archived';end if;
 predicate:=predicate||format(' and ($6::timestamptz is null or %I >= $6) and ($7::timestamptz is null or %I < $7)',date_col,date_col);
 total_expr:=case when r in ('invoices','estimates','change_orders') then '(select coalesce(sum(total),0)::text from matching)' else 'null::text' end;
 execute format('with matching as (select %s from public.%I where %s), page as(select * from matching order by %I %s nulls last,id limit 25 offset $8) select jsonb_build_object(''resource'',$9,''rows'',coalesce((select jsonb_agg(to_jsonb(page)) from page),''[]''::jsonb),''matching_count'',(select count(*) from matching),''offset'',$8,''complete'',(select count(*) from matching)<=$8+25,''total'',%s,''balance_due'',%s)',projection,r,predicate,sort_col,case when p_query->>'order'='newest' then 'desc' else 'asc' end,total_expr,case when r='invoices' then '(select coalesce(sum(balance_due) filter(where status not in (''draft'',''void'')),0)::text from matching)' else 'null::text' end)
 into result using p_business,rid,q,cid,nullif(p_query->>'status',''),nullif(p_query->>'from','')::timestamptz,nullif(p_query->>'to','')::timestamptz,off,r;
 if rid is not null and jsonb_array_length(result->'rows')=1 and r in ('invoices','estimates') then
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''description'',description,''quantity'',quantity::text,''unit_price'',unit_price::text,''tax_rate'',tax_rate::text) order by sort_order,id),''[]''::jsonb) from public.%I where business_id=$1 and %I=$2',case when r='invoices' then 'invoice_items' else 'estimate_items' end,case when r='invoices' then 'invoice_id' else 'estimate_id' end) into result using p_business,rid;
  -- Re-read the parent snapshot under the caller's RLS, then attach its complete lines.
  execute format('select jsonb_build_object(''resource'',$3,''rows'',jsonb_build_array(to_jsonb(t)||jsonb_build_object(''items'',$4)),''matching_count'',1,''offset'',0,''complete'',true) from(select %s from public.%I where id=$1 and business_id=$2)t',projection,r) into result using rid,p_business,r,result;
 end if;
 return result;
end $$;
-- A changed authorization scope invalidates cached context, including in-flight replies.
create function private.fin_scope(b uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',m.role,'modules',m.access_modules,'write',private.can_write_business(b)) from public.business_members m where m.business_id=b and m.user_id=auth.uid()
$$;
create table private.fin_threads(id uuid primary key,business_id uuid not null references public.businesses(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,revision integer not null default 0,last_request uuid,request_text text,history jsonb not null default '[]',scope jsonb,response jsonb,updated_at timestamptz not null default now());
create table private.fin_reviews(id uuid primary key,thread_id uuid not null references private.fin_threads(id) on delete cascade,business_id uuid not null references public.businesses(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,version integer not null,steps jsonb not null,status text not null default 'pending' check(status in ('pending','superseded','executed','cancelled')),expires_at timestamptz not null default now()+interval '15 minutes',result jsonb,created_at timestamptz not null default now(),executed_at timestamptz);
alter table private.fin_threads enable row level security;alter table private.fin_reviews enable row level security;
create index fin_reviews_scope on private.fin_reviews(business_id,user_id,thread_id);
revoke all on private.fin_threads,private.fin_reviews from public,anon,authenticated,service_role;
create function private.fin_begin_turn(b uuid,t uuid,r uuid,request text) returns jsonb language plpgsql security definer set search_path='' as $$
declare x private.fin_threads%rowtype;current_scope jsonb;
begin
 if not private.fin_access(b,'profile') or length(btrim(request)) not between 1 and 6000 or t is null or r is null then raise exception 'Account access or request is invalid.' using errcode='42501';end if;
 insert into private.fin_threads(id,business_id,user_id) values(t,b,auth.uid()) on conflict do nothing;
 select * into x from private.fin_threads where id=t and business_id=b and user_id=auth.uid() for update;
 if not found then raise exception 'Conversation unavailable.' using errcode='42501';end if;
 current_scope:=private.fin_scope(b);
 if x.scope is distinct from current_scope then
  update private.fin_reviews set status='superseded' where thread_id=t and status='pending';
  update private.fin_threads set scope=current_scope,history='[]',response=null,last_request=null,request_text=null,revision=revision+1 where id=t returning * into x;
 end if;
 if btrim(request) ~* '^(yes|confirm|go ahead|do it|okay|ok)[.! ]*$' and x.response is not null and exists(select 1 from private.fin_reviews where id=x.last_request and status='pending' and expires_at>now()) then
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',x.response||jsonb_build_object('answer','Review the exact details, then use the confirmation button to save. A chat reply does not authorize changes.'));end if;
 if x.last_request=r then
 if x.request_text<>request then raise exception 'This request identifier contains different text.' using errcode='23505';end if;
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',x.response);end if;
 update private.fin_reviews set status='superseded' where thread_id=t and status='pending';
 update private.fin_threads set revision=revision+1,last_request=r,request_text=request,response=null,updated_at=now() where id=t returning * into x;
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',null);
end $$;
create function private.fin_finish_turn(b uuid,t uuid,r uuid,reply jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x private.fin_threads%rowtype;review private.fin_reviews%rowtype;response_payload jsonb;steps jsonb:=reply->'steps';s jsonb;ref text;resource text;record jsonb;idx integer:=0;prior jsonb;op text;target_kind text;customer_record jsonb;allowed text[];field_name text;computed_total numeric;
begin
 if not private.fin_access(b,'profile') then raise exception 'Account access changed.' using errcode='42501';end if;
 select * into x from private.fin_threads where id=t and business_id=b and user_id=auth.uid() and last_request=r for update;
 if not found then raise exception 'A newer request replaced this conversation. Try again.' using errcode='40001';end if;
 if x.scope is distinct from private.fin_scope(b) then raise exception 'Permissions changed. Start a fresh request.' using errcode='42501';end if;
 if x.response is not null then return x.response;end if;
 if jsonb_typeof(steps) is distinct from 'array' or jsonb_array_length(steps)>8 or pg_column_size(reply)>180000 then raise exception 'Invalid review plan.' using errcode='22023';end if;
 for s in select value from jsonb_array_elements(steps) loop
  op:=s->>'operation';
  if op not in ('create_customer','create_invoice','create_estimate','create_job','create_change_order','update_customer','update_invoice','update_estimate','update_job','schedule_job','schedule_invoice','convert_estimate','record_payment','create_reminder','complete_reminder','archive_customer','void_invoice','cancel_job','save_business_knowledge','review_delivery') then raise exception 'Unsupported action.' using errcode='22023';end if;
  if nullif(s->>'request_id','')::uuid is null or jsonb_typeof(s->'fields') is distinct from 'object' then raise exception 'Invalid action payload.' using errcode='22023';end if;
  allowed:=case op
   when 'create_customer' then array['first_name','last_name','company','email','phone','address_line1','city','state','postal_code','notes']
   when 'update_customer' then array['first_name','last_name','company','email','phone','notes']
   when 'create_invoice' then array['issue_date','due_date','notes','items'] when 'update_invoice' then array['due_date','notes','items']
   when 'create_estimate' then array['issue_date','expires_on','notes','items'] when 'update_estimate' then array['expires_on','notes','items']
   when 'create_job' then array['title','description'] when 'update_job' then array['title','description']
   when 'schedule_job' then array['starts_at','ends_at'] when 'schedule_invoice' then array['title','starts_at','ends_at']
   when 'create_change_order' then array['title','description','items'] when 'convert_estimate' then array['due_date']
   when 'record_payment' then array['amount','payment_method','notes'] when 'create_reminder' then array['description','starts_at']
   when 'save_business_knowledge' then array['knowledge_field','knowledge_value'] when 'review_delivery' then array['channel'] else array[]::text[] end;
  for field_name in select jsonb_object_keys(s->'fields') loop if not(field_name=any(allowed)) or length(s->'fields'->>field_name)>100000 then raise exception 'Unsupported or oversized field.' using errcode='22023';end if;end loop;
  if s->'fields' ? 'items' then
   select coalesce(sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)+round(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)*(i->>'tax_rate')::numeric/100,2)),0) into computed_total from jsonb_array_elements(s->'fields'->'items') i;
   s:=jsonb_set(s,'{total}',to_jsonb(round(computed_total,2)::text));
  end if;
  if op='save_business_knowledge' then select to_jsonb(businesses)->(s->'fields'->>'knowledge_field') into record from public.businesses where id=b;s:=jsonb_set(s,'{previous_knowledge}',coalesce(record,'null'));end if;
  resource:=case when op in ('create_invoice','update_invoice','void_invoice','record_payment','schedule_invoice') then 'invoices' when op in ('create_estimate','update_estimate','convert_estimate') then 'estimates' when op='create_change_order' then 'change_orders' when op in ('create_job','update_job','schedule_job','cancel_job') then 'jobs' when op in ('create_reminder','complete_reminder') then 'reminders' when op='save_business_knowledge' then 'knowledge' else 'customers' end;
  if not private.fin_access(b,resource,true) then raise exception 'You cannot perform this action.' using errcode='42501';end if;
  for ref in select v from jsonb_each_text(jsonb_build_object('target',s->>'target','customer',s->>'customer')) z(k,v) where v is not null loop
   if ref like '$step:%' then
    if substring(ref from 7)::integer<0 or substring(ref from 7)::integer>=idx then raise exception 'Invalid action dependency.' using errcode='22023';end if;
   else
    target_kind:=split_part(ref,':',1);
    if target_kind not in ('customers','invoices','estimates','jobs','reminders','change_orders') then raise exception 'Invalid record reference.' using errcode='22023';end if;
    record:=(public.fin_lookup_records(b,jsonb_build_object('resource',target_kind,'id',split_part(ref,':',2),'order','oldest')))->'rows'->0;
    if record is null then raise exception 'A selected record is unavailable.' using errcode='42501';end if;
    if ref=s->>'target' and (record->>'updated_at' is distinct from s->>'expected') and target_kind<>'reminders' then raise exception 'The record changed. Ask Fin to refresh the review.' using errcode='40001';end if;
    if ref=s->>'target' then s:=jsonb_set(s,'{record}',record);end if;
    if ref=s->>'customer' then s:=jsonb_set(s,'{customer_record}',record);end if;
   end if;
  end loop;
  steps:=jsonb_set(steps,array[idx::text],s);idx:=idx+1;
 end loop;
 response_payload:=reply-'steps';
 if jsonb_array_length(steps)>0 then
 insert into private.fin_reviews(id,thread_id,business_id,user_id,version,steps) values(r,t,b,auth.uid(),x.revision,steps) returning * into review;
 response_payload:=response_payload||jsonb_build_object('plan',jsonb_build_object('id',r,'version',review.version,'steps',steps,'expires_at',review.expires_at,'destructive',exists(select 1 from jsonb_array_elements(steps) e where e->>'operation' in ('archive_customer','void_invoice','cancel_job'))));
 end if;
 update private.fin_threads set response=response_payload,history=(select coalesce(jsonb_agg(v order by n),'[]') from (select v,n from jsonb_array_elements(x.history||jsonb_build_array(jsonb_build_object('request',x.request_text,'answer',reply->>'answer','clarification',reply->>'clarification','steps',(select coalesce(jsonb_agg(e-'record'-'customer_record'-'previous_knowledge'),'[]') from jsonb_array_elements(steps)e),'sources',reply->'source_keys'))) with ordinality a(v,n) order by n desc limit 8) recent),updated_at=now() where id=t;
 while (select pg_column_size(history)>120000 and jsonb_array_length(history)>1 from private.fin_threads where id=t) loop update private.fin_threads set history=history-0 where id=t;end loop;
 return response_payload;
end $$;
-- Resolve only explicit references; all reads are checked again at confirmation.
create function private.fin_resolve_ref(b uuid,ref text,results jsonb,expected_types text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text;rid uuid;entry jsonb;row_data jsonb;
begin
 if ref like '$step:%' then entry:=results->substring(ref from 7)::integer;kind:=entry->>'resource';rid:=nullif(entry->>'id','')::uuid;
 else kind:=split_part(ref,':',1);rid:=nullif(split_part(ref,':',2),'')::uuid;end if;
 if rid is null or kind is null or not(kind=any(expected_types)) or not private.fin_access(b,kind,true) then raise exception 'Invalid account record reference.' using errcode='42501';end if;
 -- Lock the actual record, never a model-supplied database name.
 if kind not in ('customers','invoices','estimates','jobs','reminders','change_orders') then raise exception 'Invalid record type.';end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 and business_id=$2 for update',kind) into row_data using rid,b;
 if row_data is null then raise exception 'Record unavailable in this account.' using errcode='42501';end if;
 return row_data||jsonb_build_object('_resource',kind);
end $$;
create function private.fin_execute_review(b uuid,t uuid,r uuid,v integer,approved boolean) returns jsonb language plpgsql security definer set search_path='' as $$
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
   if not exists(select 1 from jsonb_array_elements(results) z where z->>'id'=target->>'id') and ((target ? 'updated_at' and (target->>'updated_at')::timestamptz is distinct from (s->>'expected')::timestamptz) or (not(target ? 'updated_at') and target->>'status' is distinct from s->'record'->>'status')) then raise exception 'A reviewed record changed. No changes were saved. Refresh the plan.' using errcode='40001';end if;
  end if;
  if s->>'customer' is not null then customer:=private.fin_resolve_ref(b,s->>'customer',results,array['customers']);if (customer->>'archived')::boolean then raise exception 'Customer is archived.' using errcode='23514';end if;end if;
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
create function private.fin_cancel_review(b uuid,t uuid,r uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.fin_access(b,'profile') then raise exception 'Access denied.' using errcode='42501';end if;
 update private.fin_reviews set status='cancelled' where id=r and thread_id=t and business_id=b and user_id=auth.uid() and status='pending';
end $$;
create function public.fin_begin_turn(p_business uuid,p_thread uuid,p_request uuid,p_text text) returns jsonb language sql security invoker set search_path='' as $$select private.fin_begin_turn(p_business,p_thread,p_request,p_text)$$;
create function public.fin_finish_turn(p_business uuid,p_thread uuid,p_request uuid,p_reply jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.fin_finish_turn(p_business,p_thread,p_request,p_reply)$$;
create function public.fin_execute_review(p_business uuid,p_thread uuid,p_review uuid,p_version integer,p_approved boolean) returns jsonb language sql security invoker set search_path='' as $$select private.fin_execute_review(p_business,p_thread,p_review,p_version,p_approved)$$;
create function public.fin_cancel_review(p_business uuid,p_thread uuid,p_review uuid) returns void language sql security invoker set search_path='' as $$select private.fin_cancel_review(p_business,p_thread,p_review)$$;
revoke all on function private.fin_scope(uuid),private.fin_access(uuid,text,boolean),public.fin_lookup_records(uuid,jsonb),private.fin_begin_turn(uuid,uuid,uuid,text),private.fin_finish_turn(uuid,uuid,uuid,jsonb),private.fin_resolve_ref(uuid,text,jsonb,text[]),private.fin_execute_review(uuid,uuid,uuid,integer,boolean),private.fin_cancel_review(uuid,uuid,uuid),public.fin_begin_turn(uuid,uuid,uuid,text),public.fin_finish_turn(uuid,uuid,uuid,jsonb),public.fin_execute_review(uuid,uuid,uuid,integer,boolean),public.fin_cancel_review(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function private.fin_access(uuid,text,boolean),public.fin_lookup_records(uuid,jsonb),private.fin_begin_turn(uuid,uuid,uuid,text),private.fin_finish_turn(uuid,uuid,uuid,jsonb),private.fin_execute_review(uuid,uuid,uuid,integer,boolean),private.fin_cancel_review(uuid,uuid,uuid),public.fin_begin_turn(uuid,uuid,uuid,text),public.fin_finish_turn(uuid,uuid,uuid,jsonb),public.fin_execute_review(uuid,uuid,uuid,integer,boolean),public.fin_cancel_review(uuid,uuid,uuid) to authenticated;
