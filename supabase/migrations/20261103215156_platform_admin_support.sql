-- Operator privileges are separate from subscriber business roles. Enabled only explicitly on staging.
create table private.platform_operators(user_id uuid primary key references auth.users(id) on delete cascade,active boolean not null default true,created_at timestamptz not null default now());
create table private.platform_admin_audit(id bigint generated always as identity primary key,actor uuid,action text not null,outcome text not null,target uuid,created_at timestamptz not null default now());
create index on private.platform_admin_audit(actor,created_at);
create table private.support_cases(
 id uuid primary key,business_id uuid not null references public.businesses(id),reporter_id uuid not null references auth.users(id),
 title text not null check(length(title) between 3 and 160),description text not null check(length(description) between 5 and 6000),
 priority text not null default 'normal' check(priority in ('low','normal','high')),
 status text not null default 'open' check(status in ('open','in_progress','waiting_on_customer','resolved','closed')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index on private.support_cases(reporter_id,created_at);
create index on private.support_cases(status,updated_at);
create table private.support_messages(
 id uuid primary key,case_id uuid not null references private.support_cases(id),actor uuid not null references auth.users(id),
 audience text not null check(audience in ('customer','internal')),body text not null check(length(body) between 1 and 4000),
 changes jsonb not null default '{}',created_at timestamptz not null default now()
);
create index on private.support_messages(case_id,created_at);
alter table private.platform_operators enable row level security;
alter table private.platform_admin_audit enable row level security;
alter table private.support_cases enable row level security;
alter table private.support_messages enable row level security;
revoke all on private.platform_operators,private.platform_admin_audit,private.support_cases,private.support_messages from public,anon,authenticated,service_role;
insert into private.workspace_feature_flags(name,enabled) values('platform_console',false) on conflict do nothing;

create function private.platform_admin_request(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<request_ctx>>
declare actor uuid:=auth.uid();operator boolean;session_ok boolean;allowed boolean;result jsonb;page integer;query text;filter text;cid uuid;mid uuid;c private.support_cases;msg private.support_messages;
begin
 if actor is null then return jsonb_build_object('error','Sign in to continue.');end if;
 if length(coalesce(p_action,''))>40 or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>12000 then return jsonb_build_object('error','Invalid request.');end if;
 if (select count(*) from private.platform_admin_audit a where a.actor=request_ctx.actor and a.created_at>now()-interval '1 minute')>=120 then return jsonb_build_object('error','Too many admin requests. Wait a minute and retry.');end if;
 operator:=coalesce((select enabled from private.workspace_feature_flags where name='platform_console'),false)
 and exists(select 1 from private.platform_operators o join auth.users u on u.id=o.user_id where o.user_id=actor and o.active and u.email_confirmed_at is not null);
 session_ok:=exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=actor);
 if not operator or not session_ok then
  insert into private.platform_admin_audit(actor,action,outcome) values(actor,left(p_action,40),'denied');
  return jsonb_build_object('error','Finviant administrator access is restricted.');
 end if;
 allowed:=coalesce(auth.jwt()->>'aal'='aal2',false) and exists(select 1 from auth.mfa_factors f where f.user_id=request_ctx.actor and f.status='verified');
 if p_action='access' then
  insert into private.platform_admin_audit(actor,action,outcome) values(actor,'access',case when allowed then 'allowed' else 'mfa_required' end);
  return jsonb_build_object('operator',true,'mfa_required',not allowed);
 end if;
 if not allowed then
  insert into private.platform_admin_audit(actor,action,outcome) values(actor,p_action,'mfa_required');
  return jsonb_build_object('error','Verify your authenticator code before opening administration.','mfa_required',true);
 end if;
 if p_action='overview' then
  result:=jsonb_build_object('checked_at',now(),'environment','Internal testing','accounts',(select count(*) from auth.users),'account_limit',10,
   'pro_workspaces',(select count(*) from private.business_entitlements where plan='pro' and (valid_until is null or valid_until>now())),
   'open_cases',(select count(*) from private.support_cases where status not in ('resolved','closed')),
   'billing','Live billing not activated','database','Connected',
   'email_queue',(select count(*) from private.finviant_email_outbox where status in ('queued','sending','uncertain')),
   'email_failures',(select count(*) from private.finviant_email_outbox where status in ('failed','reconciliation_required')),
   'provider_note','Provider delivery and payments require separate configuration and live verification.');
 elsif p_action='accounts' then
  page:=greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));query:=left(coalesce(p_input->>'search',''),120);
  select jsonb_build_object('total',(select count(*) from auth.users where position(lower(query) in lower(coalesce(email,'')))>0),'rows',coalesce(jsonb_agg(x),'[]')) into result
  from (select u.id,left(coalesce(u.email,''),1)||'***@'||split_part(coalesce(u.email,''),'@',2) email,u.created_at,u.last_sign_in_at,(u.email_confirmed_at is not null) verified,
   (select count(*) from auth.mfa_factors f where f.user_id=u.id and f.status='verified') mfa_factors,
   coalesce((select jsonb_agg(jsonb_build_object('name',b.name,'role',m.role,'plan',case when private.is_pro(b.id) then 'pro' else 'free' end)) from public.business_members m join public.businesses b on b.id=m.business_id where m.user_id=u.id),'[]') businesses
   from auth.users u where position(lower(query) in lower(coalesce(u.email,'')))>0 order by u.created_at,u.id limit 25 offset page*25) x;
 elsif p_action='cases' then
  page:=greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));filter:=coalesce(p_input->>'status','all');
  select jsonb_build_object('total',(select count(*) from private.support_cases where filter='all' or status=filter),'rows',coalesce(jsonb_agg(x),'[]')) into result
  from (select s.id,s.title,s.priority,s.status,s.version,s.created_at,s.updated_at,b.name business_name from private.support_cases s join public.businesses b on b.id=s.business_id where filter='all' or s.status=filter order by s.updated_at desc,s.id limit 25 offset page*25) x;
 elsif p_action in ('case','update_case') then
  cid:=(p_input->>'id')::uuid;select * into c from private.support_cases where id=cid for update;
  if not found then return jsonb_build_object('error','Support case unavailable.');end if;
  if p_action='update_case' then
   mid:=(p_input->>'request_id')::uuid;select * into msg from private.support_messages where id=mid;
   if found then
    if msg.case_id<>cid or msg.actor<>actor or msg.body<>btrim(p_input->>'body') or msg.audience<>p_input->>'audience' or msg.changes<>jsonb_build_object('status',p_input->>'status','priority',p_input->>'priority','version',p_input->>'version') then return jsonb_build_object('error','Retry ID belongs to another update.');end if;
   else
    if c.version is distinct from (p_input->>'version')::integer then return jsonb_build_object('error','This case changed. Reload it; your note has been preserved.','conflict',true);end if;
    if mid is null or p_input->>'status' not in ('open','in_progress','waiting_on_customer','resolved','closed') or p_input->>'priority' not in ('low','normal','high') or p_input->>'audience' not in ('customer','internal') or length(btrim(coalesce(p_input->>'body',''))) not between 1 and 4000 then return jsonb_build_object('error','Choose status, priority, note visibility and enter a note.');end if;
    insert into private.support_messages(id,case_id,actor,audience,body,changes) values(mid,cid,actor,p_input->>'audience',btrim(p_input->>'body'),jsonb_build_object('status',p_input->>'status','priority',p_input->>'priority','version',p_input->>'version'));
    update private.support_cases set status=p_input->>'status',priority=p_input->>'priority',version=version+1,updated_at=now() where id=cid returning * into c;
   end if;
  end if;
  result:=jsonb_build_object('case',to_jsonb(c),'messages',coalesce((select jsonb_agg((to_jsonb(m)-'actor')||jsonb_build_object('sender',case when m.actor=c.reporter_id then 'Customer' else 'Finviant' end) order by m.created_at,m.id) from private.support_messages m where case_id=cid),'[]'));
 elsif p_action='audit' then
  page:=greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));
  select jsonb_build_object('total',(select count(*) from private.platform_admin_audit),'rows',coalesce(jsonb_agg(x),'[]')) into result from (select id,action,outcome,target,created_at from private.platform_admin_audit order by id desc limit 25 offset page*25) x;
 else return jsonb_build_object('error','Unknown admin action.');
 end if;
 insert into private.platform_admin_audit(actor,action,outcome,target) values(actor,p_action,'allowed',cid);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
 insert into private.platform_admin_audit(actor,action,outcome) values(actor,left(p_action,40),'invalid_request');
 return jsonb_build_object('error','Invalid admin request.');
