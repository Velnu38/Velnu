-- Application-owned session checks; no Auth schema/configuration changes.
-- A signed JWT is insufficient after logout: bind its session to the subject.
create function private.request_session_active() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from auth.sessions s
   where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
     and (s.not_after is null or s.not_after>now())),false)
$$;
revoke all on function private.request_session_active() from public,anon,authenticated,service_role;
grant execute on function private.request_session_active() to authenticated;

-- Background service calls retain their existing actor/membership checks. Only
-- the database role selected by the gateway is trusted, never user metadata.
create function private.request_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select case when current_setting('role',true)='authenticated'
   then private.request_session_active()
   else current_setting('role',true) in ('none','postgres','service_role','calendar_worker') end
$$;
revoke all on function private.request_session_allowed() from public,anon,authenticated,service_role;
grant execute on function private.request_session_allowed() to authenticated,service_role;

-- Caller-scoped check for Edge handlers before switching to a service client.
create function public.current_session_actor() returns uuid
language sql stable security invoker set search_path='' as $$
 select case when private.request_session_active() then auth.uid() else null end
$$;
revoke all on function public.current_session_actor() from public,anon,authenticated,service_role;
grant execute on function public.current_session_actor() to authenticated;

create or replace function private.is_primary_owner(b uuid, actor uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( actor is not null and exists(select 1 from public.businesses x join public.business_members m on m.business_id=x.id
 where x.id=b and x.created_by_user_id=actor and m.user_id=actor and m.role='owner'));
$$;

create or replace function private.member_module_access(b uuid,actor uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( not private.field_mode(b,actor) and (private.effective_plan(b)='pro' or private.is_primary_owner(b,actor)) and exists(select 1 from public.business_members m where m.business_id=b and m.user_id=actor and (private.is_primary_owner(b,actor) or (feature=any(m.access_modules) and (feature not in('billing','finances') or m.role in('owner','admin','office'))))));
$$;

create or replace function private.is_business_member(target_business_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid()));
$$;

create or replace function private.has_business_role(target_business_id uuid,allowed_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid() and bm.role=any(allowed_roles)));
$$;

create or replace function private.can_write_business(target_business_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( not private.field_mode(target_business_id) and (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists(select 1 from public.business_members bm where bm.business_id=target_business_id and bm.user_id=auth.uid() and bm.role in('owner','admin','office','technician')));
$$;

create or replace function private.field_active(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.request_session_allowed() and ( coalesce(private.effective_plan(b)='pro' and private.velnu_has_accepted_terms() and exists(select 1 from private.field_accounts f join public.business_members m on m.business_id=f.business_id and m.user_id=f.user_id join private.worker_profiles w on w.business_id=f.business_id and w.id=f.worker_id where f.business_id=b and f.user_id=auth.uid() and m.role='technician' and f.enabled and w.active),false));
$$;

create or replace function private.velnu_has_accepted_terms()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.request_session_allowed() and ( auth.uid() is not null and exists(select 1 from public.user_agreement_acceptances a
    where a.user_id=auth.uid() and a.terms_accepted and a.ai_disclosure_acknowledged
      and a.electronic_records_consent and a.agreement_version in
      ('2026-10-26-v1','2026-10-26-v2','2026-10-27-v3','2026-11-06-v4','2026-11-06-v5')));
$function$;

create or replace function private.fin_access(b uuid,resource text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare m public.business_members%rowtype; c jsonb; primary_owner boolean;
begin
 if not private.request_session_allowed() or auth.uid() is null then return false;end if;
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

-- Restrictive policies AND with existing tenant/role policies. They never
-- grant access, including to internal tables which have no permissive policy.
do $session_policies$
declare t record;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
 loop
   execute format('create policy require_active_session on %I.%I as restrictive for all to authenticated using ((select private.request_session_active())) with check ((select private.request_session_active()))',t.nspname,t.relname);
 end loop;
end $session_policies$;
create policy require_active_session on storage.objects as restrictive for all to authenticated
 using ((select private.request_session_active())) with check ((select private.request_session_active()));

-- PostgREST invokes this before both table and RPC requests, including definers
-- whose implementation does not call the shared business authorization helpers.
create function public.check_request_session() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
 -- Keep separate IF statements: PostgreSQL initializes function privileges
 -- even on the unused side of a boolean AND expression.
 if current_user='authenticated' then
   if not private.request_session_active() then
     raise exception 'Your session has ended. Sign in again.' using errcode='42501';
   end if;
 end if;
end $$;
revoke all on function public.check_request_session() from public,anon,authenticated,service_role;
grant execute on function public.check_request_session() to anon,authenticated,service_role;
-- Fail rather than replacing an unrelated request hook. Applies only when this
-- candidate migration is explicitly rolled out; no hosted settings changed here.
do $request_hook$
begin
 if exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,
   lateral unnest(s.setconfig) config
   where r.rolname='authenticator' and config like 'pgrst.db_pre_request=%'
   and config<>'pgrst.db_pre_request=public.check_request_session') then
   raise exception 'Existing API request hook requires explicit composition.';
 end if;
end $request_hook$;
alter role authenticator set pgrst.db_pre_request='public.check_request_session';
notify pgrst,'reload config';
