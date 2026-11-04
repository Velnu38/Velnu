create function private.fin_account_catalog() returns jsonb language sql immutable set search_path='' as $catalog$ select $json${"resources":{"customers":{"label":"Customers","view":"customers","read_fields":["id","first_name","last_name","company","email","phone","preferred_contact","notes","archived","created_at","updated_at"],"fields":{"first_name":{"type":"text","max_length":160},"last_name":{"type":"text","max_length":160},"company":{"type":"text","max_length":160},"email":{"type":"email","max_length":320},"phone":{"type":"text","max_length":32},"preferred_contact":{"type":"enum","options":["email","sms","phone","none"]},"notes":{"type":"text","max_length":4000},"archived":{"type":"boolean"}},"module":null},"properties":{"label":"Customer addresses & service locations","view":"customers","read_fields":["id","customer_id","label","address_line1","address_line2","city","state","postal_code","access_notes","created_at","updated_at"],"fields":{"label":{"type":"text","max_length":240},"address_line1":{"type":"text","max_length":240},"address_line2":{"type":"text","max_length":240},"city":{"type":"text","max_length":240},"state":{"type":"text","max_length":240},"postal_code":{"type":"text","max_length":240},"access_notes":{"type":"text","max_length":4000}},"create":true,"required":["address_line1"],"module":null},"business_profile":{"label":"Company profile","view":"company","read_fields":["id","name","legal_name","email","phone","website","address_line1","address_line2","city","state","postal_code","country","timezone","currency","invoice_prefix","next_invoice_number","estimate_prefix","next_estimate_number","change_order_prefix","next_change_order_number","business_description","services_offered","service_area","team_size","team_roles","document_accent","document_footer","updated_at"],"fields":{"name":{"type":"text","max_length":240},"legal_name":{"type":"text","max_length":240},"phone":{"type":"text","max_length":240},"address_line1":{"type":"text","max_length":240},"address_line2":{"type":"text","max_length":240},"city":{"type":"text","max_length":240},"state":{"type":"text","max_length":240},"postal_code":{"type":"text","max_length":240},"email":{"type":"email","max_length":320},"website":{"type":"url"},"timezone":{"type":"timezone"},"business_description":{"type":"text","max_length":4000},"services_offered":{"type":"text","max_length":4000},"service_area":{"type":"text","max_length":4000},"team_roles":{"type":"text","max_length":4000},"document_footer":{"type":"text","max_length":4000},"team_size":{"type":"integer","min":1,"max":100000},"document_accent":{"type":"color"}},"owner_write":true,"module":null},"document_settings":{"label":"Invoice, estimate & payment settings","view":"documents","read_fields":["id","default_tax_rate","pricing_adjustment_percent","payment_links","payment_instructions","updated_at"],"fields":{"default_tax_rate":{"type":"decimal","min":0,"max":100},"pricing_adjustment_percent":{"type":"decimal","min":0,"max":100},"payment_instructions":{"type":"text","max_length":4000},"payment_links":{"type":"payment_links"}},"owner":true},"invoices":{"label":"Invoices","view":"invoices","read_fields":["id","customer_id","job_id","estimate_id","invoice_number","issue_date","due_date","amount_paid","balance_due","work_completed","work_completed_at","sent_at","paid_at","status","subtotal","tax_amount","total","notes","customer_message","payment_links","payment_instructions","issuer_snapshot","created_at","updated_at"],"fields":{"notes":{"type":"text","max_length":4000},"customer_message":{"type":"text","max_length":4000},"issue_date":{"type":"date"},"due_date":{"type":"date"},"payment_instructions":{"type":"text","max_length":4000},"payment_links":{"type":"payment_links"},"work_completed":{"type":"boolean"}},"module":"billing","draft_fields":["notes","customer_message","issue_date","due_date","payment_instructions","payment_links"]},"estimates":{"label":"Estimates","view":"estimates","read_fields":["id","customer_id","job_id","property_id","estimate_number","issue_date","expires_on","status","subtotal","tax_amount","total","notes","customer_message","payment_links","payment_instructions","issuer_snapshot","created_at","updated_at"],"fields":{"notes":{"type":"text","max_length":4000},"customer_message":{"type":"text","max_length":4000},"issue_date":{"type":"date"},"expires_on":{"type":"date"},"payment_instructions":{"type":"text","max_length":4000},"payment_links":{"type":"payment_links"},"property_id":{"type":"reference","resource":"properties"}},"module":"billing","draft_fields":["notes","customer_message","issue_date","expires_on","payment_instructions","payment_links","property_id"]},"change_orders":{"label":"Change orders","view":"change_orders","read_fields":["id","customer_id","job_id","estimate_id","source_invoice_id","change_order_number","status","title","description","reason","schedule_impact_days","schedule_note","issue_date","subtotal","tax_amount","total","notes","customer_message","created_at","updated_at"],"fields":{"title":{"type":"text","max_length":200},"description":{"type":"text","max_length":4000},"reason":{"type":"text","max_length":4000},"schedule_impact_days":{"type":"integer","min":0,"max":365},"schedule_note":{"type":"text","max_length":4000},"notes":{"type":"text","max_length":4000},"customer_message":{"type":"text","max_length":4000},"issue_date":{"type":"date"},"items":{"type":"line_items"}},"module":"billing","draft_only":true},"jobs":{"label":"Jobs","view":"work","read_fields":["id","customer_id","property_id","title","description","status","scheduled_start","scheduled_end","completed_at","internal_notes","assigned_user_ids","source_estimate_id","created_at","updated_at"],"fields":{"title":{"type":"text","max_length":200},"description":{"type":"text","max_length":4000},"internal_notes":{"type":"text","max_length":4000},"property_id":{"type":"reference","resource":"properties"},"status":{"type":"enum","options":["lead","scheduled","in_progress","completed","canceled"]}},"module":"jobs"},"appointments":{"label":"Calendar entries","view":"schedule","read_fields":["id","customer_id","job_id","assigned_user_id","title","starts_at","ends_at","status","notes","created_at","updated_at"],"fields":{"title":{"type":"text","max_length":200},"notes":{"type":"text","max_length":2000},"starts_at":{"type":"datetime"},"ends_at":{"type":"datetime"},"assigned_user_id":{"type":"reference","resource":"workers"},"status":{"type":"enum","options":["scheduled","canceled"]}},"create":true,"required":["title","starts_at","ends_at"],"module":"calendar"},"reminders":{"label":"Reminders","view":"reminders","read_fields":["id","note","customer_id","job_id","invoice_id","estimate_id","kind","due_at","status","created_at","completed_at"],"fields":{"note":{"type":"text","max_length":1000},"due_at":{"type":"datetime"},"status":{"type":"enum","options":["pending","completed"]}},"module":"calendar"},"bookkeeping_entries":{"label":"Manual income & expenses","view":"bookkeeping","read_fields":["id","entry_date","direction","amount","currency","category","description","notes","job_id","estimate_id","invoice_id","created_at"],"fields":{"entry_date":{"type":"date"},"direction":{"type":"enum","options":["income","expense"]},"amount":{"type":"decimal","min":0.01,"max":1000000000},"category":{"type":"text","max_length":120},"description":{"type":"text","max_length":4000},"notes":{"type":"text","max_length":4000},"job_id":{"type":"reference","resource":"jobs"},"estimate_id":{"type":"reference","resource":"estimates"},"invoice_id":{"type":"reference","resource":"invoices"}},"create":true,"remove":true,"required":["entry_date","direction","amount","category","description"],"module":"finances"},"payments":{"label":"Received payments","view":"payments","read_fields":["id","invoice_id","amount","method","provider","status","paid_at","notes","created_at"],"fields":{},"module":"billing"},"messages":{"label":"Customer communication history","view":"customers","read_fields":["id","customer_id","invoice_id","estimate_id","change_order_id","direction","channel","recipient","subject","body","status","sent_at","created_at"],"fields":{},"module":"billing"},"quickbooks_transactions":{"label":"Imported QuickBooks transactions","view":"bookkeeping","read_fields":["id","source_type","source_id","direction","txn_date","amount","currency","description","source_updated_at","last_seen_at"],"fields":{},"module":"finances"},"workers":{"label":"Scheduling team","view":"scheduling","read_fields":["id","label","role","is_you"],"fields":{},"module":"jobs","manager":true},"team_members":{"label":"Team & access","view":"team","read_fields":["id","email","role","access_modules","primary_owner"],"fields":{"role":{"type":"enum","options":["office","technician","viewer"]},"access_modules":{"type":"modules"}},"owner":true,"remove":true},"team_invitations":{"label":"Pending team invitations","view":"team","read_fields":["id","email","role","access_modules","expires_at","created_at"],"fields":{},"owner":true,"remove":true},"scheduling_preferences":{"label":"Working hours & booking rules","view":"scheduling","read_fields":["id","work_days","start_minutes","end_minutes","duration_minutes","buffer_minutes","notice_hours","updated_at"],"fields":{"work_days":{"type":"weekdays"},"start_minutes":{"type":"integer","min":0,"max":1439},"end_minutes":{"type":"integer","min":1,"max":1440},"duration_minutes":{"type":"integer","min":15,"max":720},"buffer_minutes":{"type":"integer","min":0,"max":180},"notice_hours":{"type":"integer","min":0,"max":336}},"module":"calendar","manager":true},"worker_time_off":{"label":"Blocked team time","view":"scheduling","read_fields":["id","user_id","starts_at","ends_at","note","created_at"],"fields":{"user_id":{"type":"reference","resource":"workers"},"starts_at":{"type":"datetime"},"ends_at":{"type":"datetime"},"note":{"type":"text","max_length":200}},"create":true,"remove":true,"required":["user_id","starts_at","ends_at"],"module":"calendar","manager":true},"calendar_connections":{"label":"Connected calendars","view":"calendar","read_fields":["id","provider","email","calendar_name","auto_sync","state","last_synced_at","updated_at"],"fields":{},"module":"calendar","handoff":"Connection consent, calendar choice, automatic sync and disconnection use Calendar connections. Only the signed-in user\u2019s connections are visible."},"connected_apps":{"label":"Connected app status","view":"settings","read_fields":["id","quickbooks_connected","quickbooks_environment","quickbooks_last_sync_at","quickbooks_last_sync_count","sms_status","plan","subscription_status"],"fields":{},"owner":true,"handoff":"OAuth, SMS verification, subscription billing and external sync require the matching secure account controls."},"document_approvals":{"label":"Customer approvals","view":"estimates","read_fields":["id","document_type","estimate_id","change_order_id","action","typed_name","amount_at_action","created_at"],"fields":{},"module":"billing"},"record_photos":{"label":"Record photo attachments","view":"work","read_fields":["id","job_id","estimate_id","invoice_id","file_name","byte_size","media_type","created_at"],"fields":{},"module":"jobs","handoff":"Read file metadata; upload, preview and delete through the related record Photos controls. Do not infer image contents."},"service_interests":{"label":"My services","view":"company","read_fields":["id","selected_services","preferred_plan","updated_at"],"fields":{},"owner":true,"handoff":"Open Company profile > Optional Finviant services to change service preferences. A preference does not activate or purchase a subscription."},"support_cases":{"label":"Help & support","view":"support","read_fields":["id","title","description","priority","status","created_at","updated_at"],"fields":{},"handoff":"Open Help & support to submit or reply to a case. Fin reads only cases visible to the signed-in reporter or primary owner.","module":null}},"views":{"dashboard":{"label":"Dashboard","href":"/?view=dashboard","buttons":[],"fields":[]},"customers":{"label":"Customers","href":"/?view=customers","buttons":[],"fields":[]},"invoices":{"label":"Invoices","href":"/?view=invoices","buttons":[],"fields":[]},"estimates":{"label":"Estimates","href":"/?view=estimates","buttons":[],"fields":[]},"change_orders":{"label":"Change orders","href":"/?view=change_orders","buttons":[],"fields":[]},"work":{"label":"Jobs","href":"/?view=work","buttons":[],"fields":[]},"schedule":{"label":"Schedule","href":"/?view=schedule","buttons":[],"fields":[]},"reminders":{"label":"Reminders","href":"/?view=reminders","buttons":[],"fields":[]},"payments":{"label":"Payments","href":"/?view=payments","buttons":[],"fields":[]},"bookkeeping":{"label":"Financial performance & expenses","href":"/?view=bookkeeping","buttons":[],"fields":[]},"settings":{"label":"Settings","href":"/?view=settings","buttons":[],"fields":[]},"company":{"label":"Company profile","href":"/?view=settings&section=company","buttons":["Save company profile","Save service preferences"],"fields":[]},"documents":{"label":"Invoice & estimate setup","href":"/?view=settings&section=documents","buttons":["Save document settings"],"fields":[]},"team":{"label":"Team & access","href":"/?view=settings&section=team","buttons":["Send invitation","Save access","Remove","Cancel invitation","Resend"],"fields":[]},"calendar":{"label":"Calendar connections","href":"/?view=settings&section=calendar","buttons":[],"fields":[]},"scheduling":{"label":"Scheduling & team availability","href":"/?view=settings&section=scheduling","buttons":["Save scheduling preferences","Block time","Remove"],"fields":[]},"sms":{"label":"Text messaging setup","href":"/?view=settings&section=sms","buttons":["Send verification code","Verify mobile number"],"fields":["Owner mobile number","Verification code"]},"subscription":{"label":"Cancel subscription","href":"/?view=settings&section=subscription","buttons":[],"fields":[]},"support":{"label":"Help & support","href":"/?view=settings&section=support","buttons":[],"fields":[]}}}$json$::jsonb $catalog$;
CREATE OR REPLACE FUNCTION private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b private.finviant_ai_attempt_budget%rowtype; usage jsonb; limit_value integer; stored_usage integer;
  period_start date:=date_trunc('month',now() at time zone 'UTC')::date; next_attempt integer;
