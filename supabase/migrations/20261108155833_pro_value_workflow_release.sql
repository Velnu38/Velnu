-- 2026-11-08: Individual manual email, reusable service items and customer CSV fields.
create or replace function private.manual_or_pro_email(b uuid,k text,r uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.effective_plan(b)='pro' or (private.effective_plan(b)='basic'
 and k in('invoice','estimate','change_order')
 and not exists(select 1 from private.delivery_tasks t where t.id=r and t.business_id=b));
$$;
revoke all on function private.manual_or_pro_email(uuid,text,uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.tier_limit(t text, f text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case f when 'ai' then case t when 'pro' then 600 when 'basic' then 150 else 20 end
 when 'voice' then case t when 'pro' then 10800 when 'basic' then 3600 else 600 end
 when 'email' then case when t='pro' then 2000 when t='basic' then 250 else 0 end
 when 'sms' then case when t='pro' then 200 else 0 end else 0 end;
$function$
;
CREATE OR REPLACE FUNCTION private.get_plan_usage(target_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text:=private.effective_plan(target_business_id); m date:=date_trunc('month',now() at time zone 'UTC')::date; result jsonb;
begin
 if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select jsonb_build_object('plan',t,'actual_plan',coalesce((select plan from private.business_entitlements where business_id=target_business_id and(valid_until is null or valid_until>now())),'free'),
 'testing',exists(select 1 from private.tier_test_overrides o join private.workspace_feature_flags f on f.name='tier_testing' and f.enabled where o.business_id=target_business_id),
 'can_test',private.can_test_tiers(target_business_id),'period_end',(m+interval '1 month')::date,'introductory',t='free',
 'customers_used',(select count(*) from public.customers where business_id=target_business_id and not archived),'customers_limit',case when t='free' then 10 end,
 'jobs_used',(select count(*) from private.tier_bookings where business_id=target_business_id and period=m),'jobs_limit',case when t='free' then 5 end,
 'seats_used',(select count(*) from public.business_members where business_id=target_business_id),'seats_limit',private.team_seat_limit(target_business_id),
 'documents_used',coalesce((select documents from private.monthly_usage where business_id=target_business_id and month=m),0),'documents_limit',null,
 'ai_limit',private.tier_limit(t,'ai'),'voice_limit',private.tier_limit(t,'voice')/60,'email_limit',private.tier_limit(t,'email'),'sms_limit',private.tier_limit(t,'sms'),
 'ai_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=private.tier_period(t,'ai') and feature='ai'),0),
 'voice_used',ceil(coalesce((select used from private.tier_usage where business_id=target_business_id and period=private.tier_period(t,'voice') and feature='voice'),0)/60.0),
 'email_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=m and feature='email'),0),
 'sms_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=m and feature='sms'),0),
 'storage_bytes_limit',private.attachment_limit(t),'logo_bytes_limit',case when t='free' then 0 else 2000000 end,
 'delivery_mode',case when t in('basic','pro') then 'managed' else 'personal' end,'financial_history',t<>'free') into result;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION private.private_beta_email_payload_allowed(p_business uuid, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sender text; field text; recipients jsonb; recipient jsonb; address text;
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='private_beta_email_delivery'),false)
 or not coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false)
 or not exists(select 1 from public.businesses b
   join private.test_account_slots s on s.user_id=b.created_by_user_id
   join auth.users u on u.id=s.user_id
   where b.id=p_business and u.email_confirmed_at is not null and
    u.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$')
 or private.effective_plan(p_business) not in('basic','pro') then return false;end if;
 select m.reply_to into sender from private.managed_delivery_accounts m
 where m.business_id=p_business and m.email_active;
 if sender is null or sender !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
 or not exists(select 1 from private.private_beta_email_recipients r
   where r.business_id=p_business and r.email=lower(btrim(sender)) and r.active)
 or jsonb_typeof(p_payload) is distinct from 'object' then return false;end if;
 if jsonb_typeof(p_payload->'to') is distinct from 'array'
 or jsonb_typeof(p_payload->'reply_to') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_payload->'to')=0
 or jsonb_array_length(p_payload->'reply_to')<>1
 or jsonb_typeof(p_payload->'reply_to'->0) is distinct from 'string'
 or lower(btrim(p_payload->'reply_to'->>0))<>lower(btrim(sender)) then return false;end if;
 foreach field in array array['to','cc','bcc'] loop
  if not (p_payload ? field) then continue;end if;
  recipients:=p_payload->field;
  if jsonb_typeof(recipients) is distinct from 'array' then return false;end if;
  for recipient in select value from jsonb_array_elements(recipients) loop
   if jsonb_typeof(recipient) is distinct from 'string' then return false;end if;
   address:=lower(btrim(recipient #>> '{}'));
   if length(address)>254 or address !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
   or (address not in ('delivered@resend.dev','bounced@resend.dev','complained@resend.dev')
    and not exists(select 1 from private.private_beta_email_recipients r
      where r.business_id=p_business and r.email=address and r.active)) then return false;end if;
  end loop;
 end loop;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION private.prepare_document_email_before_pdf(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;d jsonb;b record;c record;items_text text;body_text text;subj text;label text;number text;tok text;approval_url text;plan_name text;new_payload jsonb;
begin
 if not private.member_module_access(p_business,p_actor,'billing') then raise exception 'Billing access denied' using errcode='42501';end if;
 if p_actor is null or p_request is null or p_document is null or p_kind is null or p_kind not in('invoice','estimate','change_order') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com','https://app.finviant.com') then raise exception 'INVALID_APP_ORIGIN' using errcode='22023';end if;
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) or not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 plan_name:=private.effective_plan(p_business);
 if not private.manual_or_pro_email(p_business,p_kind,p_request) then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot,'payment_links',payment_links,'payment_instructions',payment_instructions) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||case when tax_rate>0 and round(line_total*tax_rate/100,2)<>0 then ' | Tax '||tax_rate::text||'%' else '' end,E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||case when tax_rate>0 and round(line_total*tax_rate/100,2)<>0 then ' | Tax '||tax_rate::text||'%' else '' end,E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'change_totals',change_totals,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||case when jsonb_typeof(d->'change_totals')='object' then ''
    else ' | Qty '||quantity::text||' x '||unit_price::text end,E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||case when jsonb_typeof(d->'change_totals')='object' then
   E'\n\nCurrent total: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,current_total}')||
   E'\nThis change: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,change_amount}')||
   E'\nRevised total: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,revised_total}')
 else E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total') end||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\n'||coalesce(d->>'payment_instructions','')||E'\nPayments are handled by the business directly with its external provider. Include the invoice number with payment.'||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')),'' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'');

 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';

 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if p_kind='invoice' then new_payload:=new_payload||jsonb_build_object('html','<div style="font-family:Arial,sans-serif;color:#193843"><pre style="white-space:pre-wrap;font-family:inherit">'||private.html_escape(body_text)||'</pre>'||coalesce((select string_agg('<a style="display:inline-block;padding:12px 18px;margin:6px;border:1px solid #b7d7ce;border-radius:8px;color:#174d43;text-decoration:none" href="'||private.html_escape(private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')))||'">Pay with '||private.html_escape(case l->>'provider' when 'paypal' then 'PayPal' when 'venmo' then 'Venmo' when 'cashapp' then 'Cash App' when 'stripe' then 'Stripe' else 'Payment provider' end)||'</a>','' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'')||'</div>');end if;
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$
;
CREATE OR REPLACE FUNCTION private.claim_document_email_before_pdf(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();current_doc jsonb;begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.document_kind in('invoice','invoice_reminder','estimate','change_order') then
  current_doc:=private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id);
  if current_doc is null or current_doc->>'status' in('void','paid','expired','declined','converted','accepted','approved') or (o.document_kind='invoice_reminder' and current_doc->>'status'='draft') then
   update private.finviant_email_outbox set status='reconciliation_required',last_code='document_not_sendable' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');
  end if;
 end if;
 if o.customer_snapshot is not null and (o.customer_snapshot-'status'-'finviant_branding') is distinct from (private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id)-'status'-'finviant_branding') then update private.finviant_email_outbox set status='reconciliation_required',last_code='document_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.document_kind='schedule' and not exists(select 1 from private.scheduling_offers x join public.estimates e on e.id=x.estimate_id and e.business_id=x.business_id join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
 where x.id=o.document_id and x.business_id=o.business_id and x.status='approved' and x.expires_at>now() and x.recipient_email=c.email and private.can_manage_schedule(x.business_id,o.actor_id)) then
 update private.finviant_email_outbox set status='reconciliation_required',last_code='schedule_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not private.member_module_access(o.business_id,o.actor_id,'billing') then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (not private.manual_or_pro_email(o.business_id,o.document_kind,o.id) or not coalesce((select email_active from private.managed_delivery_accounts where business_id=o.business_id),false)) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$
;
CREATE OR REPLACE FUNCTION private.enforce_managed_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.manual_or_pro_email(new.business_id,new.document_kind,new.id) or not coalesce((select email_active from private.managed_delivery_accounts where business_id=new.business_id),false) then
 raise exception 'An included email allowance and activated Finviant sender are required. Use your personal app while setup is pending.' using errcode='42501';end if;
 if new.document_kind in('invoice','estimate','change_order','invoice_reminder') then new.customer_snapshot:=private.customer_document_snapshot(new.business_id,case when new.document_kind='invoice_reminder' then 'invoice' else new.document_kind end,new.document_id);end if;
 perform private.reserve_tier_usage(new.business_id,new.id,'email',jsonb_array_length(new.payload->'to'));
 return new;
end $function$
;

create or replace function public.import_customer_contacts(p_business uuid,p_contacts jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb;cid uuid;first text;last text;mail text;v_phone text;v_company text;imported integer:=0;skipped integer:=0;replayed integer:=0;existing public.customers%rowtype;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) or not private.can_write_business(p_business) then raise exception 'Only the primary account owner can import contacts.' using errcode='42501';end if;
 if jsonb_typeof(p_contacts) is distinct from 'array' or jsonb_array_length(p_contacts) not between 1 and 100 or pg_column_size(p_contacts)>262144 then raise exception 'Import 1 to 100 reviewed contacts per batch.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('contact-import:'||p_business::text,0));
 for item in select value from jsonb_array_elements(p_contacts) loop
  cid:=(item->>'id')::uuid;first:=nullif(btrim(item->>'first_name'),'');last:=nullif(btrim(item->>'last_name'),'');mail:=nullif(btrim(item->>'email'),'');v_phone:=nullif(btrim(item->>'phone'),'');v_company:=nullif(btrim(item->>'company'),'');
  if cid is null or coalesce(first,last) is null or length(coalesce(v_company,''))>160 or length(coalesce(first,''))>160 or length(coalesce(last,''))>160 or length(coalesce(mail,''))>254 or length(coalesce(v_phone,''))>40 or (mail is not null and mail !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$') then raise exception 'Check the selected contact names, emails and v_phone numbers.' using errcode='22023';end if;
  select * into existing from public.customers where id=cid and business_id=p_business;
  if found then
   if (existing.first_name,existing.last_name,existing.email,existing.phone,existing.company) is distinct from(first,last,mail,v_phone,v_company) then raise exception 'A contact retry contains different details.' using errcode='23505';end if;
   replayed:=replayed+1;continue;
  end if;
  if exists(select 1 from public.customers c where c.business_id=p_business and not c.archived and
    ((mail is not null and lower(c.email)=lower(mail)) or (v_phone is not null and length(regexp_replace(v_phone,'[^0-9]','','g'))>=7 and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_phone,'[^0-9]','','g')) or
     (mail is null and v_phone is null and lower(btrim(concat_ws(' ',c.first_name,c.last_name)))=lower(btrim(concat_ws(' ',first,last)))))) then skipped:=skipped+1;continue;end if;
  insert into public.customers(id,business_id,first_name,last_name,email,phone,company) values(cid,p_business,first,last,mail,v_phone,v_company);imported:=imported+1;
 end loop;
 return jsonb_build_object('imported',imported,'skipped',skipped,'already_imported',replayed);
end $$;

create table public.service_items (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 description text not null check(length(btrim(description)) between 1 and 2000),
 unit_price numeric not null check(unit_price between 0 and 10000000 and scale(unit_price)<=2),
 tax_rate numeric not null default 0 check(tax_rate between 0 and 100 and scale(tax_rate)<=2),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index service_items_active_name on public.service_items(business_id,lower(btrim(description))) where active;
alter table public.service_items enable row level security;
revoke all on public.service_items from public,anon,authenticated;
grant select,insert on public.service_items to authenticated;
grant update(description,unit_price,tax_rate,active) on public.service_items to authenticated;
create policy service_items_read on public.service_items for select to authenticated
 using (public.has_workspace_access(business_id,'billing'));
create policy service_items_insert on public.service_items for insert to authenticated
 with check (public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true));
create policy service_items_update on public.service_items for update to authenticated
 using (public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true))
 with check (public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true));
