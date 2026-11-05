-- Reminder reviews are read-only. Delivery uses the existing frozen email outbox.
create function private.invoice_reminder_review(actor uuid,b uuid,doc uuid) returns jsonb
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
 body:=body||coalesce(E'\n'||nullif(i.payment_instructions,''),'')||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||(l->>'url'),'' order by l->>'provider') from jsonb_array_elements(coalesce(i.payment_links,'[]'::jsonb)) l),'')||E'\n\nPlease include the invoice number with payment. If you have already paid, please let us know.\n\nThank you,\n'||coalesce(i.issuer_snapshot->>'name',company.name);
 select jsonb_build_object('at',coalesce(m.sent_at,m.created_at),'channel',m.channel,'status',m.status) into last_send from public.messages m where m.business_id=b and m.invoice_id=doc and m.direction='outbound' and m.subject like 'Payment reminder:%' and m.status in('sent','delivered') order by coalesce(m.sent_at,m.created_at) desc limit 1;
 return jsonb_build_object('invoice_id',doc,'customer_id',i.customer_id,'number',i.invoice_number,'email',btrim(c.email),'phone',c.phone,'balance',i.balance_due,'due_date',i.due_date,'version',i.updated_at,'subject',subject,'body',body,'last_reminder',last_send);
end $$;
revoke all on function private.invoice_reminder_review(uuid,uuid,uuid) from public,anon,authenticated;
create function public.get_invoice_reminder_review(p_business uuid,p_invoice uuid) returns jsonb language sql security definer set search_path='' as $$select private.invoice_reminder_review(auth.uid(),p_business,p_invoice)$$;
revoke all on function public.get_invoice_reminder_review(uuid,uuid) from public,anon;
grant execute on function public.get_invoice_reminder_review(uuid,uuid) to authenticated;
create function public.prepare_invoice_reminder_email(p_actor uuid,p_business uuid,p_document uuid,p_request uuid,p_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewed jsonb;o private.finviant_email_outbox%rowtype;payload jsonb;reply text;
begin
 if p_actor is null or p_request is null or private.member_module_access(p_business,p_actor,'billing') is distinct from true or not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) then raise exception 'Billing access required.' using errcode='42501';end if;
 if not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) or not exists(select 1 from private.business_entitlements where business_id=p_business and plan in('basic','pro') and (valid_until is null or valid_until>now())) then raise exception 'Verified account and active plan required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 perform 1 from public.invoices where id=p_document and business_id=p_business for update;
 if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then
  if o.business_id<>p_business or o.document_kind<>'invoice' or o.document_id<>p_document or o.payload->>'subject' is distinct from p_review->>'subject' or o.payload->>'text' is distinct from p_review->>'body' or lower(o.payload#>>'{to,0}') is distinct from lower(p_review->>'email') then raise exception 'Reminder request changed. Review the saved request.' using errcode='23505';end if;
  if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 end if;
 perform 1 from public.customers where business_id=p_business and id=(select customer_id from public.invoices where id=p_document and business_id=p_business) for update;
 reviewed:=private.invoice_reminder_review(p_actor,p_business,p_document);
 if p_review is null or (reviewed-'last_reminder') is distinct from (p_review-'last_reminder') then raise exception 'Invoice or customer details changed. Reload the reminder before sending.' using errcode='23514';end if;
 if coalesce(reviewed->>'email','') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Add a valid customer email first.' using errcode='23514';end if;
 if o.id is not null then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if exists(select 1 from private.finviant_email_outbox where business_id=p_business and document_kind='invoice' and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required')) then raise exception 'An invoice email is still pending. Check its activity before sending another.' using errcode='23514';end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'Email rate limit reached.';end if;
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(reviewed->>'email'),'subject',reviewed->>'subject','text',reviewed->>'body','tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 select coalesce(i.issuer_snapshot->>'email',b.email) into reply from public.invoices i join public.businesses b on b.id=i.business_id where i.id=p_document and i.business_id=p_business;
 if reply ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then payload:=payload||jsonb_build_object('reply_to',jsonb_build_array(reply));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,(reviewed->>'customer_id')::uuid,p_document,'outbound','email',reviewed->>'email',reviewed->>'subject',reviewed->>'body','resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,'invoice',p_document,payload);
 return jsonb_build_object('id',p_request,'status','queued');
end $$;
revoke all on function public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb) to service_role;