begin
 if not private.fin_access(p_business_id,'profile') then raise exception 'Assistant access denied' using errcode='42501';end if;
 if auth.uid() is null or not private.is_business_member(p_business_id) then raise exception 'Business access denied' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('command','transcription') then raise exception 'Invalid AI operation' using errcode='22023'; end if;
 usage:=private.get_plan_usage(p_business_id);
 limit_value:=(usage->>case when p_kind='command' then 'ai_limit' else 'voice_limit' end)::integer;
 stored_usage:=coalesce((usage->>case when p_kind='command' then 'ai_used' else 'voice_used' end)::integer,0);
 if usage->>'plan'<>'pro' or coalesce(limit_value,0)<=0 then raise exception 'Activated AI plan required' using errcode='42501'; end if;
 insert into private.finviant_ai_attempt_budget(business_id,period,kind) values(p_business_id,period_start,p_kind) on conflict do nothing;
 select * into b from private.finviant_ai_attempt_budget where business_id=p_business_id and period=period_start and kind=p_kind for update;
 next_attempt:=greatest(b.attempts,stored_usage)+1;
 if next_attempt>limit_value then raise exception 'AI_ATTEMPT_BUDGET_EXHAUSTED' using errcode='P0001'; end if;
 if b.minute_start>now()-interval '1 minute' and b.minute_attempts>=10 then raise exception 'AI_RATE_LIMIT' using errcode='P0001'; end if;
 update private.finviant_ai_attempt_budget set attempts=next_attempt,
 minute_attempts=case when b.minute_start<=now()-interval '1 minute' then 1 else b.minute_attempts+1 end,
 minute_start=case when b.minute_start<=now()-interval '1 minute' then now() else b.minute_start end
 where business_id=p_business_id and period=period_start and kind=p_kind;
 return jsonb_build_object('reserved',true,'remaining',limit_value-next_attempt,'period',period_start);
