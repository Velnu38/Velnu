-- Opt-in public identity is separate from private business IDs and expiring share tokens.
create table private.business_card_publications (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 public_id uuid not null unique default gen_random_uuid(),
 published boolean not null default false,
 card jsonb not null, branding jsonb not null, revision uuid not null
);
alter table private.business_card_publications enable row level security;
revoke all on private.business_card_publications from public,anon,authenticated,service_role;
create table private.business_card_requests (
 id uuid primary key, public_id uuid not null references private.business_card_publications(public_id),
 fingerprint text not null, created_at timestamptz not null default now()
);
create index business_card_requests_window on private.business_card_requests(public_id,created_at);
alter table private.business_card_requests enable row level security;
revoke all on private.business_card_requests from public,anon,authenticated,service_role;

create function public.set_live_business_card(p_business uuid,p_revision uuid,p_published boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.business_cards%rowtype; d jsonb; brand jsonb; link uuid;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) or private.effective_plan(p_business)<>'pro' then
  raise exception 'Primary Business Pro owner required.' using errcode='42501';end if;
 if p_published is null then raise exception 'Choose publication state.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('business-card:'||p_business::text,0));
 select * into c from private.business_cards where business_id=p_business;
 if not found or c.revision is distinct from p_revision then raise exception 'Save and review the current card first.' using errcode='40001';end if;
 d:=c.details;
 if not coalesce((d->>'include_address')::boolean,false) then d:=d-'street'-'city'-'region'-'postal_code';end if;
 select jsonb_build_object('accent',case when document_accent ~ '^#[A-Fa-f0-9]{6}$' then document_accent else '#195246' end,
 'logo_path',case when logo_path like p_business::text||'/%' and logo_path !~ '[.][.]' and logo_path ~ '^[A-Za-z0-9_./-]+$' then logo_path end) into brand from public.businesses where id=p_business;
 insert into private.business_card_publications(business_id,published,card,branding,revision) values(p_business,p_published,d,brand,c.revision)
 on conflict(business_id) do update set published=excluded.published,card=excluded.card,branding=excluded.branding,revision=excluded.revision
 returning public_id into link;
 return jsonb_build_object('url','https://finviant.com/?business_card='||link,'published',p_published);
end $$;

create function private.live_business_card_vcf(b uuid,d jsonb) returns text
language plpgsql stable security definer set search_path='' as $$
declare link uuid;result text;
begin
 select public_id into link from private.business_card_publications where business_id=b and published;
 if link is null then return private.business_card_vcf(d);end if;
 -- The standard URL comes first for importers that retain a single website.
 -- Keep the external company website as a second URL. Labels vary by importer.
 result:=private.business_card_vcf(d);
 return replace(result,E'VERSION:3.0\r\n',E'VERSION:3.0\r\n'||private.vcard_fold('URL:https://finviant.com/?business_card='||link));
