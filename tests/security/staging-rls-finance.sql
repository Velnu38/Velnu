-- Disposable synthetic fixtures; always roll back. No provider calls or customer sends.
begin;
set local statement_timeout = '20s';
create temp table qa_context (key text primary key, id uuid not null) on commit drop;
create temp table qa_results (id text, status text, detail text) on commit drop;
insert into qa_context select key, gen_random_uuid() from unnest(array[
'xuser','yuser','tech','xspace','yspace','tspace','xcustomer','ycustomer','tcustomer','xinvoice','yinvoice','tinvoice','xappt','yappt']) key;
grant select on qa_context to authenticated;
grant select,insert on qa_results to authenticated;
insert into auth.users(id,aud,role,email)
select id,'authenticated','authenticated',id::text||'@finviant-qa.invalid' from qa_context where key in ('xuser','yuser','tech');
insert into public.user_plan_preferences(user_id,selected_tier)
select id,'free' from qa_context where key in ('xuser','yuser','tech');
insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent,selected_tier_at_acceptance)
select id,'2026-10-27-v3',true,true,true,'free' from qa_context where key in ('xuser','yuser','tech');
insert into public.businesses(id,name,created_by_user_id)
select s.id,'QA_'||s.key,u.id from qa_context s join qa_context u on u.key=case when s.key='tspace' then 'tech' else left(s.key,1)||'user' end where s.key in ('xspace','yspace','tspace');
insert into public.business_members(business_id,user_id,role)
select s.id,u.id,'owner' from qa_context s join qa_context u on u.key=left(s.key,1)||'user' where s.key in ('xspace','yspace');
insert into public.business_members(business_id,user_id,role)
select s.id,u.id,'technician' from qa_context s cross join qa_context u where s.key='tspace' and u.key='tech';
insert into public.customers(id,business_id,first_name)
select c.id,s.id,'QA_'||c.key from qa_context c join qa_context s on s.key=left(c.key,1)||'space' where c.key in ('xcustomer','ycustomer','tcustomer');
insert into public.invoices(id,business_id,customer_id)
select i.id,s.id,c.id from qa_context i join qa_context s on s.key=left(i.key,1)||'space' join qa_context c on c.key=left(i.key,1)||'customer' where i.key in ('xinvoice','yinvoice','tinvoice');
insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate)
select i.id,s.id,'QA service',1,100,0 from qa_context i join qa_context s on s.key=left(i.key,1)||'space' where i.key in ('xinvoice','yinvoice','tinvoice');
update public.invoices set status='sent' where id in (select id from qa_context where key in ('xinvoice','yinvoice','tinvoice'));
insert into public.appointments(id,business_id,customer_id,title,starts_at,ends_at)
select a.id,s.id,c.id,'QA visit','2028-02-29T15:00:00Z','2028-02-29T16:00:00Z'
from qa_context a join qa_context s on s.key=left(a.key,1)||'space' join qa_context c on c.key=left(a.key,1)||'customer' where a.key in ('xappt','yappt');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_context where key='xuser'),'role','authenticated')::text,true);
set local role authenticated;
do $qa$
declare
 x uuid := (select id from qa_context where key='xspace');
 y uuid := (select id from qa_context where key='yspace');
 xi uuid := (select id from qa_context where key='xinvoice');
 yi uuid := (select id from qa_context where key='yinvoice');
 xc uuid := (select id from qa_context where key='xcustomer');
 yc uuid := (select id from qa_context where key='ycustomer');
 n integer; doc jsonb; pay jsonb; retry uuid := gen_random_uuid();
