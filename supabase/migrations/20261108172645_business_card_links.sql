-- November 8, 2026: immutable, unlisted contact previews, email and SMS handoffs.
create table private.business_card_links(
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id),revision uuid not null,card jsonb not null,branding jsonb not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 days',revoked_at timestamptz
);
create index business_card_links_business on private.business_card_links(business_id,created_at);
alter table private.business_card_links enable row level security;
revoke all on private.business_card_links from public,anon,authenticated,service_role;
create function private.publish_business_card(b uuid,r uuid,t text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.business_cards%rowtype;l private.business_card_links%rowtype;d jsonb;brand jsonb;
begin
 if not private.business_card_access(b,auth.uid()) or private.effective_plan(b)<>'pro' then raise exception 'Business Pro card access required.' using errcode='42501';end if;
 if t is null or t !~ '^[a-f0-9]{64}$' or r is null then raise exception 'Invalid card link request.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('card-link:'||t,0));
 select * into l from private.business_card_links where token_hash=encode(sha256(convert_to(t,'UTF8')),'hex');
 if found then
  if l.business_id<>b or l.actor_id<>auth.uid() or l.revision<>r or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Card link request changed or expired.' using errcode='23514';end if;
  return jsonb_build_object('url','https://finviant.com/?business_card='||t,'expires_at',l.expires_at,'revision',r);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('business-card:'||b::text,0));
 select * into c from private.business_cards where business_id=b;
 if not found or c.revision<>r then raise exception 'Save and review the current card first.' using errcode='40001';end if;
 d:=c.details;
 if not coalesce((d->>'include_address')::boolean,false) then d:=d-'street'-'city'-'region'-'postal_code';end if;
 select jsonb_build_object('accent',case when document_accent ~ '^#[A-Fa-f0-9]{6}$' then document_accent else '#195246' end,'logo_path',case when logo_path like b::text||'/%' and logo_path !~ '[.][.]' and logo_path ~ '^[A-Za-z0-9_./-]+$' then logo_path end) into brand from public.businesses where id=b;
 insert into private.business_card_links(token_hash,business_id,actor_id,revision,card,branding) values(encode(sha256(convert_to(t,'UTF8')),'hex'),b,auth.uid(),r,d,brand) returning * into l;
 return jsonb_build_object('url','https://finviant.com/?business_card='||t,'expires_at',l.expires_at,'revision',r);