end $$;
create or replace function private.export_business_card(b uuid,expected uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c private.business_cards%rowtype;
begin
 if not private.business_card_access(b,auth.uid()) or private.effective_plan(b)<>'pro' then raise exception 'Business Pro card access required.' using errcode='42501';end if;
 select * into c from private.business_cards where business_id=b;
 if not found or c.revision is distinct from expected then raise exception 'Save or reopen the current card before downloading.' using errcode='40001';end if;
 return jsonb_build_object('filename','E-Business-Card.vcf','vcard',private.live_business_card_vcf(b,c.details),'revision',c.revision);
end $$;
-- Freeze the same contact in newly prepared emails; retain all existing replay and quota guards.
do $$declare definition text;needle text:='private.business_card_vcf(c.details)';begin
 definition:=pg_get_functiondef('public.prepare_business_card_email(uuid,uuid,uuid,text,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Review card email source before migration';end if;
 execute replace(definition,needle,'private.live_business_card_vcf(c.business_id,c.details)');
end $$;
-- Retain existing expiring preview routes and approved snapshot contact fields.
-- Their contact downloads include the same currently published public website.
do $$declare definition text;needle text:='private.business_card_vcf(l.card)';begin
 definition:=pg_get_functiondef('private.read_business_card(text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Review card preview source before migration';end if;
 execute replace(definition,needle,'private.live_business_card_vcf(l.business_id,l.card)');
end $$;
create function public.get_live_business_card(p_public_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.business_card_publications%rowtype;
begin
 select * into p from private.business_card_publications where public_id=p_public_id and published;
 if not found or private.effective_plan(p.business_id)<>'pro' then return null;end if;
 perform private.reserve_provider_burst('public_link',p.business_id,p.public_id);
 return jsonb_build_object('card',p.card,'branding',p.branding,'vcard',private.live_business_card_vcf(p.business_id,p.card),
 'filename','E-Business-Card.vcf','url','https://finviant.com/?business_card='||p.public_id,'expires_at',null);
end $$;
create function public.request_business_card_estimate(p_public_id uuid,p_request uuid,p_name text,p_email text,p_details text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.business_card_publications%rowtype; fingerprint text; prior private.business_card_requests%rowtype;
begin
 if p_request is null or p_name is null or length(btrim(p_name)) not between 1 and 160 or p_email is null or length(p_email)>254
 or p_email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' or p_details is null or length(btrim(p_details)) not between 1 and 2000 then
  raise exception 'Enter your name, email and request (up to 2000 characters).' using errcode='22023';end if;
 select * into p from private.business_card_publications where public_id=p_public_id and published for share;
 if not found or private.effective_plan(p.business_id)<>'pro' then raise exception 'Card unavailable.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('card-request:'||p.public_id::text,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(btrim(p_name),lower(btrim(p_email)),btrim(p_details))::text,'UTF8')),'hex');
 select * into prior from private.business_card_requests where id=p_request;
 if found then
  if prior.public_id<>p_public_id or prior.fingerprint<>fingerprint then raise exception 'Request details changed.' using errcode='23514';end if;
  return jsonb_build_object('received',true);
 end if;
 perform private.reserve_provider_burst('public_link',p.business_id,p.public_id);
 if (select count(*) from private.business_card_requests where public_id=p_public_id and created_at>now()-interval '1 hour')>=20 then
  raise exception 'Too many requests. Please contact the business directly.' using errcode='54000';end if;
 insert into private.business_card_requests(id,public_id,fingerprint) values(p_request,p_public_id,fingerprint);
 insert into public.messages(id,business_id,direction,channel,recipient,subject,body,provider,status)
 values(p_request,p.business_id,'inbound','email',lower(btrim(p_email)),'Business card estimate request',btrim(p_name)||E'\n'||lower(btrim(p_email))||E'\n\n'||btrim(p_details),'business_card','received');
 return jsonb_build_object('received',true);
end $$;
revoke all on function public.set_live_business_card(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.set_live_business_card(uuid,uuid,boolean) to authenticated;
revoke all on function private.live_business_card_vcf(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_live_business_card(uuid),public.request_business_card_estimate(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_live_business_card(uuid),public.request_business_card_estimate(uuid,uuid,text,text,text) to anon,authenticated;

-- Only authorized office users see publication controls; public reads never return business IDs.
alter function private.business_card_state(uuid) rename to business_card_state_before_live;
revoke all on function private.business_card_state_before_live(uuid) from public,anon,authenticated,service_role;
create function private.business_card_state(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.business_card_state_before_live(b);
 return result||jsonb_build_object('live_requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select id,body,created_at from public.messages where business_id=b and provider='business_card' and direction='inbound' order by created_at desc,id desc limit 20)x),'live_card',(select jsonb_build_object('url','https://finviant.com/?business_card='||public_id,'published',published) from private.business_card_publications where business_id=b));
end $$;
revoke all on function private.business_card_state(uuid) from public,anon,authenticated,service_role;
grant execute on function private.business_card_state(uuid) to authenticated;
create or replace function public.get_business_card(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.business_card_state(p_business)$$;
