-- Minimal, bounded customer suggestions for job drafts. Invoker permissions retain
-- the existing customer row policies; the jobs permission is checked as well.
create function public.search_job_customers(p_business uuid,p_query text default '',p_selected uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;q text;digits text;
begin
 if auth.uid() is null or not coalesce(private.is_business_member(p_business),false) or not coalesce(private.member_module_access(p_business,auth.uid(),'jobs'),false) then raise exception 'Job access required.' using errcode='42501';end if;
 if length(coalesce(p_query,''))>200 then raise exception 'Search using up to 200 characters.' using errcode='22023';end if;
 q:=lower(regexp_replace(btrim(regexp_replace(normalize(coalesce(p_query,''),NFKD),U&'[\0300-\036f]','','g')),'\s+',' ','g'));
 digits:=regexp_replace(q,'[^0-9]','','g');
 with contacts as materialized (
  select id,first_name,last_name,company,email,phone,
   coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') label
  from public.customers where business_id=p_business and not archived
 ), fields as (
  select c.*,array(select lower(regexp_replace(btrim(regexp_replace(normalize(coalesce(f,''),NFKD),U&'[\0300-\036f]','','g')),'\s+',' ','g')) from unnest(array[c.label,c.company,c.email,c.phone])f) terms from contacts c
 ), ranked as (
  select *,case when q='' then 1 when q=any(terms) then 3
   when exists(select 1 from unnest(terms)t where left(t,length(q))=q) then 2
   when not exists(select 1 from unnest(string_to_array(q,' '))token where not exists(select 1 from unnest(terms)t where strpos(t,token)>0))
    or length(digits)>=3 and q~'^[0-9\s()+.-]+$' and strpos(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),digits)>0 then 1 else 0 end score from fields
 ), selected as (select id,first_name,last_name,company,email,phone from contacts where id=p_selected),
 matches as (select id,first_name,last_name,company,email,phone,score,label from ranked where score>0 order by score desc,lower(label),id limit 8)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m)-'score'-'label' order by score desc,lower(label),id) from matches m),'[]'::jsonb),
  'selected',(select to_jsonb(s) from selected s)) into result;
 return result;
end $$;
revoke all on function public.search_job_customers(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.search_job_customers(uuid,text,uuid) to authenticated;
