alter table public.business_settings add column payment_service_setups jsonb;
create function private.normalize_payment_service_setups() returns trigger language plpgsql set search_path='' as $$
declare links jsonb;
begin
 if new.payment_service_setups is null then return new;end if;
 if jsonb_typeof(new.payment_service_setups)<>'array' or jsonb_array_length(new.payment_service_setups)>4 then raise exception 'Configure at most four payment services.' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(new.payment_service_setups) s where jsonb_typeof(s->'include_by_default') is distinct from 'boolean') or (select count(*)<>count(distinct s->>'provider') from jsonb_array_elements(new.payment_service_setups) s) then raise exception 'Each payment service needs one default selection.' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('provider',s->>'provider','url',s->>'url')),'[]') into links from jsonb_array_elements(new.payment_service_setups) s;
 if not private.valid_payment_links(links) then raise exception 'Use a valid business payment link for each configured service.' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('provider',s->>'provider','url',s->>'url')),'[]') into new.payment_links from jsonb_array_elements(new.payment_service_setups) s where (s->>'include_by_default')::boolean;
 return new;
end $$;
revoke all on function private.normalize_payment_service_setups() from public,anon,authenticated;
create trigger normalize_payment_service_setups before insert or update on public.business_settings for each row execute function private.normalize_payment_service_setups();
-- Every creation path snapshots current defaults. Existing invoices retain their destinations.
create or replace function private.guard_invoice_destinations() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  select coalesce(s.payment_links,'[]'::jsonb),coalesce(s.payment_instructions,'') into new.payment_links,new.payment_instructions from public.business_settings s where s.business_id=new.business_id;
  new.payment_links:=coalesce(new.payment_links,'[]'::jsonb);new.payment_instructions:=coalesce(new.payment_instructions,'');
 elsif (new.payment_links,new.payment_instructions) is distinct from (old.payment_links,old.payment_instructions) then raise exception 'Payment destinations are saved with the document. Manage defaults in Invoice and Estimate Setup.' using errcode='23514';end if;
 return new;
end $$;
create function private.invoice_payment_url(provider text,url text,balance numeric,reference text,currency text default 'USD') returns text language plpgsql immutable set search_path='' as $$
begin
 if balance is null or balance<=0 then return url;end if;
 if provider='paypal' and url ~ '^https://paypal\.me/[A-Za-z0-9]+/?$' then return rtrim(url,'/')||'/'||to_char(balance,'FM9999999999999990.00')||currency;end if;
 if provider='stripe' and url ~ '^https://buy\.stripe\.com/[A-Za-z0-9_]+$' and coalesce(reference,'')<>'' then return url||'?client_reference_id='||left(regexp_replace(reference,'[^A-Za-z0-9_-]','_','g'),200);end if;
 return url;
end $$;
revoke all on function private.invoice_payment_url(text,text,numeric,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text)
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
 select plan into plan_name from private.business_entitlements where business_id=p_business and (valid_until is null or valid_until>now());
 if plan_name is null or plan_name not in('basic','pro') or (p_kind<>'invoice' and plan_name<>'pro') then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot,'payment_links',payment_links,'payment_instructions',payment_instructions) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total')||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\n'||coalesce(d->>'payment_instructions','')||E'\nPayments are handled by the business directly with its external provider. Include the invoice number with payment.'||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')),'' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'');
  update public.invoices set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';
 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';
  if p_kind='estimate' then update public.estimates set status='sent' where id=p_document and business_id=p_business and status='draft';else update public.change_orders set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';end if;
 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if p_kind='invoice' then new_payload:=new_payload||jsonb_build_object('html','<div style="font-family:Arial,sans-serif;color:#193843"><pre style="white-space:pre-wrap;font-family:inherit">'||private.html_escape(body_text)||'</pre>'||coalesce((select string_agg('<a style="display:inline-block;padding:12px 18px;margin:6px;border:1px solid #b7d7ce;border-radius:8px;color:#174d43;text-decoration:none" href="'||private.html_escape(private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')))||'">Pay with '||private.html_escape(case l->>'provider' when 'paypal' then 'PayPal' when 'venmo' then 'Venmo' when 'cashapp' then 'Cash App' when 'stripe' then 'Stripe' else 'Payment provider' end)||'</a>','' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'')||'</div>');end if;
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$;

create or replace function private.invoice_reminder_review(actor uuid,b uuid,doc uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype;c public.customers%rowtype;company public.businesses%rowtype;body text;subject text;last_send jsonb;
begin
 if actor is null or private.member_module_access(b,actor,'billing') is distinct from true or not exists(select 1 from public.business_members where business_id=b and user_id=actor and role in('owner','admin','office')) then raise exception 'Billing access required.' using errcode='42501';end if;
 select * into i from public.invoices where id=doc and business_id=b;
 select * into company from public.businesses where id=b;
 if i.id is null or i.status not in('sent','viewed','partial','overdue') or i.balance_due<=0 or i.due_date is null or i.due_date >= (now() at time zone coalesce(nullif(company.timezone,''),'America/New_York'))::date then raise exception 'This invoice is no longer overdue. Refresh its balance before following up.' using errcode='23514';end if;
 select * into c from public.customers where id=i.customer_id and business_id=b;
 subject:=regexp_replace('Payment reminder: '||coalesce(i.invoice_number,'Invoice')||' — '||coalesce(i.issuer_snapshot->>'name',company.name),E'[\r\n]',' ','g');
 body:='Hi '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\nA reminder that invoice '||coalesce(i.invoice_number,'Invoice')||' has a remaining balance of '||coalesce(company.currency,'USD')||' '||i.balance_due::text||', due '||to_char(i.due_date,'Mon DD, YYYY')||E'.\n';
 body:=body||coalesce(E'\n'||nullif(i.payment_instructions,''),'')||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||private.invoice_payment_url(l->>'provider',l->>'url',i.balance_due,coalesce(i.invoice_number,'Invoice'),coalesce(company.currency,'USD')),'' order by l->>'provider') from jsonb_array_elements(coalesce(i.payment_links,'[]'::jsonb)) l),'')||E'\n\nPlease include the invoice number with payment. If you have already paid, please let us know.\n\nThank you,\n'||coalesce(i.issuer_snapshot->>'name',company.name);
 select jsonb_build_object('at',coalesce(m.sent_at,m.created_at),'channel',m.channel,'status',m.status) into last_send from public.messages m where m.business_id=b and m.invoice_id=doc and m.direction='outbound' and m.subject like 'Payment reminder:%' and m.status in('sent','delivered') order by coalesce(m.sent_at,m.created_at) desc limit 1;
 return jsonb_build_object('invoice_id',doc,'customer_id',i.customer_id,'number',i.invoice_number,'email',btrim(c.email),'phone',c.phone,'balance',i.balance_due,'due_date',i.due_date,'version',i.updated_at,'subject',subject,'body',body,'last_reminder',last_send);
end $$;
