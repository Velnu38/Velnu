-- Five named Pro seats; owner-managed invitations and module access.
-- Authorization is checked from current membership on every request, never JWT metadata.
alter table public.business_members add column access_modules text[] not null default array['calendar','jobs','billing','finances'];
alter table public.business_members add constraint member_modules_valid check(access_modules <@ array['calendar','jobs','billing','finances']::text[]);

create function private.is_primary_owner(b uuid, actor uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select actor is not null and exists(select 1 from public.businesses x join public.business_members m on m.business_id=x.id
 where x.id=b and x.created_by_user_id=actor and m.user_id=actor and m.role='owner');
$$;
create function private.member_module_access(b uuid, actor uuid, feature text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.business_members m where m.business_id=b and m.user_id=actor
 and (private.is_primary_owner(b,actor) or (feature=any(m.access_modules)
 and (feature not in('billing','finances') or m.role in('owner','admin','office')))));
$$;
create function public.has_workspace_access(p_business uuid,p_module text) returns boolean
language sql stable security invoker set search_path='' as $$ select private.member_module_access(p_business,auth.uid(),p_module) $$;
revoke all on function private.is_primary_owner(uuid,uuid),private.member_module_access(uuid,uuid,text),public.has_workspace_access(uuid,text) from public,anon;
grant execute on function private.is_primary_owner(uuid,uuid),private.member_module_access(uuid,uuid,text),public.has_workspace_access(uuid,text) to authenticated,service_role;

create table private.team_invitations(
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 email text not null check(length(email)<=254 and email=lower(btrim(email)) and email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
 role text not null check(role in('office','technician','viewer')), access_modules text[] not null check(access_modules <@ array['calendar','jobs','billing','finances']::text[]),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz, revoked_at timestamptz, accepted_by uuid references auth.users(id)
);
create index team_invites_business on private.team_invitations(business_id,expires_at);
alter table private.team_invitations enable row level security;
create table private.team_audit(id bigint generated always as identity primary key,business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid,action text not null,target_id uuid,created_at timestamptz not null default now());
alter table private.team_audit enable row level security;
-- No direct membership writes from the browser, including by an administrator.
revoke insert,update,delete on public.business_members from anon,authenticated;

create function private.team_state(b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can manage users' using errcode='42501'; end if;
 return jsonb_build_object('seat_limit',case when private.is_pro(b) then 5 else 1 end,'pro',private.is_pro(b),
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'access_modules',m.access_modules,'primary_owner',u.id=x.created_by_user_id) order by m.created_at)
 from public.business_members m join auth.users u on u.id=m.user_id join public.businesses x on x.id=m.business_id where m.business_id=b),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'access_modules',i.access_modules,'expires_at',i.expires_at) order by i.created_at)
 from private.team_invitations i where i.business_id=b and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb));
