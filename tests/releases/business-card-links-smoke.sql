-- November 8, 2026. Domain-bound beta, synthetic operations rolled back; no provider calls.
begin;
do $qa$
declare actor uuid;b uuid;saved jsonb;r uuid;token text:=encode(extensions.gen_random_bytes(32),'hex');request uuid:=gen_random_uuid();used integer;claim jsonb;
begin
 select s.user_id,x.id into actor,b from private.test_account_slots s join auth.users u on u.id=s.user_id join public.businesses x on x.created_by_user_id=s.user_id join private.managed_delivery_accounts m on m.business_id=x.id and m.email_active where u.email_confirmed_at is not null order by s.slot limit 1;
 if actor is null then raise exception 'Verified private beta owner required';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);perform public.set_tier_test(b,'pro');saved:=public.get_business_card(b);
 saved:=public.save_business_card(b,jsonb_build_object('name','Synthetic Release Card','phone','7575550123','email','hello@example.test','website','https://example.test','tagline','Synthetic QA','include_address',false,'street','Private Home','city','City','region','VA','postal_code','23320'),(saved->>'revision')::uuid);r:=(saved->>'revision')::uuid;
 perform public.publish_business_card(b,r,token);
 if public.get_shared_business_card(token)->'card' ? 'street' then raise exception 'Private address exposed';end if;
 used:=(public.get_plan_usage(b)->>'email_used')::integer;
 begin perform public.prepare_business_card_delivery(actor,b,request,r,token,'email','unapproved@example.test',null,false);raise exception 'Unapproved recipient accepted';exception when insufficient_privilege then null;end;
 perform public.prepare_business_card_delivery(actor,b,request,r,token,'email','delivered@resend.dev',null,false);perform public.prepare_business_card_delivery(actor,b,request,r,token,'email','delivered@resend.dev',null,false);
 if (public.get_plan_usage(b)->>'email_used')::integer<>used+1 then raise exception 'Email retry counted twice';end if;
 claim:=public.claim_document_email(request,true);
 if claim->>'status'<>'claimed' or claim->'payload'->>'text' not like '%'||token||'%' then raise exception 'Exact preview URL not frozen';end if;
 if convert_from(decode(claim->'payload'->'attachments'->0->>'content','base64'),'UTF8')<>public.get_shared_business_card(token)->>'vcard' then raise exception 'Attachment differs from preview';end if;
 if public.get_business_card_pending(b)->>'token'<>token then raise exception 'Pending send not recoverable';end if;
 perform public.finish_document_email(request,(claim->>'lease')::uuid,'accepted','qa-card-link-'||request,null);
 perform public.record_tagged_delivery_event('qa-card-link-'||request,'qa-card-link-'||request,'email.delivered',now(),request);
 if (select status from public.messages where id=request)<>'delivered' then raise exception 'Delivery event failed';end if;
 perform set_config('finviant.card_qa_token',token,true);perform set_config('finviant.card_qa_business',b::text,true);
end $qa$;
set local role anon;
do $qa$ begin
 if public.get_shared_business_card(current_setting('finviant.card_qa_token'))->'card'->>'name'<>'Synthetic Release Card' then raise exception 'Anonymous preview failed';end if;
 if public.get_shared_business_card(repeat('0',64)) is not null then raise exception 'Invalid link returned data';end if;
end $qa$;
reset role;
do $qa$ begin
 perform public.revoke_business_card_link(current_setting('finviant.card_qa_business')::uuid,current_setting('finviant.card_qa_token'));
 if public.get_shared_business_card(current_setting('finviant.card_qa_token')) is not null then raise exception 'Withdrawal failed';end if;
end $qa$;
select 'PASS: live anonymous preview/privacy, exact attached vCard and link, approved-recipient guard, once-only quota, restored pending send, delivery callback and link withdrawal; all rolled back, no provider calls.' result;
rollback;
