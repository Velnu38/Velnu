-- Guard even idempotent/replayed AI action receipts after a user's business membership changes.
-- The private transactional function is intentionally not exposed by the PostgREST API.
create or replace function public.execute_ai_mutation(p_action_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare target_business uuid;
begin
  if (select auth.uid()) is null or p_action_id is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  select a.business_id into target_business from public.ai_actions a
  where a.id=p_action_id and a.user_id=(select auth.uid());
  if target_business is null or not private.can_write_business(target_business) then
    raise exception 'Business access denied' using errcode='42501';
  end if;
  return private.finviant_execute_ai_mutation(p_action_id);
end;
$fn$;
revoke all on function public.execute_ai_mutation(uuid) from public,anon;
grant execute on function public.execute_ai_mutation(uuid) to authenticated;
