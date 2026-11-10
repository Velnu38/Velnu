create function private.valid_service_package_items(items jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;q numeric;p numeric;t numeric;total numeric:=0;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 50 then return false;end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'description') is distinct from 'string'
   or length(btrim(item->>'description')) not between 1 and 2000
   or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number'
   or jsonb_typeof(item->'tax_rate') is distinct from 'number'
   or item-array['description','quantity','unit_price','tax_rate']<>'{}'::jsonb then return false;end if;
  q:=(item->>'quantity')::numeric;p:=(item->>'unit_price')::numeric;t:=(item->>'tax_rate')::numeric;
  if q not between .01 and 100000 or p not between 0 and 10000000 or t not between 0 and 100
   or q<>round(q,2) or p<>round(p,2) or t<>round(t,2) then return false;end if;
  total:=total+round(q*p,2)+round(round(q*p,2)*t/100,2);
 end loop;
 return total<=1000000000000;
end $$;
revoke all on function private.valid_service_package_items(jsonb) from public,anon,service_role;
grant execute on function private.valid_service_package_items(jsonb) to authenticated;

create table public.service_packages (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 120),
 items jsonb not null check(private.valid_service_package_items(items)),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index service_packages_active_name on public.service_packages(business_id,lower(btrim(name))) where active;
create index service_packages_business on public.service_packages(business_id,id);
alter table public.service_packages enable row level security;
revoke all on public.service_packages from public,anon,authenticated,service_role;
grant select,insert on public.service_packages to authenticated;
grant update(active) on public.service_packages to authenticated;
create policy service_packages_read on public.service_packages for select to authenticated
 using(public.has_workspace_access(business_id,'billing'));
create policy service_packages_insert on public.service_packages for insert to authenticated
 with check(public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true));
create policy service_packages_archive on public.service_packages for update to authenticated
 using(public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true))
 with check(public.has_workspace_access(business_id,'billing') and private.fin_access(business_id,'invoices',true));