end $$;
create function public.publish_business_card(p_business uuid,p_revision uuid,p_token text) returns jsonb language sql security invoker set search_path='' as $$select private.publish_business_card(p_business,p_revision,p_token)$$;
create function private.read_business_card(t text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l private.business_card_links%rowtype;
begin
 if t is null or t !~ '^[a-f0-9]{64}$' then return null;end if;
 select * into l from private.business_card_links where token_hash=encode(sha256(convert_to(t,'UTF8')),'hex') and revoked_at is null and expires_at>now();
 if not found then return null;end if;
 return jsonb_build_object('card',l.card,'branding',l.branding,'vcard',private.business_card_vcf(l.card),'filename','E-Business-Card.vcf','expires_at',l.expires_at);
end $$;
create function public.get_shared_business_card(p_token text) returns jsonb language sql security definer set search_path='' as $$select private.read_business_card(p_token)$$;
create function private.revoke_business_card_link(b uuid,t text) returns void language plpgsql security definer set search_path='' as $$begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can revoke a card link.' using errcode='42501';end if;
 update private.business_card_links set revoked_at=now() where business_id=b and token_hash=encode(sha256(convert_to(t,'UTF8')),'hex');
end $$;
create function public.revoke_business_card_link(p_business uuid,p_token text) returns void language sql security invoker set search_path='' as $$select private.revoke_business_card_link(p_business,p_token)$$;

create table private.business_card_sms(
 id uuid primary key,business_id uuid not null references public.businesses(id) on delete cascade,actor_id uuid not null references auth.users(id),
 token_hash text not null references private.business_card_links(token_hash),revision uuid not null,phone text not null,sender text not null,body text not null,
 segments integer not null check(segments between 1 and 10),status text not null default 'queued' check(status in('queued','sending','accepted','delivered','failed','uncertain','blocked')),
 provider_id text unique,customer_id uuid references public.customers(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index business_card_sms_business on private.business_card_sms(business_id,actor_id,created_at);
alter table private.business_card_sms enable row level security;
revoke all on private.business_card_sms from public,anon,authenticated,service_role;

create function public.prepare_business_card_delivery(p_actor uuid,p_business uuid,p_request uuid,p_revision uuid,p_token text,p_channel text,p_recipient text,p_customer uuid default null,p_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare l private.business_card_links%rowtype;o private.business_card_sms%rowtype;e private.finviant_email_outbox%rowtype;result jsonb;sender text;v_body text;units integer;recipient text:=case when p_channel='email' then lower(btrim(p_recipient)) else p_recipient end;
begin
 if not private.business_card_access(p_business,p_actor) or private.effective_plan(p_business)<>'pro' then raise exception 'Business Pro card access required.' using errcode='42501';end if;
 if p_request is null or p_channel is null or p_channel not in('email','sms') or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid card send.' using errcode='22023';end if;
 if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and business_id=p_business and not archived) then raise exception 'Customer unavailable.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('card-delivery:'||p_request::text,0));
 select * into l from private.business_card_links where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and business_id=p_business and actor_id=p_actor and revision=p_revision and revoked_at is null and expires_at>now();
 if not found then raise exception 'Review a valid saved card link.' using errcode='23514';end if;
 if p_channel='email' then
  select * into e from private.finviant_email_outbox where id=p_request;
  if found then
   if e.business_id<>p_business or e.actor_id<>p_actor or e.document_kind<>'business_card' or e.card_revision_id<>p_revision or e.payload->'to'->>0 is distinct from recipient or e.payload->>'text' not like '%'||p_token||'%' or (select customer_id from public.messages where id=p_request) is distinct from p_customer then raise exception 'Saved send details changed.' using errcode='23514';end if;
   return jsonb_build_object('id',e.id,'status',e.status);
  end if;
  result:=public.prepare_business_card_email(p_actor,p_business,p_request,recipient,p_revision);
  v_body:=E'\n\nView this business card: https://finviant.com/?business_card='||p_token||E'\nThe preview link is available until '||to_char(l.expires_at at time zone 'UTC','Mon DD, YYYY')||'. The attached contact file can be saved permanently.';
  update private.finviant_email_outbox set payload=jsonb_set(payload,'{text}',to_jsonb((payload->>'text')||v_body)) where id=p_request;
  update public.messages set customer_id=p_customer,body=v_body||E'\nE-Business Card attached.' where id=p_request and business_id=p_business;
  return result;
 end if;
 if recipient is null or recipient !~ '^\+1[0-9]{10}$' or p_consent is distinct from true then raise exception 'Confirm permission for a valid US mobile recipient.' using errcode='42501';end if;
 if exists(select 1 from private.sms_opt_outs where phone=recipient) then raise exception 'This recipient opted out of texts.' using errcode='42501';end if;
 select sms_from into sender from private.managed_delivery_accounts where business_id=p_business and sms_active and sms_reply_route is not null;
 if sender is null or not private.sms_owner_phone_verified(p_business) then raise exception 'Finviant SMS sender activation and owner verification are required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('card-sms:'||p_business::text||':'||p_actor::text,0));
 select * into o from private.business_card_sms where id=p_request;
 if found then
  if o.business_id<>p_business or o.actor_id<>p_actor or o.revision<>p_revision or o.token_hash<>l.token_hash or o.phone<>recipient or o.customer_id is distinct from p_customer then raise exception 'Saved text details changed.' using errcode='23514';end if;
  return jsonb_build_object('id',o.id,'status',o.status,'segments',o.segments);
 end if;
 if exists(select 1 from private.business_card_sms where business_id=p_business and actor_id=p_actor and status in('queued','sending','uncertain')) then raise exception 'An earlier card text is pending. Check its activity before another send.';end if;
 v_body:=left(regexp_replace(l.card->>'name','[^A-Za-z0-9 .,]','','g'),40)||': Save our business contact: https://finviant.com/?business_card='||p_token||' Reply STOP to opt out.';
 units:=case when length(v_body)<=160 then 1 else ceil(length(v_body)/153.0)::integer end;
 perform private.reserve_tier_usage(p_business,p_request,'sms',units);
 insert into private.sms_permissions(business_id,phone,actor_id) values(p_business,recipient,p_actor) on conflict do nothing;
 insert into private.business_card_sms(id,business_id,actor_id,token_hash,revision,phone,sender,body,segments,customer_id) values(p_request,p_business,p_actor,l.token_hash,p_revision,recipient,sender,v_body,units,p_customer);
 insert into public.messages(id,business_id,customer_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,p_customer,'outbound','sms',recipient,'E-Business Card',v_body,'twilio','queued');
 return jsonb_build_object('id',p_request,'status','queued','segments',units);
end $$;
create function public.claim_business_card_sms(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.business_card_sms%rowtype;
begin
 select * into o from private.business_card_sms where id=p_request for update;
 if not found then raise exception 'Text unavailable';end if;
 if o.status<>'queued' then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.phone);end if;
 if not private.business_card_access(o.business_id,o.actor_id) or private.effective_plan(o.business_id)<>'pro' or not coalesce((select sms_active from private.managed_delivery_accounts where business_id=o.business_id),false) or not private.sms_owner_phone_verified(o.business_id) or exists(select 1 from private.sms_opt_outs where phone=o.phone) or not exists(select 1 from private.business_card_links where token_hash=o.token_hash and revoked_at is null and expires_at>now()) then update private.business_card_sms set status='blocked' where id=o.id;return jsonb_build_object('id',o.id,'status','blocked');end if;
 update private.business_card_sms set status='sending',updated_at=now() where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','recipient',o.phone,'sender',o.sender,'body',o.body,'segments',o.segments);
end $$;
-- Existing signed Twilio callbacks retain their handler and signature validation.
alter function public.finish_managed_sms(uuid,text,text) rename to finish_managed_sms_before_card;
alter function public.finish_managed_sms_before_card(uuid,text,text) set schema private;
revoke all on function private.finish_managed_sms_before_card(uuid,text,text) from public,anon,authenticated,service_role;
create function public.finish_managed_sms(p_request uuid,p_status text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
declare o private.business_card_sms%rowtype;
begin
 select * into o from private.business_card_sms where id=p_request for update;
 if not found then perform private.finish_managed_sms_before_card(p_request,p_status,p_provider);return;end if;
 if p_status is null or p_status not in('accepted','delivered','failed','uncertain') or (p_provider is not null and p_provider !~ '^SM[0-9a-fA-F]{32}$') then raise exception 'Invalid provider result';end if;
 if o.status in('delivered','failed','blocked') or (o.provider_id is not null and o.provider_id is distinct from p_provider) or (o.status='accepted' and p_status='uncertain') then return;end if;
 update private.business_card_sms set status=p_status,provider_id=coalesce(provider_id,p_provider),updated_at=now() where id=o.id;
 update public.messages set status=case p_status when 'accepted' then 'sent' when 'delivered' then 'delivered' when 'failed' then 'failed' else 'queued' end,provider_message_id=coalesce(provider_message_id,p_provider),sent_at=case when p_status in('accepted','delivered') then coalesce(sent_at,now()) else sent_at end where id=o.id and business_id=o.business_id;
end $$;
create function private.business_card_pending(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.business_card_access(b,auth.uid()) then raise exception 'Card access required' using errcode='42501';end if;
 return coalesce((select jsonb_build_object('id',o.id,'revision',o.card_revision_id,'recipient',o.payload->'to'->>0,'token',substring(o.payload->>'text' from 'business_card=([a-f0-9]{64})'),'channel','email','customer_id',m.customer_id,'status',o.status) from private.finviant_email_outbox o join public.messages m on m.id=o.id where o.business_id=b and o.actor_id=auth.uid() and o.document_kind='business_card' and o.status in('queued','sending','uncertain','reconciliation_required') order by o.created_at desc limit 1),(select jsonb_build_object('id',o.id,'revision',o.revision,'recipient',o.phone,'token',substring(o.body from 'business_card=([a-f0-9]{64})'),'channel','sms','customer_id',o.customer_id,'status',o.status) from private.business_card_sms o where o.business_id=b and o.actor_id=auth.uid() and o.status in('queued','sending','uncertain') order by o.created_at desc limit 1));
end $$;
create function public.get_business_card_pending(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.business_card_pending(p_business)$$;
revoke all on function private.publish_business_card(uuid,uuid,text),private.read_business_card(text),private.revoke_business_card_link(uuid,text),private.business_card_pending(uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_business_card(uuid,uuid,text),private.revoke_business_card_link(uuid,text),private.business_card_pending(uuid) to authenticated;
grant execute on function private.read_business_card(text) to anon,authenticated;
revoke all on function public.publish_business_card(uuid,uuid,text),public.revoke_business_card_link(uuid,text),public.get_business_card_pending(uuid) from public,anon,service_role;
grant execute on function public.publish_business_card(uuid,uuid,text),public.revoke_business_card_link(uuid,text),public.get_business_card_pending(uuid) to authenticated;
revoke all on function public.get_shared_business_card(text) from public,anon,authenticated,service_role;
grant execute on function public.get_shared_business_card(text) to anon,authenticated;
revoke all on function public.prepare_business_card_delivery(uuid,uuid,uuid,uuid,text,text,text,uuid,boolean),public.claim_business_card_sms(uuid),public.finish_managed_sms(uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_business_card_delivery(uuid,uuid,uuid,uuid,text,text,text,uuid,boolean),public.claim_business_card_sms(uuid),public.finish_managed_sms(uuid,text,text) to service_role;
