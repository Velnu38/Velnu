-- Off by default. The staging operator may enable team testing without granting a paid plan.
create table private.workspace_feature_flags(name text primary key,enabled boolean not null default false);
alter table private.workspace_feature_flags enable row level security;
revoke all on private.workspace_feature_flags from public,anon,authenticated;
insert into private.workspace_feature_flags(name,enabled) values('team_private_preview',false);
create function private.team_preview_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.workspace_feature_flags where name='team_private_preview'),false);
$$;
create function private.team_seat_limit(b uuid) returns integer language sql stable security definer set search_path='' as $$
 select case when private.is_pro(b) or private.team_preview_enabled() then 5 else 1 end;
$$;
revoke all on function private.team_preview_enabled(),private.team_seat_limit(uuid) from public,anon;
grant execute on function private.team_preview_enabled(),private.team_seat_limit(uuid) to authenticated,service_role;

create or replace function private.team_state(b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can manage users' using errcode='42501'; end if;
 return jsonb_build_object('seat_limit',private.team_seat_limit(b),'pro',private.is_pro(b),'team_enabled',private.team_seat_limit(b)=5,'private_preview',private.team_preview_enabled() and not private.is_pro(b),
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'access_modules',m.access_modules,'primary_owner',u.id=x.created_by_user_id) order by m.created_at)
 from public.business_members m join auth.users u on u.id=m.user_id join public.businesses x on x.id=m.business_id where m.business_id=b),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'access_modules',i.access_modules,'expires_at',i.expires_at) order by i.created_at)
 from private.team_invitations i where i.business_id=b and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb));
end $$;

create or replace function private.reserve_team_invitation(b uuid,address text,member_role text,modules text[],hash text,replace_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare seats integer;invite_id uuid; business_name text;
begin
 perform 1 from public.businesses where id=b for update;
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can invite users' using errcode='42501';end if;
 if private.team_seat_limit(b)<5 then raise exception 'Team invitations require an active Pro plan' using errcode='42501';end if;
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

create or replace function private.accept_team_invitation(hash text) returns uuid language plpgsql security definer set search_path='' as $$
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
 if invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() or private.team_seat_limit(bid)<5 or not private.is_primary_owner(bid,invitation.created_by) then raise exception 'Invitation invalid or expired' using errcode='22023';end if;
 if not private.velnu_has_accepted_terms() then raise exception 'Accept the user agreement before joining' using errcode='42501';end if;
 if (select count(*) from public.business_members where business_id=bid)>=5 then raise exception 'All 5 Pro seats are in use' using errcode='23514';end if;
 insert into public.business_members(business_id,user_id,role,access_modules) values(bid,auth.uid(),invitation.role,invitation.access_modules) on conflict(business_id,user_id) do nothing;
 update private.team_invitations set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
 insert into private.team_audit(business_id,actor_id,action,target_id) values(bid,auth.uid(),'accepted',invitation.id);
 return bid;
end $$;

CREATE OR REPLACE FUNCTION private.commerce_auxiliary_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare n bigint;lim integer;b uuid;begin b:=new.business_id;if pg_column_size(to_jsonb(new))>(case when private.is_pro(b) then 65536 else 16384 end) then raise exception 'Record is too large for this plan';end if;if tg_op='UPDATE' then if new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces';end if;return new;end if;lim:=case when tg_table_name='business_members' then private.team_seat_limit(b) when private.is_pro(b) then 20000 else 1000 end;perform pg_advisory_xact_lock(hashtextextended('storage-'||b::text||tg_table_name,0));execute format('select count(*) from public.%I where business_id=$1',tg_table_name) into n using b;if n>=lim then raise exception 'Stored % limit reached (%)',tg_table_name,lim;end if;return new;end$function$;
