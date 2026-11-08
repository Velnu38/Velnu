-- Recheck current owner role as well as creating identity.
create or replace function private.business_onboarding_request(p_business uuid,p_channels text,p_complete boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.businesses;s private.business_onboarding;
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verify your account before setup.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business;
 if b.id is null or not exists(select 1 from public.business_members where business_id=p_business and user_id=auth.uid()) then raise exception 'Not authorized.' using errcode='42501';end if;
 if b.created_by_user_id is distinct from auth.uid() or not exists(select 1 from public.business_members where business_id=p_business and user_id=auth.uid() and role='owner') then
  if p_channels is not null or p_complete then raise exception 'Only the business owner can complete initial setup.' using errcode='42501';end if;
  return jsonb_build_object('required',false);
 end if;
 select * into s from private.business_onboarding where business_id=p_business for update;
 if not found then return jsonb_build_object('required',false);end if;
 if p_channels is not null or p_complete then
  if s.completed_at is not null then return jsonb_build_object('required',false,'channels',s.channels,'completed',true);end if;
  if p_channels is not null then
   if p_channels not in ('email','text','both') then raise exception 'Choose Email, Text or Both.' using errcode='22023';end if;
   s.channels:=p_channels;
  end if;
  if nullif(btrim(b.name),'') is null or s.channels is null then raise exception 'Enter a business name and select a sending method.' using errcode='22023';end if;
  if s.channels in ('email','both') and coalesce(b.email,'') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Enter a valid business reply email.' using errcode='22023';end if;
  if s.channels in ('text','both') and regexp_replace(coalesce(b.phone,''),'[^0-9]','','g') !~ '^[0-9]{10,15}$' then raise exception 'Enter a valid mobile number.' using errcode='22023';end if;
  update private.business_onboarding set channels=s.channels,completed_at=case when p_complete then now() else null end where business_id=p_business returning * into s;
 end if;
 return jsonb_build_object('required',s.completed_at is null,'channels',s.channels,'completed',s.completed_at is not null);
end $$;
