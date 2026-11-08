-- November 8, 2026. Rollback-only smoke on the domain-bound beta backend.
-- Never dispatch a provider call; every synthetic card/message/quota change rolls back.
begin;
do $qa$
declare actor uuid;b uuid;card jsonb;saved jsonb;exported jsonb;request uuid:=gen_random_uuid();claim jsonb;used integer;
begin
 select s.user_id,x.id into actor,b from private.test_account_slots s join auth.users u on u.id=s.user_id join public.businesses x on x.created_by_user_id=s.user_id join private.managed_delivery_accounts m on m.business_id=x.id and m.email_active where u.email_confirmed_at is not null order by s.slot limit 1;
 if actor is null then raise exception 'Verified beta owner required';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.set_tier_test(b,'pro');
 saved:=public.get_business_card(b);card:=jsonb_build_object('name','Rollback E-Business Card','phone','7575550123','email','hello@example.test','website','https://example.test/a?x=1,2;z=3','tagline','Synthetic card; no delivery','include_address',false,'street','Private Home','city','Chesapeake','region','VA','postal_code','23320');
 saved:=public.save_business_card(b,card,(saved->>'revision')::uuid);
 exported:=public.export_business_card(b,(saved->>'revision')::uuid);
 if exported->>'vcard' like '%ADR;%' or exported->>'vcard' like '%Private Home%' then raise exception 'Address privacy failed';end if;
 if exported->>'vcard' not like '%URL:https://example.test/a?x=1,2;z=3%' then raise exception 'Website URI changed';end if;
 used:=(public.get_plan_usage(b)->>'email_used')::integer;
 begin
  perform public.prepare_business_card_email(actor,b,request,'not-approved@example.test',(saved->>'revision')::uuid);
  raise exception 'Unapproved recipient accepted';
 exception when insufficient_privilege then null;end;
 if (public.get_plan_usage(b)->>'email_used')::integer<>used then raise exception 'Rejected card consumed quota';end if;
 perform public.prepare_business_card_email(actor,b,request,'delivered@resend.dev',(saved->>'revision')::uuid);
 perform public.prepare_business_card_email(actor,b,request,'delivered@resend.dev',(saved->>'revision')::uuid);
 if (public.get_plan_usage(b)->>'email_used')::integer<>used+1 then raise exception 'Retry quota mismatch';end if;
 claim:=public.claim_document_email(request,true);
 if claim->>'status'<>'claimed' or claim->'payload'->'attachments'->0->>'filename'<>'E-Business-Card.vcf' then raise exception 'Attachment claim failed: %',claim;end if;
 if convert_from(decode(claim->'payload'->'attachments'->0->>'content','base64'),'UTF8')<>exported->>'vcard' then raise exception 'Email attachment differs from downloaded card';end if;
 perform public.finish_document_email(request,(claim->>'lease')::uuid,'accepted','synthetic-card-'||request::text,null);
 if (select status from public.messages where id=request)<>'sent' then raise exception 'Message activity not updated';end if;
 perform public.set_tier_test(b,'basic');
 begin perform public.export_business_card(b,(saved->>'revision')::uuid);raise exception 'Individual exported a Pro card';exception when insufficient_privilege then null;end;
 perform public.set_tier_test(b,'free');
 begin perform public.save_business_card(b,card,(saved->>'revision')::uuid);raise exception 'Free edited a Pro card';exception when insufficient_privilege then null;end;
end $qa$;
select 'PASS: live rollback-only card save/privacy/URI, beta recipient denial, exact attachment, once-only quota, leased claim/completion/activity and Free/Individual denial. No provider dispatch.' as result;
rollback;
