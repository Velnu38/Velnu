-- Synthetic fixtures only. Run on a disposable local database; always roll back.
begin;
set local statement_timeout = '20s';
create function pg_temp.expect_error(command text, expected_code text) returns void
language plpgsql security invoker as $$
declare actual text;
begin
  begin execute command;
  exception when others then
    get stacked diagnostics actual = returned_sqlstate;
    if actual = expected_code then return; end if;
    raise exception 'Expected SQLSTATE %, got % for %', expected_code, actual, command;
  end;
  raise exception 'Unauthorized operation succeeded: %', command;
end $$;
create function pg_temp.check_true(value boolean, label text) returns void
language plpgsql security invoker as $$
begin if value is distinct from true then raise exception 'Voice security check failed: %', label; end if; end $$;

-- BEGIN VOICE FIXTURES
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003');
insert into public.user_plan_preferences(user_id,selected_tier)
select id,'pro' from auth.users where id::text like '10000000-0000-4000-8000-%';
insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent,selected_tier_at_acceptance)
select id,'2026-10-27-v3',true,true,true,'pro' from auth.users where id::text like '10000000-0000-4000-8000-%';
insert into public.businesses(id,name,created_by_user_id) values
 ('20000000-0000-4000-8000-000000000001','QA_VOICE_A','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','QA_VOICE_B','10000000-0000-4000-8000-000000000002');
-- A second member requires an activated Pro entitlement while fixtures are built.
insert into private.business_entitlements(business_id,plan) values
 ('20000000-0000-4000-8000-000000000001','pro');
insert into public.business_members(business_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','admin');
delete from private.business_entitlements where business_id='20000000-0000-4000-8000-000000000001';
insert into public.voice_transcriptions(id,business_id,user_id,transcript) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','QA_A_OWNER'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','QA_B_OWNER'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','QA_A_OTHER_ACTOR'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','QA_FOREIGN_BUSINESS_SAME_ACTOR');
-- END VOICE FIXTURES
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.voice_transcriptions'::regclass),'transcript RLS enabled');
select pg_temp.check_true(has_table_privilege('authenticated','public.voice_transcriptions','SELECT'),'subscriber SELECT retained');
select pg_temp.check_true(not has_table_privilege('authenticated','public.voice_transcriptions','INSERT,UPDATE,DELETE,TRUNCATE'),'subscriber has no write privileges');

set local role anon;
select pg_temp.expect_error('select * from public.voice_transcriptions','42501');
select pg_temp.expect_error($q$insert into public.voice_transcriptions(business_id,user_id,transcript) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','forged')$q$,'42501');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'42501');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"business_id":"20000000-0000-4000-8000-000000000002","plan":"pro"}}',true);
set local role authenticated;
select pg_temp.check_true((select count(*)=1 from public.voice_transcriptions),'unfiltered reads return only own transcript');
select pg_temp.check_true((select count(*)=0 from public.voice_transcriptions where business_id='20000000-0000-4000-8000-000000000002'),'forged business filter exposes zero rows');
select pg_temp.check_true((select count(*)=0 from public.voice_transcriptions where id='30000000-0000-4000-8000-000000000002'),'foreign transcript UUID hidden');
select pg_temp.check_true((select count(*)=0 from public.voice_transcriptions where id='30000000-0000-4000-8000-000000000003'),'other actor in same business remains private');
select pg_temp.expect_error($q$insert into public.voice_transcriptions(business_id,user_id,transcript) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','forged')$q$,'42501');
select pg_temp.expect_error($q$insert into public.voice_transcriptions(business_id,user_id,transcript) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','forged')$q$,'42501');
select pg_temp.expect_error($q$update public.voice_transcriptions set transcript='forged'$q$,'42501');
select pg_temp.expect_error($q$update public.voice_transcriptions set business_id='20000000-0000-4000-8000-000000000002'$q$,'42501');
select pg_temp.expect_error('delete from public.voice_transcriptions','42501');
select pg_temp.expect_error('truncate public.voice_transcriptions','42501');
select pg_temp.expect_error($q$insert into public.voice_transcriptions(id,business_id,user_id,transcript) values('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','forged') on conflict(id) do update set transcript=excluded.transcript$q$,'42501');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000002','transcription')$q$,'42501');
select pg_temp.expect_error($q$select public.get_plan_usage('20000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.check_true(public.get_plan_usage('20000000-0000-4000-8000-000000000001')->>'plan'='free','self-selected Pro is not an activated entitlement');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'42501');
select pg_temp.expect_error($q$update private.business_entitlements set plan='pro'$q$,'42501');
reset role;

insert into private.business_entitlements(business_id,plan,valid_until) values
 ('20000000-0000-4000-8000-000000000001','pro',now()-interval '1 second');
set local role authenticated;
select pg_temp.check_true(public.get_plan_usage('20000000-0000-4000-8000-000000000001')->>'plan'='free','expired Pro is restricted');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'42501');
reset role;
update private.business_entitlements set valid_until=now()+interval '1 day' where business_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(public.get_plan_usage('20000000-0000-4000-8000-000000000001')->>'plan'='pro','activated Pro works');
select pg_temp.check_true((public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')->>'remaining')::int=49,'reservation decrements real SQL budget');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','invalid')$q$,'22023');
reset role;
update private.finviant_ai_attempt_budget set attempts=49,minute_attempts=0;
set local role authenticated;
select pg_temp.check_true((public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')->>'remaining')::int=0,'last monthly attempt is usable');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'P0001');
reset role;
update private.finviant_ai_attempt_budget set attempts=0,minute_attempts=10,minute_start=now();
set local role authenticated;
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'P0001');
reset role;
update private.finviant_ai_attempt_budget set minute_start=now()-interval '2 minutes';
set local role authenticated;
select pg_temp.check_true((public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')->>'remaining')::int=49,'minute window resets');
reset role;
select set_config('request.jwt.claims','{}',true);
delete from public.business_members where user_id='10000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.voice_transcriptions),'membership removal immediately revokes transcript reads');
select pg_temp.expect_error($q$select public.reserve_ai_provider_attempt('20000000-0000-4000-8000-000000000001','transcription')$q$,'42501');
reset role;
select pg_temp.check_true((select count(*)=4 from public.voice_transcriptions),'all denied writes leave canonical transcripts unchanged');
rollback;