end;
$function$;

-- Catalog-driven, permission-checked account reads and reviewed field changes.
create or replace function private.fin_access(b uuid,resource text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare m public.business_members%rowtype; c jsonb; primary_owner boolean;
begin
 if auth.uid() is null then return false;end if;
 select * into m from public.business_members where business_id=b and user_id=auth.uid();if not found then return false;end if;
 primary_owner:=m.role='owner' and exists(select 1 from public.businesses where id=b and created_by_user_id=auth.uid());
 if resource='knowledge' then return primary_owner and (not writing or private.can_write_business(b));end if;
 c:=private.fin_account_catalog()->'resources'->case when resource='profile' then 'business_profile' else resource end;
 if c is null then return false;end if;
 if coalesce((c->>'owner')::boolean,false) and not primary_owner then return false;end if;
 if writing and (m.role not in ('owner','admin','office') or not private.can_write_business(b) or coalesce((c->>'owner_write')::boolean,false) and not primary_owner) then return false;end if;
 if c->>'module' is not null and not private.member_module_access(b,auth.uid(),c->>'module') then return false;end if;
 if c->>'module' in ('billing','finances') and m.role not in ('owner','admin','office') then return false;end if;
 if coalesce((c->>'manager')::boolean,false) and not private.can_manage_schedule(b) then return false;end if;
 return true;
end $$;
create function public.fin_account_capabilities(p_business uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare data jsonb:=private.fin_account_catalog(); r record; result jsonb:='{}'; views jsonb:='{}'; v record; allowed boolean;
begin
 if not private.fin_access(p_business,'profile') then raise exception 'Account access required' using errcode='42501';end if;
 for r in select key,value from jsonb_each(data->'resources') loop
  if private.fin_access(p_business,r.key) then result:=result||jsonb_build_object(r.key,r.value||jsonb_build_object('can_write',private.fin_access(p_business,r.key,true) and (r.value->'fields'<>'{}'::jsonb or coalesce((r.value->>'create')::boolean,false) or coalesce((r.value->>'remove')::boolean,false))));end if;
 end loop;
 for v in select key,value from jsonb_each(data->'views') loop
  allowed:=v.key in ('dashboard','settings','support') or exists(select 1 from jsonb_each(result) resource_entry where resource_entry.value->>'view'=v.key);
  if v.key in ('sms','subscription','company','documents','team') then allowed:=private.fin_access(p_business,'document_settings');end if;
  if allowed then views:=views||jsonb_build_object(v.key,v.value);end if;
 end loop;
 return jsonb_build_object('resources',result,'views',views);
end $$;
create function private.fin_special_records(b uuid,r text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;schedule_state jsonb;
begin
 if not private.fin_access(b,r) then raise exception 'Account access required' using errcode='42501';end if;
 case r
 when 'business_profile' then select jsonb_build_array(to_jsonb(x)) into result from (select id,name,legal_name,email,phone,website,address_line1,address_line2,city,state,postal_code,country,timezone,currency,invoice_prefix,next_invoice_number,estimate_prefix,next_estimate_number,change_order_prefix,next_change_order_number,business_description,services_offered,service_area,team_size,team_roles,document_accent,document_footer,updated_at from public.businesses where id=b)x;
 when 'document_settings' then select jsonb_build_array(jsonb_build_object('id',b,'default_tax_rate',coalesce(s.default_tax_rate,0),'pricing_adjustment_percent',coalesce(s.pricing_adjustment_percent,0),'payment_links',coalesce(s.payment_links,'[]'),'payment_instructions',coalesce(s.payment_instructions,''),'updated_at',s.updated_at)) into result from (select 1) dummy left join public.business_settings s on s.business_id=b;
 when 'workers' then result:=public.get_schedule_team(b);
 when 'team_members' then select coalesce(jsonb_agg((value-'user_id')||jsonb_build_object('id',value->>'user_id')),'[]') into result from jsonb_array_elements(public.get_team_settings(b)->'members');
 when 'team_invitations' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select id,email,role,access_modules,expires_at,created_at from private.team_invitations where business_id=b and accepted_at is null and revoked_at is null)x;
 when 'scheduling_preferences' then schedule_state:=public.get_scheduling_context(b,null);result:=jsonb_build_array(schedule_state->'preferences'||jsonb_build_object('id',b,'updated_at',(select updated_at from private.scheduling_preferences where business_id=b)));
 when 'worker_time_off' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select id,user_id,starts_at,ends_at,note from private.worker_time_off where business_id=b)x;
 when 'calendar_connections' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select id,provider,email,calendar_name,auto_sync,state,last_synced_at,updated_at from private.calendar_integrations where business_id=b and user_id=auth.uid())x;
 when 'connected_apps' then
  select jsonb_build_array(jsonb_build_object('id',b,'quickbooks_connected',q.business_id is not null,'quickbooks_environment',q.environment,'quickbooks_last_sync_at',q.last_sync_at,'quickbooks_last_sync_count',q.last_sync_count,'sms_status',public.get_sms_setup_status(b),'plan',public.get_plan_usage(b)->>'plan','subscription_status','Open Cancel subscription for current provider status')) into result from (select 1) dummy left join public.quickbooks_connections q on q.business_id=b;
 when 'service_interests' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select business_id id,selected_services,preferred_plan,updated_at from public.business_service_interests where business_id=b)x;
 when 'support_cases' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select c.id,c.title,c.description,c.priority,c.status,c.created_at,c.updated_at from private.support_cases c where c.business_id=b and (c.reporter_id=auth.uid() or private.is_primary_owner(b)))x;
 else raise exception 'Unsupported account resource' using errcode='22023';end case;
 return coalesce(result,'[]');
