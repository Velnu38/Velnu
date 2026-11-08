-- 2026-11-08: One business contact card, separate from named account users.
create table private.business_cards (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 revision uuid not null default gen_random_uuid(),
 details jsonb not null,
 updated_at timestamptz not null default now()
);
alter table private.business_cards enable row level security;
revoke all on private.business_cards from public,anon,authenticated,service_role;

create function private.business_card_access(b uuid,actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select actor is not null and (private.is_primary_owner(b,actor) or
 (private.member_module_access(b,actor,'billing') and exists(select 1 from public.business_members where business_id=b and user_id=actor and role in('owner','admin','office'))));
$$;
create function private.business_card_state(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb;r uuid;p text;
begin
 if not private.business_card_access(b,auth.uid()) then raise exception 'Business card access denied.' using errcode='42501';end if;
 p:=private.effective_plan(b);
 if p<>'pro' then return jsonb_build_object('plan',p,'can_edit',false,'card',null,'revision',null);end if;
 select details,revision into d,r from private.business_cards where business_id=b;
 if not found then select jsonb_build_object('name',coalesce(name,''),'email',coalesce(email,''),'phone',coalesce(phone,''),'website',coalesce(website,''),'tagline',left(coalesce(services_offered,business_description,''),300),'include_address',false,'street',concat_ws(', ',nullif(address_line1,''),nullif(address_line2,'')),'city',coalesce(city,''),'region',coalesce(state,''),'postal_code',coalesce(postal_code,'')) into d from public.businesses where id=b;end if;
 return jsonb_build_object('plan',p,'can_edit',private.is_primary_owner(b),'card',d,'revision',r,'pending_send',(select jsonb_build_object('id',o.id,'revision',o.card_revision_id,'recipient',o.payload->'to'->>0,'status',o.status) from private.finviant_email_outbox o where o.business_id=b and o.actor_id=auth.uid() and o.document_kind='business_card' and o.status in('queued','sending','uncertain','reconciliation_required') order by o.created_at desc limit 1));
end $$;
create function public.get_business_card(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.business_card_state(p_business)$$;

create function private.save_business_card(b uuid,d jsonb,expected uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_revision uuid;clean jsonb:='{}';k text;v text;
begin
 if auth.uid() is null or not private.is_primary_owner(b) or private.effective_plan(b)<>'pro' then raise exception 'Only the primary Business Pro owner can edit this card.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('business-card:'||b::text,0));
 select revision into current_revision from private.business_cards where business_id=b;
 if current_revision is distinct from expected then raise exception 'This card changed. Close and reopen it before saving.' using errcode='40001';end if;
 if jsonb_typeof(d) is distinct from 'object' or pg_column_size(d)>16384 or jsonb_typeof(d->'include_address') is distinct from 'boolean' then raise exception 'Invalid card details.' using errcode='22023';end if;
 foreach k in array array['name','phone','email','website','tagline','street','city','region','postal_code'] loop
  if d ? k and jsonb_typeof(d->k) is distinct from 'string' then raise exception 'Invalid card field.' using errcode='22023';end if;
  v:=btrim(coalesce(d->>k,''));
  if length(v)>(case when k='website' then 1000 when k='tagline' then 300 when k='phone' then 40 else 254 end) or v ~ '[[:cntrl:]]' then raise exception 'Check card field lengths and remove line breaks.' using errcode='22023';end if;
  clean:=clean||jsonb_build_object(k,v);
 end loop;
 if coalesce(clean->>'name','')='' or ((clean->>'phone')='' and (clean->>'email')='') or ((clean->>'email')<>'' and (clean->>'email') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$') or ((clean->>'website')<>'' and (clean->>'website') !~ '^https?://[^[:space:]<>]+$') then raise exception 'Enter a business name and phone or email; use a full https:// website address.' using errcode='22023';end if;
 clean:=clean||jsonb_build_object('include_address',(d->>'include_address')::boolean);
 insert into private.business_cards(business_id,details) values(b,clean) on conflict(business_id) do update set details=excluded.details,revision=gen_random_uuid(),updated_at=now();
 return private.business_card_state(b);
end $$;
create function public.save_business_card(p_business uuid,p_details jsonb,p_expected_revision uuid) returns jsonb language sql security invoker set search_path='' as $$select private.save_business_card(p_business,p_details,p_expected_revision)$$;

create function private.vcard_escape(v text) returns text language sql immutable set search_path='' as $$select replace(replace(replace(replace(replace(coalesce(v,''),E'\\',E'\\\\'),E'\r\n',E'\\n'),E'\n',E'\\n'),';',E'\\;'),',',E'\\,')$$;
create function private.vcard_fold(v text) returns text language plpgsql immutable set search_path='' as $$
declare result text:='';line text:='';ch text;i integer;
begin
 for i in 1..char_length(v) loop
  ch:=substr(v,i,1);
  if octet_length(line||ch)>75 then result:=result||line||E'\r\n';line:=' ';end if;
  line:=line||ch;
 end loop;
 return result||line||E'\r\n';
end $$;
create function private.business_card_vcf(d jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text:=E'BEGIN:VCARD\r\nVERSION:3.0\r\n';k text;prop text;
begin
 result:=result||private.vcard_fold('FN:'||private.vcard_escape(d->>'name'))||private.vcard_fold('N:'||private.vcard_escape(d->>'name')||';;;;')||private.vcard_fold('ORG:'||private.vcard_escape(d->>'name'));
 foreach k in array array['phone','email','website','tagline'] loop
  prop:=case k when 'phone' then 'TEL;TYPE=WORK,VOICE:' when 'email' then 'EMAIL;TYPE=WORK,INTERNET:' when 'website' then 'URL:' else 'NOTE:' end;
  if coalesce(d->>k,'')<>'' then result:=result||private.vcard_fold(prop||(case when k='website' then d->>k else private.vcard_escape(d->>k) end));end if;
 end loop;
 if coalesce((d->>'include_address')::boolean,false) then result:=result||private.vcard_fold('ADR;TYPE=WORK:;;'||private.vcard_escape(d->>'street')||';'||private.vcard_escape(d->>'city')||';'||private.vcard_escape(d->>'region')||';'||private.vcard_escape(d->>'postal_code')||';');end if;
 return result||E'END:VCARD\r\n';
end $$;
create function private.export_business_card(b uuid,expected uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c private.business_cards%rowtype;
begin
 if not private.business_card_access(b,auth.uid()) or private.effective_plan(b)<>'pro' then raise exception 'Business Pro and business card access are required.' using errcode='42501';end if;
 select * into c from private.business_cards where business_id=b;
 if not found or c.revision is distinct from expected then raise exception 'Save or reopen the current card before downloading.' using errcode='40001';end if;
 return jsonb_build_object('filename','E-Business-Card.vcf','vcard',private.business_card_vcf(c.details),'revision',c.revision);
end $$;
create function public.export_business_card(p_business uuid,p_expected_revision uuid) returns jsonb language sql security invoker set search_path='' as $$select private.export_business_card(p_business,p_expected_revision)$$;

-- Card emails use the same quota reservation, leased dispatch, beta approval and webhooks.
alter table private.finviant_email_outbox drop constraint finviant_email_outbox_document_kind_check;
alter table private.finviant_email_outbox add constraint finviant_email_outbox_document_kind_check check(document_kind in('invoice','estimate','change_order','schedule','invoice_reminder','business_card'));
alter table private.finviant_email_outbox add column card_revision_id uuid;
create function public.prepare_business_card_email(p_actor uuid,p_business uuid,p_request uuid,p_recipient text,p_expected_revision uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.business_cards%rowtype;o private.finviant_email_outbox%rowtype;payload jsonb;recipient text:=lower(btrim(p_recipient));sender text;subject text;body text;
begin
 if p_actor is null or not private.business_card_access(p_business,p_actor) or private.effective_plan(p_business)<>'pro' then raise exception 'Business Pro and business card access are required.' using errcode='42501';end if;
 if p_request is null or recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' then raise exception 'Review the recipient email.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('email:'||p_request::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then
  if o.actor_id<>p_actor or o.business_id<>p_business or o.document_kind<>'business_card' or o.card_revision_id is distinct from p_expected_revision or o.payload->'to'->>0 is distinct from recipient then raise exception 'An earlier send has different details. Reconcile it before starting another.' using errcode='23514';end if;
  return jsonb_build_object('id',o.id,'status',o.status);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('business-card:'||p_business::text,0));
 if exists(select 1 from private.finviant_email_outbox where business_id=p_business and actor_id=p_actor and document_kind='business_card' and status in('queued','sending','uncertain','reconciliation_required')) then raise exception 'An earlier card email is unresolved. Reopen the card and retry the saved send.' using errcode='23514';end if;
 select * into c from private.business_cards where business_id=p_business;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'Card changed. Reopen it before sending.' using errcode='40001';end if;
 select reply_to into sender from private.managed_delivery_accounts where business_id=p_business and email_active;
 if sender is null then raise exception 'Activate Finviant email before sending this card.' using errcode='42501';end if;
 subject:=(c.details->>'name')||' — E-Business Card';body:='Here are the business contact details for '||(c.details->>'name')||E'.\nOpen the attached .vcf file and choose Add to Contacts to save this business on your phone. Your phone may display the contact differently.\n\nSent through Finviant.';
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(recipient),'reply_to',jsonb_build_array(sender),'subject',subject,'text',body,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)),'attachments',jsonb_build_array(jsonb_build_object('filename','E-Business-Card.vcf','content',replace(encode(convert_to(private.business_card_vcf(c.details),'UTF8'),'base64'),E'\n',''))));
 insert into public.messages(id,business_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,'outbound','email',recipient,subject,body,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,card_revision_id) values(p_request,p_business,p_actor,'business_card',p_business,payload,c.revision);
 return jsonb_build_object('id',p_request,'status','queued');
end $$;

revoke all on function private.business_card_access(uuid,uuid),private.business_card_state(uuid),private.save_business_card(uuid,jsonb,uuid),private.export_business_card(uuid,uuid),private.vcard_escape(text),private.vcard_fold(text),private.business_card_vcf(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.business_card_state(uuid),private.save_business_card(uuid,jsonb,uuid),private.export_business_card(uuid,uuid) to authenticated;
revoke all on function public.get_business_card(uuid),public.save_business_card(uuid,jsonb,uuid),public.export_business_card(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_business_card(uuid),public.save_business_card(uuid,jsonb,uuid),public.export_business_card(uuid,uuid) to authenticated;
revoke all on function public.prepare_business_card_email(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_business_card_email(uuid,uuid,uuid,text,uuid) to service_role;