end $$;
create function public.get_team_settings(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.team_state(p_business)$$;

create function private.reserve_team_invitation(b uuid,address text,member_role text,modules text[],hash text,replace_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare seats integer;invite_id uuid; business_name text;
begin
 perform 1 from public.businesses where id=b for update;
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can invite users' using errcode='42501';end if;
 if not private.is_pro(b) then raise exception 'Team invitations require an active Pro plan' using errcode='42501';end if;
 address:=lower(btrim(address));
 if member_role is null or member_role not in('office','technician','viewer') or modules is null or not(modules <@ array['calendar','jobs','billing','finances']::text[]) then raise exception 'Invalid team permissions' using errcode='22023';end if;
 if member_role in('technician','viewer') and modules && array['billing','finances'] then raise exception 'This role cannot access financial documents' using errcode='22023';end if;
 if exists(select 1 from public.business_members m join auth.users u on u.id=m.user_id where m.business_id=b and lower(u.email)=address) then raise exception 'This person is already a member' using errcode='23505';end if;
 if (select count(*) from private.team_audit where business_id=b and action='invited' and created_at>now()-interval '1 hour')>=20 then raise exception 'Invitation rate limit reached. Try later.' using errcode='P0001';end if;
 if replace_id is not null then
  update private.team_invitations set revoked_at=now() where id=replace_id and business_id=b and accepted_at is null and revoked_at is null;
  if not found then raise exception 'Invitation unavailable' using errcode='P0002';end if;
 end if;
 if exists(select 1 from private.team_invitations where business_id=b and email=address and accepted_at is null and revoked_at is null and expires_at>now()) then raise exception 'An invitation is already pending for this email' using errcode='23505';end if;
 select (select count(*) from public.business_members where business_id=b)+(select count(*) from private.team_invitations where business_id=b and accepted_at is null and revoked_at is null and expires_at>now()) into seats;
 if seats>=5 then raise exception 'All 5 Pro seats are in use or reserved' using errcode='23514';end if;
 insert into private.team_invitations(business_id,email,role,access_modules,token_hash,created_by) values(b,address,member_role,modules,hash,auth.uid()) returning id into invite_id;
 insert into private.team_audit(business_id,actor_id,action,target_id) values(b,auth.uid(),'invited',invite_id);
 select name into business_name from public.businesses where id=b;
 return jsonb_build_object('id',invite_id,'email',address,'business_name',business_name,'expires_at',now()+interval '7 days');
end $$;
create function public.reserve_team_invitation(p_business uuid,p_email text,p_role text,p_modules text[],p_hash text,p_replace uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.reserve_team_invitation(p_business,p_email,p_role,p_modules,p_hash,p_replace)$$;

create function private.manage_team(b uuid,target uuid,action text,member_role text default null,modules text[] default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.businesses where id=b for update;
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can manage users' using errcode='42501';end if;
 if action='revoke' then
  update private.team_invitations set revoked_at=now() where id=target and business_id=b and accepted_at is null and revoked_at is null;
 elsif action in('update','remove') then
  if target=auth.uid() or exists(select 1 from public.business_members where business_id=b and user_id=target and role='owner') then raise exception 'The owner cannot be changed here' using errcode='42501';end if;
  if action='remove' then delete from public.business_members where business_id=b and user_id=target;
  else
   if member_role is null or member_role not in('office','technician','viewer') or modules is null or not(modules <@ array['calendar','jobs','billing','finances']::text[]) or (member_role in('technician','viewer') and modules && array['billing','finances']) then raise exception 'Invalid team permissions' using errcode='22023';end if;
   update public.business_members set role=member_role,access_modules=modules where business_id=b and user_id=target;
  end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 if not found then raise exception 'Member or invitation unavailable' using errcode='P0002';end if;
 insert into private.team_audit(business_id,actor_id,action,target_id) values(b,auth.uid(),action,target);
end $$;
create function public.manage_team_member(p_business uuid,p_target uuid,p_action text,p_role text default null,p_modules text[] default null) returns void
language sql security invoker set search_path='' as $$select private.manage_team(p_business,p_target,p_action,p_role,p_modules)$$;

create function private.accept_team_invitation(hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation private.team_invitations%rowtype;bid uuid;address text;
begin
 if auth.uid() is null then raise exception 'Sign in to accept the invitation' using errcode='42501';end if;
 select business_id into bid from private.team_invitations where token_hash=hash;
 if bid is null then raise exception 'Invitation invalid or expired' using errcode='22023';end if;
 perform 1 from public.businesses where id=bid for update;
 select * into invitation from private.team_invitations where token_hash=hash for update;
 select lower(email) into address from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if address is distinct from invitation.email then raise exception 'Sign in with the verified email address that was invited' using errcode='42501';end if;
 if invitation.accepted_by=auth.uid() and exists(select 1 from public.business_members where business_id=bid and user_id=auth.uid()) then return bid;end if;
 if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() or not private.is_pro(bid) or not private.is_primary_owner(bid,invitation.created_by) then raise exception 'Invitation invalid or expired' using errcode='22023';end if;
 if not private.velnu_has_accepted_terms() then raise exception 'Accept the user agreement before joining' using errcode='42501';end if;
 if (select count(*) from public.business_members where business_id=bid)>=5 then raise exception 'All 5 Pro seats are in use' using errcode='23514';end if;
 insert into public.business_members(business_id,user_id,role,access_modules) values(bid,auth.uid(),invitation.role,invitation.access_modules) on conflict(business_id,user_id) do nothing;
 update private.team_invitations set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
 insert into private.team_audit(business_id,actor_id,action,target_id) values(bid,auth.uid(),'accepted',invitation.id);
 return bid;
end $$;
create function public.accept_team_invitation(p_hash text) returns uuid language sql security invoker set search_path='' as $$select private.accept_team_invitation(p_hash)$$;

-- Restrictive policies intersect existing role/tenant protections, including direct REST requests.
do $$declare spec record;begin
 for spec in select * from (values ('jobs','jobs'),('appointments','calendar'),('reminders','calendar'),('document_schedules','calendar'),('invoices','billing'),('invoice_items','billing'),('estimates','billing'),('estimate_items','billing'),('change_orders','billing'),('change_order_items','billing'),('document_approval_links','billing'),('messages','billing'),('payments','billing'),('bookkeeping_entries','finances'),('quickbooks_connections','finances'),('quickbooks_transactions','finances')) as t(tab,feature) loop
  if to_regclass('public.'||spec.tab) is not null then
   execute format('create policy owner_module_access on public.%I as restrictive for all to authenticated using(private.member_module_access(business_id,auth.uid(),%L)) with check(private.member_module_access(business_id,auth.uid(),%L))',spec.tab,spec.feature,spec.feature);
  end if;
 end loop;
end $$;
-- Photos inherit access to their parent. Storage policies already check record_photos under RLS.
create policy owner_module_access on public.record_photos as restrictive for all to authenticated
using(private.member_module_access(business_id,auth.uid(),case when job_id is not null then 'jobs' else 'billing' end))
with check(private.member_module_access(business_id,auth.uid(),case when job_id is not null then 'jobs' else 'billing' end));
-- Prevent finance leaks through record expense rows when that parent area is disabled.
create policy owner_parent_access on public.bookkeeping_entries as restrictive for all to authenticated
using((job_id is null or private.member_module_access(business_id,auth.uid(),'jobs')) and ((invoice_id is null and estimate_id is null) or private.member_module_access(business_id,auth.uid(),'billing')))
with check((job_id is null or private.member_module_access(business_id,auth.uid(),'jobs')) and ((invoice_id is null and estimate_id is null) or private.member_module_access(business_id,auth.uid(),'billing')));
-- The assistant can span modules; restricted members cannot use it to bypass a hidden area.
create policy owner_module_access on public.ai_actions as restrictive for all to authenticated
using(private.member_module_access(business_id,auth.uid(),'billing') and private.member_module_access(business_id,auth.uid(),'finances') and private.member_module_access(business_id,auth.uid(),'jobs') and private.member_module_access(business_id,auth.uid(),'calendar'))
with check(private.member_module_access(business_id,auth.uid(),'billing') and private.member_module_access(business_id,auth.uid(),'finances') and private.member_module_access(business_id,auth.uid(),'jobs') and private.member_module_access(business_id,auth.uid(),'calendar'));

-- Document defaults are owner-controlled and copied into new invoices by the existing atomic document functions.
alter table public.business_settings add column default_tax_rate numeric(5,2) not null default 0 check(default_tax_rate between 0 and 100);
alter table public.business_settings add column pricing_adjustment_percent numeric(5,2) not null default 0 check(pricing_adjustment_percent between 0 and 25);
create policy primary_owner_insert on public.business_settings as restrictive for insert to authenticated with check(private.is_primary_owner(business_id));
create policy primary_owner_update on public.business_settings as restrictive for update to authenticated using(private.is_primary_owner(business_id)) with check(private.is_primary_owner(business_id));
create policy primary_owner_delete on public.business_settings as restrictive for delete to authenticated using(private.is_primary_owner(business_id));
create policy module_settings_read on public.business_settings as restrictive for select to authenticated using(private.member_module_access(business_id,auth.uid(),'billing'));

-- Payment destinations cannot be replaced by employees, even via direct REST.
create function private.guard_invoice_destinations() returns trigger language plpgsql set search_path='' as $$
declare settings public.business_settings%rowtype;
begin
 if auth.uid() is null then return new;end if;
 if tg_op='INSERT' then
  select * into settings from public.business_settings where business_id=new.business_id;
  if new.payment_links is distinct from coalesce(settings.payment_links,'[]'::jsonb) or new.payment_instructions is distinct from coalesce(settings.payment_instructions,'') then
   if not private.is_primary_owner(new.business_id) then raise exception 'Only the primary owner can set payment destinations' using errcode='42501';end if;
  end if;
 elsif (new.payment_links is distinct from old.payment_links or new.payment_instructions is distinct from old.payment_instructions) and not private.is_primary_owner(new.business_id) then
  raise exception 'Only the primary owner can change payment destinations' using errcode='42501';
 end if;
 return new;
end $$;
create trigger owner_invoice_destinations before insert or update on public.invoices for each row execute function private.guard_invoice_destinations();

-- Billing mapping is provisioned only by the verified billing service; never supplied by a browser.
create table private.business_billing(business_id uuid primary key references public.businesses(id) on delete cascade,
 stripe_customer_id text unique not null check(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 stripe_subscription_id text unique not null check(stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),livemode boolean not null default false);
alter table private.business_billing enable row level security;
create function private.billing_binding(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can manage the subscription' using errcode='42501';end if;
 return (select to_jsonb(x)-'business_id' from private.business_billing x where business_id=b);
end $$;
create function public.get_billing_binding(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.billing_binding(p_business)$$;

-- Grants are deliberately explicit: private helpers authenticate the caller even behind invoker wrappers.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('team_state','reserve_team_invitation','manage_team','accept_team_invitation','billing_binding'))
 or (n.nspname='public' and p.proname in('get_team_settings','reserve_team_invitation','manage_team_member','accept_team_invitation','get_billing_binding')) loop
  execute format('revoke all on function %s from public,anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;

-- Returning invitees skip personal plan selection; only their own membership marker is exposed.
create function private.membership_entry() returns uuid language sql stable security definer set search_path='' as $$
 select business_id from public.business_members where user_id=auth.uid() order by created_at limit 1;
$$;
create function public.get_membership_entry() returns uuid language sql stable security invoker set search_path='' as $$select private.membership_entry()$$;
revoke all on function private.membership_entry(),public.get_membership_entry() from public,anon;
grant execute on function private.membership_entry(),public.get_membership_entry() to authenticated;
create policy primary_owner_profile on public.businesses as restrictive for update to authenticated using(private.is_primary_owner(id)) with check(private.is_primary_owner(id));

create function private.full_workspace_access(b uuid,actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.member_module_access(b,actor,'calendar') and private.member_module_access(b,actor,'jobs') and private.member_module_access(b,actor,'billing') and private.member_module_access(b,actor,'finances');
$$;
revoke all on function private.full_workspace_access(uuid,uuid) from public,anon;
grant execute on function private.full_workspace_access(uuid,uuid) to authenticated,service_role;

CREATE OR REPLACE FUNCTION private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b private.finviant_ai_attempt_budget%rowtype; usage jsonb; limit_value integer; stored_usage integer;
  period_start date:=date_trunc('month',now() at time zone 'UTC')::date; next_attempt integer;
begin
 if not private.full_workspace_access(p_business_id,auth.uid()) then raise exception 'Assistant access denied' using errcode='42501';end if;
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

CREATE OR REPLACE FUNCTION private.finviant_execute_ai_mutation(p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype; f jsonb; r text; requested text;
 cid uuid; jid uuid; iid uuid; n integer; title_text text; lines jsonb;
 payload jsonb; created jsonb; result jsonb; amount numeric; method text;
 starts timestamptz; ends timestamptz;
begin
 if not private.full_workspace_access((select business_id from public.ai_actions where id=p_action_id and user_id=auth.uid()),auth.uid()) then raise exception 'Assistant access denied' using errcode='42501';end if;
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 select * into a from public.ai_actions where id=p_action_id and user_id=auth.uid() for update;
 if not found then raise exception 'Action not found' using errcode='P0002';end if;
 if a.status='executed' then
   return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);
 end if;
 if a.status<>'confirmed' or a.requires_confirmation is distinct from true or a.confirmed_at is null then
   raise exception 'Action requires confirmation' using errcode='23514';end if;
 if a.intent not in ('create_customer','create_job','schedule_job','create_invoice','create_estimate','create_change_order','record_payment') then
   raise exception 'Unsupported action' using errcode='22023';end if;
 select bm.role into r from public.business_members bm
   where bm.business_id=a.business_id and bm.user_id=auth.uid();
 if r is null or not private.velnu_has_accepted_terms() then
   raise exception 'Business access denied' using errcode='42501';end if;
 if a.intent in ('create_invoice','create_estimate','create_change_order','record_payment') and r not in ('owner','admin','office') then
   raise exception 'Finance role required' using errcode='42501';end if;
 if a.intent in ('create_customer','create_job','schedule_job') and r not in ('owner','admin','office','technician') then
   raise exception 'Write permission required' using errcode='42501';end if;
 f:=coalesce(a.parsed_payload->'fields','{}'::jsonb);
 if a.intent='create_customer' then
    requested:=btrim(coalesce(f->>'customer_name',''));
    if requested='' and btrim(coalesce(f->>'company_name',''))='' then raise exception 'Customer name or company required' using errcode='22023';end if;
    if length(requested)>180 then raise exception 'Name too long' using errcode='22023';end if;
    insert into public.customers(business_id,first_name,last_name,company,email,phone,notes)
    values(a.business_id,nullif(split_part(requested,' ',1),''),
      nullif(btrim(substr(requested,length(split_part(requested,' ',1))+1)),''),
      nullif(btrim(f->>'company_name'),''),
      nullif(btrim(f->>'email'),''),
      nullif(btrim(f->>'phone'),''),
      nullif(btrim(f->>'notes'),'')) returning to_jsonb(customers) into created;
    result:=jsonb_build_object('customer',created);
 else
    requested:=lower(btrim(regexp_replace(coalesce(nullif(f->>'customer_name',''),f->>'company_name',''),'\s+',' ','g')));
    if requested='' then raise exception 'CUSTOMER_REQUIRED' using errcode='22023';end if;
    select count(*),min(c.id::text)::uuid into n,cid from public.customers c
    where c.business_id=a.business_id and coalesce(c.archived,false)=false
      and (lower(btrim(concat_ws(' ',c.first_name,c.last_name)))=requested or lower(btrim(coalesce(c.company,'')))=requested);
    if n=0 then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023';end if;
    if n>1 then raise exception 'CUSTOMER_AMBIGUOUS' using errcode='22023';end if;
    if a.intent='create_job' then
       title_text:=btrim(coalesce(nullif(f->>'job_title',''),f->>'job_description',''));
       if length(title_text) not between 1 and 200 then raise exception 'Job title must be 1-200 characters' using errcode='22023';end if;
       insert into public.jobs(business_id,customer_id,title,description,status)
       values(a.business_id,cid,title_text,nullif(f->>'job_description',''),'lead') returning to_jsonb(jobs) into created;
       result:=jsonb_build_object('job',created);
    elsif a.intent='schedule_job' then
       title_text:=btrim(coalesce(nullif(f->>'job_title',''),f->>'job_description',''));
       if length(title_text) not between 1 and 200 then raise exception 'Job title must be 1-200 characters' using errcode='22023';end if;
       if coalesce(f->>'scheduled_at_text','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
          raise exception 'Scheduled start requires an ISO date and explicit timezone' using errcode='22023';end if;
       starts:=(f->>'scheduled_at_text')::timestamptz;
       ends:=nullif(f->>'scheduled_end_text','')::timestamptz;
       if ends is not null and ends<=starts then raise exception 'End must follow start' using errcode='22023';end if;
       select public.create_scheduled_job(a.business_id,a.id,jsonb_build_object('customer_id',cid,'property_id',null,
          'title',title_text,'description',nullif(f->>'job_description',''),'scheduled_start',starts,'scheduled_end',ends)) into created;
       result:=jsonb_build_object('job',created,'appointment',jsonb_build_object('id',created->>'appointment_id'));
    elsif a.intent in ('create_invoice','create_estimate','create_change_order') then
       lines:=f->'line_items';
       if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 50 then
         raise exception 'Between 1 and 50 line items required' using errcode='22023';end if;
       if a.intent in ('create_invoice','create_estimate') then
          payload:=jsonb_build_object('customer_id',cid,'items',lines,'notes',nullif(f->>'notes',''),'customer_message',null,
            'due_date',case when a.intent='create_invoice' then nullif(f->>'due_date_text','') else null end,
            'expires_on',case when a.intent='create_estimate' then nullif(f->>'due_date_text','') else null end);
          select public.create_document(a.business_id,case when a.intent='create_invoice' then 'invoice' else 'estimate' end,
            a.id,payload) into created;
          result:=case when a.intent='create_invoice' then jsonb_build_object('invoice',created)
                       else jsonb_build_object('estimate',created) end;
       else
          requested:=lower(btrim(coalesce(f->>'job_title','')));
          if requested<>'' then
             select count(*),min(j.id::text)::uuid into n,jid from public.jobs j
             where j.business_id=a.business_id and j.customer_id=cid and j.status<>'canceled'
               and lower(btrim(j.title))=requested;
          else
             select count(*),min(j.id::text)::uuid into n,jid from public.jobs j
             where j.business_id=a.business_id and j.customer_id=cid and j.status not in ('canceled','completed');
          end if;
          if n=0 then raise exception 'JOB_NOT_FOUND' using errcode='22023';end if;
          if n>1 then raise exception 'JOB_AMBIGUOUS' using errcode='22023';end if;
          title_text:=btrim(coalesce(nullif(f->>'change_order_title',''),nullif(f->>'job_description',''),lines->0->>'description',''));
          payload:=jsonb_build_object('customer_id',cid,'job_id',jid,'estimate_id',null,
            'title',title_text,'description',nullif(f->>'job_description',''),'reason',nullif(f->>'notes',''),
            'schedule_impact_days',coalesce((f->>'schedule_impact_days')::integer,0),
            'schedule_note',nullif(f->>'schedule_note',''),'notes',nullif(f->>'notes',''),
            'customer_message',null,'items',lines);
          select public.create_change_order_document(a.business_id,a.id,payload) into created;
          result:=jsonb_build_object('change_order',created,'job',jsonb_build_object('id',jid));
       end if;
    elsif a.intent='record_payment' then
       amount:=nullif(f->>'payment_amount','')::numeric;
       if amount is null or amount<=0 or amount<>round(amount,2) then raise exception 'Valid payment amount required' using errcode='22023';end if;
       if nullif(btrim(f->>'invoice_number'),'') is not null then
          select count(*),min(i.id::text)::uuid into n,iid from public.invoices i
          where i.business_id=a.business_id and i.customer_id=cid and
            i.invoice_number=(f->>'invoice_number') and i.status not in ('draft','void') and i.balance_due>0;
       else
          select count(*),min(i.id::text)::uuid into n,iid from public.invoices i
          where i.business_id=a.business_id and i.customer_id=cid
            and i.status not in ('draft','void') and i.balance_due>0;
       end if;
       if n=0 then raise exception 'NO_ELIGIBLE_INVOICE' using errcode='22023';end if;
       if n>1 then raise exception 'INVOICE_AMBIGUOUS' using errcode='22023';end if;
       method:=coalesce(nullif(f->>'payment_method',''),'other');
       if method not in ('cash','check','card','ach','other') then method:='other';end if;
       select public.record_manual_payment(a.business_id,iid,a.id,amount,method,
         coalesce(nullif(f->>'notes',''),'Recorded through Finviant Office AI')) into created;
       result:=jsonb_build_object('payment',created,
          'invoice',(select jsonb_build_object('id',id,'invoice_number',invoice_number,'status',status,
                     'amount_paid',amount_paid,'balance_due',balance_due)
                     from public.invoices where id=iid and business_id=a.business_id));
    end if;
 end if;
 update public.ai_actions set status='executed',executed_at=now(),
    parsed_payload=a.parsed_payload||jsonb_build_object('execution_result',result),error_message=null where id=a.id;
 return jsonb_build_object('action_id',a.id,'status','executed','result',result,'already_executed',false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.finviant_ai_decision(p_action_id uuid, p_decision text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype; r text;
begin
 if not private.full_workspace_access((select business_id from public.ai_actions where id=p_action_id and user_id=auth.uid()),auth.uid()) then raise exception 'Assistant access denied' using errcode='42501';end if;
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_action_id is null or p_decision is null or p_decision not in ('confirmed','rejected') then
    raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into a from public.ai_actions where id=p_action_id and user_id=auth.uid() for update;
  if not found then raise exception 'Action not found' using errcode='P0002'; end if;
  select bm.role into r from public.business_members bm
    where bm.business_id=a.business_id and bm.user_id=auth.uid() for share;
  if r is null or not private.velnu_has_accepted_terms() then
    raise exception 'Business access denied' using errcode='42501'; end if;
  if a.intent in ('create_invoice','create_estimate','record_payment','create_change_order') then
    if r not in ('owner','admin','office') then raise exception 'Finance role required' using errcode='42501'; end if;
  elsif a.intent in ('create_customer','create_job','schedule_job') then
    if r not in ('owner','admin','office','technician') then raise exception 'Write permission required' using errcode='42501'; end if;
  else raise exception 'Unsupported action' using errcode='22023'; end if;
  if p_decision='confirmed' and (a.requires_confirmation is distinct from true or nullif(btrim(a.parsed_payload->>'clarification_question'),'') is not null) then
    raise exception 'Clarify the request before confirming' using errcode='23514'; end if;
  if p_decision='confirmed' and a.status in ('confirmed','executed') and a.confirmed_at is not null then return; end if;
  if p_decision='rejected' and a.status='rejected' then return; end if;
  if a.status<>'proposed' and not (p_decision='rejected' and a.status='confirmed') then
    raise exception 'This action cannot accept that decision' using errcode='23514'; end if;
  update public.ai_actions set status=p_decision,
    confirmed_at=case when p_decision='confirmed' then now() else a.confirmed_at end where id=a.id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.execute_confirmed_action(target_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype;f jsonb;r jsonb;customer uuid;matches integer;requested text;obj uuid;job uuid;doc jsonb;item jsonb;k integer:=0;kind text;start_at timestamptz;end_at timestamptz;
begin
 if not private.full_workspace_access((select business_id from public.ai_actions where id=target_action_id and user_id=auth.uid()),auth.uid()) then raise exception 'Assistant access denied' using errcode='42501';end if;
if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501';end if;
select * into a from public.ai_actions where id=target_action_id and user_id=auth.uid() for update;
if not found or not private.can_write_business(a.business_id) or not private.is_pro(a.business_id) then raise exception 'This action requires Pro and access to the business' using errcode='42501';end if;
if a.status='executed' then return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);end if;
if a.parsed_payload->>'clarification_question' is not null then raise exception 'Clarify the command before executing';end if;
if a.intent in('list_unpaid_invoices','customer_history','business_summary') then if a.status not in('proposed','confirmed') then raise exception 'Action is not ready';end if;elsif a.status<>'confirmed' then raise exception 'Review and confirm this action first';end if;f:=a.parsed_payload->'fields';
if a.intent in('create_job','create_invoice','create_estimate','schedule_job','create_change_order','customer_history') then requested:=lower(regexp_replace(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'\s+',' ','g'));if requested='' then raise exception 'Specify the customer name';end if;select count(*),min(id::text)::uuid into matches,customer from public.customers where business_id=a.business_id and not archived and(lower(regexp_replace(btrim(concat_ws(' ',first_name,last_name)),'\s+',' ','g'))=requested or lower(regexp_replace(btrim(coalesce(company,'')),'\s+',' ','g'))=requested);if matches<>1 then raise exception 'Found % matching customers. Use the manual form to select the correct customer.',matches;end if;end if;
case a.intent
when 'create_customer' then
if nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null then raise exception 'Customer name required';end if;
insert into public.customers(business_id,first_name,last_name,company,email,phone,notes) values(a.business_id,nullif(split_part(coalesce(f->>'customer_name',''),' ',1),''),nullif(regexp_replace(coalesce(f->>'customer_name',''),'^[^ ]+\s*',''),''),f->>'company_name',f->>'email',f->>'phone',f->>'notes') returning id into obj;select jsonb_build_object('customer',to_jsonb(c)) into r from public.customers c where id=obj;
when 'create_invoice','create_estimate' then
kind:=case when a.intent='create_invoice' then 'invoice' else 'estimate' end;doc:=public.create_document(a.business_id,kind,a.id,jsonb_build_object('customer_id',customer,'items',f->'line_items','due_date',case when kind='invoice' then f->>'due_date_text' else null end,'notes',f->>'notes'));r:=jsonb_build_object(kind,doc);
when 'record_payment' then
select count(*),min(id::text)::uuid into matches,obj from public.invoices where business_id=a.business_id and invoice_number=f->>'invoice_number' and(nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null or customer_id in(select id from public.customers where business_id=a.business_id and(lower(btrim(concat_ws(' ',first_name,last_name)))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))) or lower(btrim(company))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))))));if matches<>1 then raise exception 'Specify the exact invoice number';end if;doc:=public.record_manual_payment(a.business_id,obj,a.id,(f->>'payment_amount')::numeric,coalesce(f->>'payment_method','other'),coalesce(f->>'notes','Manually verified payment, entered with AI assistance'));r:=jsonb_build_object('payment',doc);
when 'create_job','schedule_job' then
if nullif(btrim(coalesce(f->>'job_title',f->>'job_description','')),'') is null then raise exception 'Job title required';end if;
if a.intent='schedule_job' then start_at:=(f->>'scheduled_at_text')::timestamptz;end_at:=(f->>'scheduled_end_text')::timestamptz;if start_at is null or start_at<now() or(end_at is not null and end_at<start_at) then raise exception 'Use a future start time and a valid end time';end if;end if;
insert into public.jobs(business_id,customer_id,title,description,status,scheduled_start,scheduled_end) values(a.business_id,customer,coalesce(f->>'job_title',f->>'job_description'),f->>'job_description',case when a.intent='schedule_job' then 'scheduled' else 'lead' end,start_at,end_at) returning id into job;
if a.intent='schedule_job' then insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status) values(a.business_id,customer,job,coalesce(f->>'job_title',f->>'job_description'),start_at,end_at,'scheduled');end if;
select jsonb_build_object('job',to_jsonb(j)) into r from public.jobs j where id=job;
when 'create_change_order' then
select count(*),min(id::text)::uuid into matches,job from public.jobs where business_id=a.business_id and customer_id=customer and status not in('canceled','completed') and(nullif(f->>'job_title','') is null or lower(btrim(title))=lower(btrim(f->>'job_title')));
if matches<>1 then raise exception 'Specify exactly one active job for this customer';end if;if jsonb_typeof(f->'line_items') is distinct from 'array' or jsonb_array_length(f->'line_items') not between 1 and 50 then raise exception 'Add 1 to 50 change-order line items';end if;
insert into public.change_orders(business_id,customer_id,job_id,title,description,reason,schedule_impact_days,schedule_note,status) values(a.business_id,customer,job,coalesce(f->>'change_order_title',f->>'job_description','Change order'),f->>'job_description',f->>'notes',coalesce((f->>'schedule_impact_days')::integer,0),f->>'schedule_note','draft') returning id into obj;
for item in select value from jsonb_array_elements(f->'line_items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(a.business_id,obj,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'tax_rate')::numeric,0),k);k:=k+1;end loop;
select jsonb_build_object('change_order',to_jsonb(c)) into r from public.change_orders c where id=obj;
when 'business_summary' then r:=public.get_dashboard_metrics(a.business_id);r:=r||jsonb_build_object('customers',r->'customer_count','active_jobs',(select count(*) from public.jobs where business_id=a.business_id and status not in('completed','canceled')));
when 'list_unpaid_invoices' then r:=public.get_dashboard_metrics(a.business_id);r:=jsonb_build_object('count',r->'open_count','total_outstanding',r->'outstanding','invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,balance_due,due_date from public.invoices where business_id=a.business_id and status not in('draft','void') and balance_due>0 order by due_date nulls last limit 50)i),'[]'::jsonb),'list_limit',50);
when 'customer_history' then r:=jsonb_build_object('customer_id',customer,'invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,status,total,balance_due from public.invoices where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)i),'[]'::jsonb),'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from(select id,title,status from public.jobs where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)j),'[]'::jsonb));
else raise exception 'This action is not supported';end case;
update public.ai_actions set status='executed',executed_at=now(),parsed_payload=parsed_payload||jsonb_build_object('execution_result',r) where id=a.id;return jsonb_build_object('action_id',a.id,'status','executed','result',r);
end$function$;

create function private.html_escape(value text) returns text language sql immutable set search_path='' as $$select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;')$$;
revoke all on function private.html_escape(text) from public,anon,authenticated;
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
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\n'||coalesce(d->>'payment_instructions','')||E'\nPayments are handled by the business directly with its external provider. Include the invoice number with payment.'||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||(l->>'url'),'' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'');
  update public.invoices set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';
 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';
  if p_kind='estimate' then update public.estimates set status='sent' where id=p_document and business_id=p_business and status='draft';else update public.change_orders set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';end if;
 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if p_kind='invoice' then new_payload:=new_payload||jsonb_build_object('html','<div style="font-family:Arial,sans-serif;color:#193843"><pre style="white-space:pre-wrap;font-family:inherit">'||private.html_escape(body_text)||'</pre>'||coalesce((select string_agg('<a style="display:inline-block;padding:12px 18px;margin:6px;border:1px solid #b7d7ce;border-radius:8px;color:#174d43;text-decoration:none" href="'||private.html_escape(l->>'url')||'">Pay with '||private.html_escape(case l->>'provider' when 'paypal' then 'PayPal' when 'venmo' then 'Venmo' when 'cashapp' then 'Cash App' when 'stripe' then 'Stripe' else 'Payment provider' end)||'</a>','' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'')||'</div>');end if;
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$;

CREATE OR REPLACE FUNCTION public.claim_document_email(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not private.member_module_access(o.business_id,o.actor_id,'billing') then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from private.business_entitlements where business_id=o.business_id and plan in('basic','pro') and (valid_until is null or valid_until>now())) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$;

-- Supporting records must not reveal approvals or assistant transcripts from a disabled area.
create policy owner_module_access on public.document_approvals as restrictive for all to authenticated
using(private.member_module_access(business_id,auth.uid(),'billing')) with check(private.member_module_access(business_id,auth.uid(),'billing'));
create policy owner_module_access on public.voice_transcriptions as restrictive for all to authenticated
using(private.full_workspace_access(business_id,auth.uid())) with check(private.full_workspace_access(business_id,auth.uid()));
create policy primary_owner_brand_insert on public.business_branding as restrictive for insert to authenticated with check(private.is_primary_owner(business_id));
create policy primary_owner_brand_update on public.business_branding as restrictive for update to authenticated using(private.is_primary_owner(business_id)) with check(private.is_primary_owner(business_id));
create policy primary_owner_brand_delete on public.business_branding as restrictive for delete to authenticated using(private.is_primary_owner(business_id));