end $$;
create or replace function public.fin_lookup_records(p_business uuid,p_query jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r text:=p_query->>'resource';c jsonb:=private.fin_account_catalog()->'resources'->r;projection text;source_sql text;predicate text;date_col text;q text;rid uuid;cid uuid;off integer;result jsonb;rows_data jsonb;tab text;money text;status_filter text; record_data jsonb;version_data jsonb;
begin
 if c is null or not private.fin_access(p_business,r) then raise exception 'This account or module is not available to you.' using errcode='42501';end if;
 rid:=nullif(p_query->>'id','')::uuid;cid:=nullif(p_query->>'customer_id','')::uuid;off:=coalesce((p_query->>'offset')::integer,0);
 if off<0 or off>1000 then raise exception 'Narrow this search.' using errcode='22023';end if;
 if cid is not null and not exists(select 1 from public.customers where id=cid and business_id=p_business) then raise exception 'Customer unavailable.' using errcode='42501';end if;
 q:=nullif(btrim(left(p_query->>'query',160)),'');if q is not null then q:='%'||replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';end if;
 if r in ('business_profile','document_settings','workers','team_members','team_invitations','scheduling_preferences','worker_time_off','calendar_connections','connected_apps','service_interests','support_cases') then
  source_sql:='select value as row from jsonb_array_elements(private.fin_special_records($1,$9))';
 else
  if r not in ('customers','properties','invoices','estimates','change_orders','jobs','appointments','reminders','bookkeeping_entries','payments','messages','quickbooks_transactions','document_approvals','record_photos') then raise exception 'Unsupported resource';end if;
  select string_agg(format('%I',value),',') into projection from jsonb_array_elements_text(c->'read_fields');
  source_sql:=format('select to_jsonb(t) as row from (select %s from public.%I where business_id=$1) t',projection,r);
 end if;
 date_col:=case r when 'invoices' then case when p_query->>'order'='due' then 'due_date' else 'issue_date' end when 'estimates' then 'issue_date' when 'jobs' then 'scheduled_start' when 'appointments' then 'starts_at' when 'reminders' then 'due_at' when 'bookkeeping_entries' then 'entry_date' when 'payments' then 'paid_at' when 'quickbooks_transactions' then 'txn_date' when 'worker_time_off' then 'starts_at' else 'created_at' end;
 predicate:='($2::uuid is null or row->>''id''=$2::text) and ($3::text is null or row::text ilike $3 escape ''\'') and ($4::uuid is null or row->>''customer_id''=$4::text)';
 status_filter:=nullif(p_query->>'status','');
 if r='customers' then
  if rid is null then predicate:=predicate||case when status_filter='archived' then ' and (row->>''archived'')::boolean' when status_filter='all' then '' else ' and not (row->>''archived'')::boolean' end;end if;status_filter:=null;
 elsif status_filter='unpaid' and r='invoices' then predicate:=predicate||' and (row->>''balance_due'')::numeric>0 and row->>''status'' not in (''draft'',''void'')';status_filter:=null;
 end if;
 predicate:=predicate||' and ($5::text is null or row->>''status''=$5 or row->>''direction''=$5 or row->>''state''=$5)';
 predicate:=predicate||format(' and ($6::timestamptz is null or (row->>%L)::timestamptz >= $6) and ($7::timestamptz is null or (row->>%L)::timestamptz < $7)',date_col,date_col);
 money:=case when r in ('invoices','estimates','change_orders') then 'total' when r in ('payments','bookkeeping_entries','quickbooks_transactions') then 'amount' else null end;
 execute format('with source as (%s), matching as(select row from source where %s), page as(select row from matching order by row->>%L %s nulls last,row->>''id'' limit 25 offset $8) select jsonb_build_object(''resource'',$9,''rows'',coalesce((select jsonb_agg(row) from page),''[]''),''matching_count'',(select count(*) from matching),''offset'',$8,''complete'',(select count(*) from matching)<=$8+25,''total'',%s,''balance_due'',%s,''income_total'',%s,''expense_total'',%s) ',source_sql,predicate,date_col,case when p_query->>'order'='newest' then 'desc' else 'asc' end,
 case when money is not null then format('(select coalesce(sum((row->>%L)::numeric),0)::text from matching)',money) else 'null' end,
 case when r='invoices' then '(select coalesce(sum((row->>''balance_due'')::numeric),0)::text from matching)' else 'null' end,
 case when r in ('bookkeeping_entries','quickbooks_transactions') then '(select coalesce(sum((row->>''amount'')::numeric) filter(where row->>''direction''=''income''),0)::text from matching)' else 'null' end,
 case when r in ('bookkeeping_entries','quickbooks_transactions') then '(select coalesce(sum((row->>''amount'')::numeric) filter(where row->>''direction''=''expense''),0)::text from matching)' else 'null' end)
 into result using p_business,rid,q,cid,status_filter,nullif(p_query->>'from','')::timestamptz,nullif(p_query->>'to','')::timestamptz,off,r;
 rows_data:='[]';
 for record_data in select value from jsonb_array_elements(result->'rows') loop
  version_data:=record_data;
  if r in ('invoices','estimates','change_orders') then
   tab:=case r when 'invoices' then 'invoice' when 'estimates' then 'estimate' else 'change_order' end;
   execute format('select coalesce(jsonb_agg(jsonb_build_object(''description'',description,''quantity'',quantity::text,''unit_price'',unit_price::text,''tax_rate'',tax_rate::text) order by sort_order,id),''[]'') from public.%I where business_id=$1 and %I=$2',tab||'_items',tab||'_id') into version_data using p_business,(record_data->>'id')::uuid;
   version_data:=record_data||jsonb_build_object('items',version_data);
   if rid is not null then record_data:=version_data;end if;
  end if;
  rows_data:=rows_data||jsonb_build_array(record_data||jsonb_build_object('_version',md5(version_data::text)));
 end loop;
 return jsonb_set(result,'{rows}',rows_data);
