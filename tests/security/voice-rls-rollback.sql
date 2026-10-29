-- Native staging-only role test. Fixtures are rolled back inside a subtransaction.
-- Any failed check aborts this DO statement; only the intentional ZQ001 rolls back a pass.
do $qa$
declare ua uuid:=gen_random_uuid();ub uuid:=gen_random_uuid();ba uuid:=gen_random_uuid();bb uuid:=gen_random_uuid();n integer;denied boolean;
begin
 begin
  insert into auth.users(id,aud,role,email) values(ua,'authenticated','authenticated',ua||'@example.invalid'),(ub,'authenticated','authenticated',ub||'@example.invalid');
  insert into public.user_plan_preferences(user_id,selected_tier) values(ua,'free'),(ub,'free');
  insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent,selected_tier_at_acceptance) values(ua,'2026-10-27-v3',true,true,true,'free'),(ub,'2026-10-27-v3',true,true,true,'free');
  insert into public.businesses(id,name,created_by_user_id) values(ba,'QA_voice_A',ua),(bb,'QA_voice_B',ub);
  insert into public.business_members(business_id,user_id,role) values(ba,ua,'owner'),(bb,ub,'owner');
  insert into public.voice_transcriptions(business_id,user_id,transcript) values(ba,ua,'QA own transcript'),(bb,ub,'QA foreign transcript');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into n from public.voice_transcriptions where business_id=ba;
  if n<>1 then raise exception 'VOICE_RLS_01: own row unavailable';end if;
  select count(*) into n from public.voice_transcriptions where business_id=bb;
  if n<>0 then raise exception 'VOICE_RLS_02: foreign row exposed';end if;
  denied:=false;begin insert into public.voice_transcriptions(business_id,user_id,transcript) values(ba,ua,'QA forged');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'VOICE_RLS_03: own insert accepted';end if;
  denied:=false;begin insert into public.voice_transcriptions(business_id,user_id,transcript) values(bb,ua,'QA foreign forged');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'VOICE_RLS_04: foreign insert accepted';end if;
  denied:=false;begin update public.voice_transcriptions set transcript='QA forged' where business_id=ba;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'VOICE_RLS_05: update accepted';end if;
  denied:=false;begin delete from public.voice_transcriptions where business_id=ba;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'VOICE_RLS_06: delete accepted';end if;
  execute 'reset role';
  raise exception 'VOICE_RLS: all 6 checks passed; rollback fixtures' using errcode='ZQ001';
 exception when sqlstate 'ZQ001' then null;
 end;
end $qa$;
