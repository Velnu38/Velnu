-- November 8, 2026. Run only against the registered private-beta database.
-- All synthetic rows, outbox operations and entitlement tests are rolled back.
-- No provider dispatch, email or payment charge is performed.
begin;
do $qa$
declare actor uuid; b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); doc uuid; request uuid:=gen_random_uuid(); mail text; result jsonb; claim jsonb; used jsonb; before_email integer; service uuid:=gen_random_uuid();
begin
 select s.user_id,u.email,x.id into actor,mail,b from private.test_account_slots s join auth.users u on u.id=s.user_id join public.businesses x on x.created_by_user_id=s.user_id join private.managed_delivery_accounts m on m.business_id=x.id and m.email_active
 where u.email_confirmed_at is not null order by s.slot limit 1;
 if actor is null then raise exception 'A verified private tester is required for the rollback-only smoke.';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 -- The current application permits one workspace per owner. Use an existing
 -- enrolled private tester only inside this rollback transaction; existing records are untouched.
 used:=public.set_tier_test(b,'basic');
 before_email:=(used->>'email_used')::integer;
 if used->>'plan'<>'basic' or (used->>'email_limit')::integer<>250 then raise exception 'Individual allowance mismatch';end if;
 result:=public.import_customer_contacts(b,jsonb_build_array(jsonb_build_object('id',c,'first_name','Release','last_name','Check','company','Synthetic QA','email','qa+'||replace(c::text,'-','')||'@example.test','phone',null)));
 if (result->>'imported')::integer<>1 then raise exception 'CSV contact import failed';end if;
 if (select company from public.customers where id=c)<>'Synthetic QA' then raise exception 'CSV company was lost';end if;
 update public.customers set email='delivered@resend.dev' where id=c and business_id=b;
 insert into public.service_items(id,business_id,description,unit_price,tax_rate) values(service,b,'Rollback service '||service,100,5);
 result:=public.create_document(b,'invoice',gen_random_uuid(),jsonb_build_object('customer_id',c,'items',jsonb_build_array(jsonb_build_object('description','Synthetic service','quantity',1,'unit_price',100,'tax_rate',5))));
 doc:=(result->>'id')::uuid;
 if (select total from public.invoices where id=doc)<>105 then raise exception 'Document total mismatch';end if;
 result:=public.prepare_document_email(actor,b,'invoice',doc,request,'https://finviant.com');
 if result->>'id'<>request::text then raise exception 'Manual send operation mismatch';end if;
 used:=public.get_plan_usage(b);
 if (used->>'email_used')::integer<>before_email+1 then raise exception 'Manual email reservation mismatch';end if;
 claim:=public.claim_document_email(request,true);
 if claim->>'status'<>'claimed' then raise exception 'Manual Individual email not claimable: %',claim->>'status';end if;
 result:=public.prepare_document_email(actor,b,'invoice',doc,request,'https://finviant.com');
 used:=public.get_plan_usage(b);
 if (used->>'email_used')::integer<>before_email+1 then raise exception 'Retry consumed a second delivery';end if;
 if private.manual_or_pro_email(b,'schedule',gen_random_uuid()) or private.manual_or_pro_email(b,'invoice_reminder',gen_random_uuid()) then raise exception 'Individual gained Pro automation';end if;
 if exists(select 1 from private.finviant_email_outbox where business_id=b and id=request and provider_id is not null) then raise exception 'Unexpected provider operation';end if;
 perform set_config('finviant.qa_business',b::text,true);perform set_config('finviant.qa_service',service::text,true);perform set_config('finviant.qa_document',doc::text,true);
end $qa$;
set local role authenticated;
do $qa$
declare b uuid:=current_setting('finviant.qa_business')::uuid;
begin
 if (select count(*) from public.service_items where business_id=b and id=current_setting('finviant.qa_service')::uuid)<>1 then raise exception 'Authorized catalog RLS read failed';end if;
 update public.service_items set active=false where business_id=b and id=current_setting('finviant.qa_service')::uuid;
 if not exists(select 1 from public.invoice_items where business_id=b and invoice_id=current_setting('finviant.qa_document')::uuid and description='Synthetic service' and unit_price=100) then raise exception 'Catalog removal changed document lines';end if;
end $qa$;
reset role;
select 'PASS: rollback-only customer CSV, company, service catalog RLS, exact totals, Individual 250 email limit, canonical operation claim, retry quota and Pro-only automation' as result;
rollback;
