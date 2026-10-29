-- Staging only. Preserve historic acceptance records and stable internal function name.
create or replace function private.velnu_has_accepted_terms()
returns boolean language sql stable security definer set search_path=''
as $fn$
  select (select auth.uid()) is not null and exists (
    select 1 from public.user_agreement_acceptances a
    where a.user_id=(select auth.uid())
      and a.terms_accepted and a.ai_disclosure_acknowledged
      and a.electronic_records_consent
      and a.agreement_version in ('2026-10-26-v1','2026-10-26-v2','2026-10-27-v3')
  );
$fn$;
revoke all on function private.velnu_has_accepted_terms() from public, anon;
grant execute on function private.velnu_has_accepted_terms() to authenticated;
drop policy if exists velnu_agreement_acceptance_insert on public.user_agreement_acceptances;
create policy velnu_agreement_acceptance_insert on public.user_agreement_acceptances
for insert to authenticated
with check (
  user_id=(select auth.uid())
  and agreement_version='2026-10-27-v3'
  and terms_accepted=true and ai_disclosure_acknowledged=true
  and electronic_records_consent=true and acceptance_method='checkbox_and_button'
  and selected_tier_at_acceptance is not null
  and exists (
    select 1 from public.user_plan_preferences p
    where p.user_id=(select auth.uid())
      and p.selected_tier=user_agreement_acceptances.selected_tier_at_acceptance
  )
);
comment on function private.velnu_has_accepted_terms() is 'Legacy stable internal name; validates Finviant Office terms acceptance, including historic versions.';