end $$;
create or replace function private.fin_resolve_ref(b uuid,ref text,results jsonb,expected_types text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text;rid uuid;entry jsonb;row_data jsonb;tab text;sch text:='public';pk text:='id';scope_col text:='business_id';
begin
 if ref like '$step:%' then entry:=results->substring(ref from 7)::integer;kind:=entry->>'resource';rid:=nullif(entry->>'id','')::uuid;
 else kind:=split_part(ref,':',1);rid:=nullif(split_part(ref,':',2),'')::uuid;end if;
 if rid is null or kind is null or not(kind=any(expected_types)) or not private.fin_access(b,kind) then raise exception 'Invalid account record reference.' using errcode='42501';end if;
 tab:=case kind when 'business_profile' then 'businesses' when 'document_settings' then 'business_settings' when 'team_members' then 'business_members' when 'workers' then 'business_members' else kind end;
 if kind='business_profile' then scope_col:='id';end if;
 if kind in ('document_settings','scheduling_preferences') then pk:='business_id';end if;
 if kind in ('team_members','workers') then pk:='user_id';end if;
 if kind in ('scheduling_preferences','worker_time_off','team_invitations') then sch:='private';end if;
 if kind in ('customers','properties','business_profile','document_settings','invoices','estimates','jobs','appointments','reminders','change_orders','bookkeeping_entries','team_members','workers','team_invitations','scheduling_preferences','worker_time_off') then
  execute format('select 1 from %I.%I where %I=$1 and %I=$2 for update',sch,tab,pk,scope_col) using rid,b;
 end if;
 row_data:=(public.fin_lookup_records(b,jsonb_build_object('resource',kind,'id',rid,'order','oldest')))->'rows'->0;
 if row_data is null then raise exception 'Record unavailable in this account.' using errcode='42501';end if;
 return row_data||jsonb_build_object('_resource',kind);
end $$;
create function private.fin_validate_account_values(b uuid,r text,vals jsonb,creating boolean) returns void language plpgsql security definer set search_path='' as $$
declare cfg jsonb:=private.fin_account_catalog()->'resources'->r; k text; val jsonb; f jsonb; t text; word text; other jsonb;required text;
begin
 if cfg is null or not private.fin_access(b,r,true) then raise exception 'Account field access denied.' using errcode='42501';end if;
 if jsonb_typeof(vals) is distinct from 'object' or pg_column_size(vals)>65536 then raise exception 'Invalid field changes.' using errcode='22023';end if;
 for k,val in select key,value from jsonb_each(vals) loop
  f:=cfg->'fields'->k;t:=f->>'type';word:=val#>>'{}';
  if f is null then raise exception 'This field is read-only or unavailable: %',k using errcode='22023';end if;
  if val='null'::jsonb then if t not in ('text','email','url','reference','date','datetime') or coalesce(cfg->'required','[]') ? k then raise exception 'This field cannot be cleared: %',k;end if;continue;end if;
  if t in ('text','email','url','timezone','color','date','datetime','enum','reference') and jsonb_typeof(val)<>'string' then raise exception 'Invalid text field: %',k;end if;
  if length(word)>coalesce((f->>'max_length')::int,16000) then raise exception 'Field too long: %',k;end if;
  if t='boolean' and jsonb_typeof(val)<>'boolean' then raise exception 'Use Yes or No for %',k;end if;
  if t in ('integer','decimal') then
   if jsonb_typeof(val)<>'number' or word !~ '^-?[0-9]+(\.[0-9]{1,2})?$' or (word::numeric)<(f->>'min')::numeric or (word::numeric)>(f->>'max')::numeric or t='integer' and trunc(word::numeric)<>word::numeric then raise exception 'Invalid number: %',k;end if;
  end if;
  if t='email' and word<>'' and word !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Invalid email';end if;
  if t='url' and word<>'' and (word !~ '^https://[^/@[:space:]]+([/:?#].*)?$' or word ~ '^https://[^/]*@') then raise exception 'Use an HTTPS website';end if;
  if t='color' and word !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid document color';end if;
  if t='timezone' and not exists(select 1 from pg_timezone_names where name=word) then raise exception 'Invalid timezone';end if;
  if t='date' and (word !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(word::date,'YYYY-MM-DD')<>word) then raise exception 'Invalid date';end if;
  if t='datetime' and (word !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite(word::timestamptz)) then raise exception 'Use a valid time and timezone';end if;
  if t='enum' and not (f->'options' ? word) then raise exception 'Invalid field option';end if;
  if t='reference' then other:=private.fin_resolve_ref(b,(f->>'resource')||':'||word,'[]',array[f->>'resource']);end if;
  if t in ('modules','weekdays','payment_links','line_items') and jsonb_typeof(val)<>'array' then raise exception 'Expected a field list';end if;
  if t='modules' and exists(select 1 from jsonb_array_elements_text(val)x where x not in ('calendar','jobs','billing','finances')) then raise exception 'Invalid access module';end if;
  if t='weekdays' and (jsonb_array_length(val) not between 1 and 7 or exists(select 1 from jsonb_array_elements_text(val)x where x !~ '^[1-7]$')) then raise exception 'Invalid working days';end if;
  if t='payment_links' and not private.valid_payment_links(val) then raise exception 'Use supported payment links';end if;
  if t='line_items' then
   if jsonb_array_length(val) not between 1 and 50 then raise exception 'Use 1 to 50 line items';end if;
   for other in select value from jsonb_array_elements(val) loop
    if jsonb_typeof(other)<>'object' or other->>'quantity' is null or other->>'unit_price' is null or other->>'tax_rate' is null or exists(select 1 from jsonb_object_keys(other)x where x not in ('description','quantity','unit_price','tax_rate')) or length(btrim(coalesce(other->>'description',''))) not between 1 and 1000 or (other->>'quantity')::numeric<=0 or (other->>'quantity')::numeric>100000 or (other->>'unit_price')::numeric<0 or (other->>'unit_price')::numeric>10000000 or (other->>'tax_rate')::numeric not between 0 and 100 or exists(select 1 from jsonb_each_text(other)x where x.key in ('quantity','unit_price','tax_rate') and x.value !~ '^[0-9]+(\.[0-9]{1,2})?$') then raise exception 'Invalid line items';end if;
   end loop;
  end if;
 end loop;
 if creating then
  if coalesce((cfg->>'create')::boolean,false) is false then raise exception 'This resource cannot be created here';end if;
  for required in select jsonb_array_elements_text(coalesce(cfg->'required','[]')) loop if nullif(vals->>required,'') is null then raise exception 'Required field: %',required;end if;end loop;
 end if;
end $$;
create function private.fin_apply_account_change(b uuid,op text,target jsonb,f jsonb,rid uuid,customer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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

create or replace function private.fin_scope(b uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',m.role,'modules',m.access_modules,'write',private.can_write_business(b),'catalog_version',2) from public.business_members m where m.business_id=b and m.user_id=auth.uid()
$$;

create or replace function private.fin_finish_turn(b uuid,t uuid,r uuid,reply jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if op not in ('create_customer','create_invoice','create_estimate','create_job','create_change_order','update_customer','update_invoice','update_estimate','update_job','schedule_job','schedule_invoice','convert_estimate','record_payment','create_reminder','complete_reminder','archive_customer','void_invoice','cancel_job','save_business_knowledge','review_delivery','create_account_record','update_account_record','remove_account_record') then raise exception 'Unsupported action.' using errcode='22023';end if;
  if nullif(s->>'request_id','')::uuid is null or jsonb_typeof(s->'fields') is distinct from 'object' then raise exception 'Invalid action payload.' using errcode='22023';end if;
  allowed:=case op
   when 'create_account_record' then array['resource','values'] when 'update_account_record' then array['resource','values'] when 'remove_account_record' then array['resource','values']
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
  if op in ('create_account_record','update_account_record','remove_account_record') then
   perform private.fin_validate_account_values(b,s->'fields'->>'resource',s->'fields'->'values',op='create_account_record');
   if (op='create_account_record' and s->>'target' is not null) or (op<>'create_account_record' and (s->>'target' is null or split_part(s->>'target',':',1) is distinct from s->'fields'->>'resource')) then raise exception 'Choose the exact account record';end if;
   if op='remove_account_record' and (not coalesce((private.fin_account_catalog()->'resources'->(s->'fields'->>'resource')->>'remove')::boolean,false) or s->'fields'->'values'<>'{}'::jsonb) then raise exception 'Unsupported removal';end if;
   s:=s||jsonb_build_object('related','{}'::jsonb);
   for field_name in select jsonb_object_keys(s->'fields'->'values') loop
    target_kind:=private.fin_account_catalog()->'resources'->(s->'fields'->>'resource')->'fields'->field_name->>'resource';
    if target_kind is not null and s->'fields'->'values'->>field_name is not null then
     record:=private.fin_resolve_ref(b,target_kind||':'||(s->'fields'->'values'->>field_name),'[]',array[target_kind]);
     s:=jsonb_set(s,array['related',field_name],jsonb_build_object('reference',target_kind||':'||(s->'fields'->'values'->>field_name),'record',record));
    end if;
   end loop;
   if s->'fields'->'values' ? 'items' then
    select coalesce(sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)+round(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)*(i->>'tax_rate')::numeric/100,2)),0) into computed_total from jsonb_array_elements(s->'fields'->'values'->'items') i;
    s:=jsonb_set(s,'{total}',to_jsonb(round(computed_total,2)::text));
   end if;
  end if;
  if s->'fields' ? 'items' then
   select coalesce(sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)+round(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)*(i->>'tax_rate')::numeric/100,2)),0) into computed_total from jsonb_array_elements(s->'fields'->'items') i;
   s:=jsonb_set(s,'{total}',to_jsonb(round(computed_total,2)::text));
  end if;
  if op='save_business_knowledge' then select to_jsonb(businesses)->(s->'fields'->>'knowledge_field') into record from public.businesses where id=b;s:=jsonb_set(s,'{previous_knowledge}',coalesce(record,'null'));end if;
  resource:=case when op in ('create_account_record','update_account_record','remove_account_record') then s->'fields'->>'resource' when op in ('create_invoice','update_invoice','void_invoice','record_payment','schedule_invoice') then 'invoices' when op in ('create_estimate','update_estimate','convert_estimate') then 'estimates' when op='create_change_order' then 'change_orders' when op in ('create_job','update_job','schedule_job','cancel_job') then 'jobs' when op in ('create_reminder','complete_reminder') then 'reminders' when op='save_business_knowledge' then 'knowledge' else 'customers' end;
  if not private.fin_access(b,resource,true) then raise exception 'You cannot perform this action.' using errcode='42501';end if;
  for ref in select v from jsonb_each_text(jsonb_build_object('target',s->>'target','customer',s->>'customer')) z(k,v) where v is not null loop
   if ref like '$step:%' then
    if substring(ref from 7)::integer<0 or substring(ref from 7)::integer>=idx then raise exception 'Invalid action dependency.' using errcode='22023';end if;
   else
    target_kind:=split_part(ref,':',1);
    if not(private.fin_account_catalog()->'resources' ? target_kind) then raise exception 'Invalid record reference.' using errcode='22023';end if;
    record:=(public.fin_lookup_records(b,jsonb_build_object('resource',target_kind,'id',split_part(ref,':',2),'order','oldest')))->'rows'->0;
    if record is null then raise exception 'A selected record is unavailable.' using errcode='42501';end if;
    if ref=s->>'target' and (coalesce(record->>'_version',record->>'updated_at') is distinct from s->>'expected') then raise exception 'The record changed. Ask Fin to refresh the review.' using errcode='40001';end if;
    if ref=s->>'target' then s:=jsonb_set(s,'{record}',record);end if;
    if ref=s->>'customer' then s:=jsonb_set(s,'{customer_record}',record);end if;
   end if;
  end loop;
  steps:=jsonb_set(steps,array[idx::text],s);idx:=idx+1;
 end loop;
 response_payload:=reply-'steps';
 if jsonb_array_length(steps)>0 then
 insert into private.fin_reviews(id,thread_id,business_id,user_id,version,steps) values(r,t,b,auth.uid(),x.revision,steps) returning * into review;
 response_payload:=response_payload||jsonb_build_object('plan',jsonb_build_object('id',r,'version',review.version,'steps',steps,'expires_at',review.expires_at,'destructive',exists(select 1 from jsonb_array_elements(steps) e where e->>'operation' in ('archive_customer','void_invoice','cancel_job','remove_account_record') or e->'fields'->'values'->>'archived'='true' or e->'fields'->'values'->>'status'='canceled')));
 end if;
 update private.fin_threads set response=response_payload,history=(select coalesce(jsonb_agg(v order by n),'[]') from (select v,n from jsonb_array_elements(x.history||jsonb_build_array(jsonb_build_object('request',x.request_text,'answer',reply->>'answer','clarification',reply->>'clarification','steps',(select coalesce(jsonb_agg(e-'record'-'customer_record'-'previous_knowledge'-'related'),'[]') from jsonb_array_elements(steps)e),'sources',reply->'source_keys'))) with ordinality a(v,n) order by n desc limit 8) recent),updated_at=now() where id=t;
 while (select pg_column_size(history)>120000 and jsonb_array_length(history)>1 from private.fin_threads where id=t) loop update private.fin_threads set history=history-0 where id=t;end loop;
 return response_payload;