begin
 insert into qa_results select 'DB-01',case when count(*)=1 then 'Pass' else 'Fail' end,'Owner can read own invoice' from public.invoices where id=xi;
 insert into qa_results select 'DB-02',case when count(*)=0 then 'Pass' else 'Fail' end,'Other tenant invoice hidden' from public.invoices where id=yi;
 insert into qa_results select 'DB-03',case when count(*)=0 then 'Pass' else 'Fail' end,'Other tenant client hidden' from public.customers where id=yc;
 insert into qa_results select 'DB-04',case when count(*)=0 then 'Pass' else 'Fail' end,'Other tenant schedule hidden' from public.appointments where business_id=y;
 update public.invoices set notes='QA unauthorized' where id=yi; get diagnostics n=row_count;
 insert into qa_results values('DB-05',case when n=0 then 'Pass' else 'Fail' end,'Foreign invoice update affects zero rows');
 delete from public.appointments where business_id=y; get diagnostics n=row_count;
 insert into qa_results values('DB-06',case when n=0 then 'Pass' else 'Fail' end,'Foreign schedule delete affects zero rows');
 begin
  perform public.create_document(y,'invoice',gen_random_uuid(),jsonb_build_object('customer_id',yc,'items',jsonb_build_array(jsonb_build_object('description','QA','quantity',1,'unit_price',10))));
  insert into qa_results values('DB-07','Fail','Cross-tenant RPC accepted');
 exception when sqlstate '42501' then insert into qa_results values('DB-07','Pass','Cross-tenant RPC denied with 42501'); end;
 begin
  perform public.create_document(x,'invoice',gen_random_uuid(),jsonb_build_object('customer_id',yc,'items',jsonb_build_array(jsonb_build_object('description','QA','quantity',1,'unit_price',10))));
  insert into qa_results values('DB-08','Fail','Foreign customer attached to own invoice');
 exception when foreign_key_violation then insert into qa_results values('DB-08','Pass','Tenant/customer composite foreign key enforced'); end;
 doc:=public.create_document(x,'estimate',retry,jsonb_build_object('customer_id',xc,'items',jsonb_build_array(
 jsonb_build_object('description','A','quantity',2,'unit_price',49.95,'tax_rate',6.25),
 jsonb_build_object('description','B','quantity',1.5,'unit_price',80,'tax_rate',6.25))));
 insert into qa_results values('DB-09',case when (doc->>'total')::numeric=233.64 then 'Pass' else 'Fail' end,'No-discount golden total expected 233.64; actual '||(doc->>'total'));
 insert into qa_results values('DB-10',case when doc->>'id'=public.create_document(x,'estimate',retry,jsonb_build_object('customer_id',xc,'items',jsonb_build_array(
 jsonb_build_object('description','A','quantity',2,'unit_price',49.95,'tax_rate',6.25),
 jsonb_build_object('description','B','quantity',1.5,'unit_price',80,'tax_rate',6.25))))->>'id' then 'Pass' else 'Fail' end,'Same request ID returns same document');
 begin
  perform public.create_document(x,'invoice',gen_random_uuid(),jsonb_build_object('customer_id',xc,'items',jsonb_build_array(jsonb_build_object('description','QA','quantity',1,'unit_price',-1))));
  insert into qa_results values('DB-11','Fail','Negative price accepted');
 exception when check_violation then insert into qa_results values('DB-11','Pass','Negative price rejected by server'); end;
 begin
  perform public.create_document(x,'invoice',gen_random_uuid(),jsonb_build_object('customer_id',xc,'items',jsonb_build_array(jsonb_build_object('description','QA','quantity',1,'unit_price',1.999))));
  insert into qa_results values('DB-12','Fail','Overprecision price silently accepted');
 exception when check_violation then insert into qa_results values('DB-12','Pass','Overprecision price rejected by server'); end;
 retry:=gen_random_uuid();
 pay:=public.record_manual_payment(x,xi,retry,40,'cash','QA');
 insert into qa_results values('DB-13',case when (select balance_due from public.invoices where id=xi)=60 then 'Pass' else 'Fail' end,'Manual payment reduces 100 to 60');
 insert into qa_results values('DB-14',case when pay->>'id'=public.record_manual_payment(x,xi,retry,40,'cash','QA')->>'id' then 'Pass' else 'Fail' end,'Same payment request returns same record');
 begin
  perform public.record_manual_payment(x,xi,gen_random_uuid(),61,'cash','QA');
  insert into qa_results values('DB-15','Fail','Overpayment accepted');
 exception when raise_exception then
  if sqlerrm like '%remaining balance%' then insert into qa_results values('DB-15','Pass','Overpayment rejected'); else raise; end if;
 end;
end $qa$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_context where key='tech'),'role','authenticated')::text,true);
do $qa$
begin
 begin
  perform public.record_manual_payment((select id from qa_context where key='tspace'),(select id from qa_context where key='tinvoice'),gen_random_uuid(),1,'cash','QA');
  insert into qa_results values('DB-16','Fail','Technician recorded money');
 exception when raise_exception then
  if sqlerrm like '%office user%' then insert into qa_results values('DB-16','Pass','Financial-role trigger rejected technician'); else raise; end if;
 end;
end $qa$;
reset role;
select jsonb_agg(to_jsonb(qa_results) order by id) as results from qa_results;
rollback;