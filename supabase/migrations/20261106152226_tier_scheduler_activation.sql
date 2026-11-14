-- Only the database scheduler can invoke the worker. No broad service key is
-- embedded in a cron command or returned through an authenticated RPC.
create extension if not exists pg_net;
create table private.tier_worker_config (
 singleton boolean primary key default true check(singleton),
 endpoint text check(endpoint ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/tier-delivery-worker$'),
 token text not null default encode(extensions.gen_random_bytes(32),'hex'),
 enabled boolean not null default false
);
alter table private.tier_worker_config enable row level security;
revoke all on private.tier_worker_config from public,anon,authenticated,service_role;
create policy no_client_access on private.tier_worker_config to authenticated using(false);
insert into private.tier_worker_config(singleton) values(true);
create function public.authorize_tier_worker(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and p_token=token from private.tier_worker_config where singleton),false);
$$;
revoke all on function public.authorize_tier_worker(text) from public,anon,authenticated;
grant execute on function public.authorize_tier_worker(text) to service_role;
create function private.dispatch_tier_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare c private.tier_worker_config;request bigint;
begin
 select * into c from private.tier_worker_config where singleton and enabled;
 if not found or c.endpoint is null then return null;end if;
 select net.http_post(url:=c.endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||c.token),body:='{}'::jsonb,timeout_milliseconds:=45000) into request;
 return request;
end $$;
revoke all on function private.dispatch_tier_worker() from public,anon,authenticated,service_role;
select cron.schedule('finviant-tier-delivery','*/5 * * * *','select private.dispatch_tier_worker()');