end $$;
create or replace function private.fin_execute_review(b uuid,t uuid,r uuid,v integer,approved boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare review private.fin_reviews%rowtype;x private.fin_threads%rowtype;s jsonb;f jsonb;op text;target jsonb;customer jsonb;created jsonb;results jsonb:='[]';rid uuid;resource text;workers uuid[];k text;
begin
 perform 1 from public.business_members where business_id=b and user_id=auth.uid() for share;
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
  resource:=case when op in ('create_account_record','update_account_record','remove_account_record') then s->'fields'->>'resource' when op in ('create_invoice','update_invoice','void_invoice','record_payment','schedule_invoice') then 'invoices' when op in ('create_estimate','update_estimate','convert_estimate') then 'estimates' when op='create_change_order' then 'change_orders' when op in ('create_job','update_job','schedule_job','cancel_job') then 'jobs' when op in ('create_reminder','complete_reminder') then 'reminders' when op='save_business_knowledge' then 'knowledge' else 'customers' end;
  if not private.fin_access(b,resource,true) then raise exception 'Your permission changed. No changes were saved.' using errcode='42501';end if;
  if op in ('update_account_record','remove_account_record') then target:=private.fin_resolve_ref(b,s->>'target',results,array[resource]);
  elsif op in ('update_invoice','void_invoice','record_payment','schedule_invoice') then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices']);
  elsif op in ('update_estimate','convert_estimate') then target:=private.fin_resolve_ref(b,s->>'target',results,array['estimates']);
  elsif op in ('update_customer','archive_customer') then target:=private.fin_resolve_ref(b,s->>'target',results,array['customers']);
  elsif op in ('update_job','schedule_job','cancel_job') then target:=private.fin_resolve_ref(b,s->>'target',results,array['jobs']);
  elsif op='complete_reminder' then target:=private.fin_resolve_ref(b,s->>'target',results,array['reminders']);
  elsif op='create_change_order' then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices','estimates']);
  elsif op='review_delivery' then target:=private.fin_resolve_ref(b,s->>'target',results,array['invoices','estimates','change_orders']);end if;
  if target is not null and s->>'target' not like '$step:%' then
   -- An earlier step may intentionally change this record inside this transaction.
   if not exists(select 1 from jsonb_array_elements(results) z where z->>'id'=target->>'id') and target->>'_version' is distinct from s->>'expected' then raise exception 'A reviewed record changed. No changes were saved. Refresh the plan.' using errcode='40001';end if;
  end if;
  if s->>'customer' is not null then customer:=private.fin_resolve_ref(b,s->>'customer',results,array['customers']);if (customer->>'archived')::boolean then raise exception 'Customer is archived.' using errcode='23514';end if;
   if s->>'customer' not like '$step:%' and (customer->>'updated_at')::timestamptz is distinct from (s->'customer_record'->>'updated_at')::timestamptz then raise exception 'The selected customer changed. Refresh this review.' using errcode='40001';end if;
  end if;
  for k in select jsonb_object_keys(coalesce(s->'related','{}')) loop
   created:=private.fin_resolve_ref(b,s->'related'->k->>'reference',results,array[split_part(s->'related'->k->>'reference',':',1)]);
   if created->>'_version' is distinct from s->'related'->k->'record'->>'_version' then raise exception 'A related record changed. Refresh the review.' using errcode='40001';end if;
  end loop;
  case op
  when 'create_account_record','update_account_record','remove_account_record' then created:=private.fin_apply_account_change(b,op,target,f,rid,customer);
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
revoke all on function private.fin_account_catalog(),public.fin_account_capabilities(uuid),private.fin_special_records(uuid,text),private.fin_validate_account_values(uuid,text,jsonb,boolean),private.fin_apply_account_change(uuid,text,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.fin_account_catalog(),public.fin_account_capabilities(uuid),private.fin_special_records(uuid,text) to authenticated;