end $$;
create function public.platform_admin_request(p_action text,p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.platform_admin_request(p_action,p_input)$$;
revoke all on function private.platform_admin_request(text,jsonb),public.platform_admin_request(text,jsonb) from public,anon;
grant execute on function private.platform_admin_request(text,jsonb),public.platform_admin_request(text,jsonb) to authenticated;

create function private.support_request(p_business uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<request_ctx>>
declare actor uuid:=auth.uid();cid uuid;mid uuid;c private.support_cases;msg private.support_messages;page integer;result jsonb;
begin
 if actor is null or not private.is_business_member(p_business) then return jsonb_build_object('error','Business access could not be verified.');end if;
 if not coalesce((select enabled from private.workspace_feature_flags where name='platform_console'),false) then return jsonb_build_object('error','Support is not enabled in this environment.');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>12000 then return jsonb_build_object('error','Invalid support request.');end if;
 if p_action='create' then
  cid:=(p_input->>'request_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('support-'||actor::text,0));
  select * into c from private.support_cases where id=cid;
  if found then
   if c.business_id<>p_business or c.reporter_id<>actor or c.title<>btrim(p_input->>'title') or c.description<>btrim(p_input->>'description') then return jsonb_build_object('error','Retry ID belongs to another case.');end if;
  else
   if (select count(*) from private.support_cases where reporter_id=actor and created_at>now()-interval '1 day')>=20 then return jsonb_build_object('error','Daily support case limit reached. Continue an existing case.');end if;
   insert into private.support_cases(id,business_id,reporter_id,title,description,priority) values(cid,p_business,actor,btrim(p_input->>'title'),btrim(p_input->>'description'),p_input->>'priority') returning * into c;
  end if;
 elsif p_action in ('detail','reply') then
  cid:=(p_input->>'id')::uuid;select * into c from private.support_cases where id=cid and business_id=p_business and reporter_id=actor for update;
  if not found then return jsonb_build_object('error','Support case unavailable.');end if;
  if p_action='reply' then
   mid:=(p_input->>'request_id')::uuid;select * into msg from private.support_messages where id=mid;
   if found then
    if msg.case_id<>cid or msg.actor<>actor or msg.body<>btrim(p_input->>'body') or msg.audience<>'customer' then return jsonb_build_object('error','Retry ID belongs to another reply.');end if;
   else
    if (select count(*) from private.support_messages m where m.actor=request_ctx.actor and m.created_at>now()-interval '1 hour')>=60 then return jsonb_build_object('error','Reply limit reached. Wait before posting again.');end if;
    insert into private.support_messages(id,case_id,actor,audience,body) values(mid,cid,actor,'customer',btrim(p_input->>'body'));
    update private.support_cases set version=version+1,status=case when status in ('closed','resolved') then 'open' else status end,updated_at=now() where id=cid returning * into c;
   end if;
  end if;
 elsif p_action='list' then
  page:=greatest(0,least(coalesce((p_input->>'page')::integer,0),10000));
  select jsonb_build_object('total',(select count(*) from private.support_cases where business_id=p_business and reporter_id=actor),'rows',coalesce(jsonb_agg(x),'[]')) into result
  from (select id,title,priority,status,version,created_at,updated_at from private.support_cases where business_id=p_business and reporter_id=actor order by updated_at desc,id limit 25 offset page*25) x;
  return result;
 else return jsonb_build_object('error','Unknown support action.');end if;
 return jsonb_build_object('case',to_jsonb(c)-'reporter_id','messages',coalesce((select jsonb_agg((to_jsonb(m)-'actor'-'changes')||jsonb_build_object('sender',case when m.actor=request_ctx.actor then 'You' else 'Finviant' end) order by created_at,id) from private.support_messages m where case_id=cid and audience='customer'),'[]'));
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then return jsonb_build_object('error','Enter a title, description and valid priority.');
end $$;
create function public.support_request(p_business uuid,p_action text,p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.support_request(p_business,p_action,p_input)$$;
revoke all on function private.support_request(uuid,text,jsonb),public.support_request(uuid,text,jsonb) from public,anon;
grant execute on function private.support_request(uuid,text,jsonb),public.support_request(uuid,text,jsonb) to authenticated;
