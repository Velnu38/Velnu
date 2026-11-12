-- Private-beta, rollback-only synthetic card/request checks. No provider calls.
begin;
do $qa$
declare actor uuid; b uuid; current_card jsonb; saved jsonb; publication jsonb; link uuid; request uuid:=gen_random_uuid(); n bigint; content text;
begin
 select s.user_id,x.id into actor,b from private.test_account_slots s
 join public.businesses x on x.created_by_user_id=s.user_id
 where exists(select 1 from public.business_members m where m.business_id=x.id and m.user_id=s.user_id and m.role='owner')
 order by s.slot,x.id limit 1;
 if actor is null then raise exception 'Eligible beta owner required for rollback probe';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.set_tier_test(b,'pro');current_card:=public.get_business_card(b);
 saved:=public.save_business_card(b,jsonb_build_object('name','Synthetic stable card QA','phone','+17575550123','email','hello@example.test','website','https://example.test','tagline','Rollback QA','include_address',false,'street','PRIVATE SYNTHETIC HOME','city','City','region','VA','postal_code','23320'),(current_card->>'revision')::uuid);
 publication:=public.set_live_business_card(b,(saved->>'revision')::uuid,true);
 link:=split_part(publication->>'url','business_card=',2)::uuid;
 if link=b then raise exception 'Public identity must be separate';end if;
 if public.get_live_business_card(link)->'card' ? 'street' then raise exception 'Private address exposed';end if;
 content:=replace(public.export_business_card(b,(saved->>'revision')::uuid)->>'vcard',E'\r\n ','');
 if position('URL:'||(publication->>'url') in content)=0 or position('URL:https://example.test' in content)=0 then raise exception 'Contact websites missing';end if;
 perform public.set_live_business_card(b,(saved->>'revision')::uuid,false);
 if public.get_live_business_card(link) is not null then raise exception 'Unpublished card remained available';end if;
 if public.set_live_business_card(b,(saved->>'revision')::uuid,true)->>'url' is distinct from publication->>'url' then raise exception 'Stable address changed';end if;
 select count(*) into n from private.finviant_email_outbox;
 perform public.request_business_card_estimate(link,request,'Synthetic QA customer','customer@example.test','Synthetic estimate request, rollback only');
 perform public.request_business_card_estimate(link,request,'Synthetic QA customer','customer@example.test','Synthetic estimate request, rollback only');
 if (select count(*) from public.messages where id=request and business_id=b and direction='inbound' and status='received')<>1 then raise exception 'Request routing/retry failed';end if;
 if (select count(*) from private.finviant_email_outbox)<>n then raise exception 'Unexpected outbound operation';end if;
 begin perform public.request_business_card_estimate(link,request,'Changed','customer@example.test','Synthetic estimate request, rollback only');raise exception 'Changed retry accepted';exception when check_violation then null;end;
 perform set_config('finviant.card_qa_public',link::text,true);perform set_config('finviant.card_qa_business',b::text,true);perform set_config('finviant.card_qa_revision',saved->>'revision',true);
end $qa$;
set local role anon;
do $qa$ begin
 if public.get_live_business_card(current_setting('finviant.card_qa_public')::uuid)->'card'->>'name'<>'Synthetic stable card QA' then raise exception 'Anonymous public-card read failed';end if;
 begin perform public.set_live_business_card(current_setting('finviant.card_qa_business')::uuid,current_setting('finviant.card_qa_revision')::uuid,false);raise exception 'Anonymous publication allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from private.business_card_publications;raise exception 'Anonymous table access allowed';exception when insufficient_privilege then null;end;
end $qa$;
reset role;
do $qa$ begin
 perform public.set_live_business_card(current_setting('finviant.card_qa_business')::uuid,current_setting('finviant.card_qa_revision')::uuid,false);
 begin perform public.request_business_card_estimate(current_setting('finviant.card_qa_public')::uuid,gen_random_uuid(),'Synthetic','customer@example.test','Withdrawn card');raise exception 'Withdrawn request accepted';exception when insufficient_privilege then null;end;
end $qa$;
set local role authenticated;
do $qa$ begin
 begin perform public.set_live_business_card(current_setting('finviant.card_qa_business')::uuid,current_setting('finviant.card_qa_revision')::uuid,true);raise exception 'Missing-session publication allowed';exception when insufficient_privilege then null;end;
end $qa$;
reset role;
select 'PASS: stable contact URLs, address privacy, republish/unpublish, tenant-routed once-only inbound request, anonymous ACL and missing-session denial; rollback only, no sends or charges.' result;
rollback;
