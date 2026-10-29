-- Restrict historical financial AI receipts after a user's finance role is removed.
drop policy if exists ai_actions_own_read on public.ai_actions;
create policy ai_actions_own_read on public.ai_actions for select to authenticated
using (user_id=(select auth.uid()) and private.is_business_member(business_id)
  and (coalesce(intent,'') not in ('create_invoice','create_estimate','record_payment','create_change_order')
    or exists(select 1 from public.business_members bm where bm.business_id=ai_actions.business_id
      and bm.user_id=(select auth.uid()) and bm.role in ('owner','admin','office'))));
create or replace function public.execute_ai_mutation(p_action_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare target_business uuid; target_intent text; actor_role text;
begin
  if auth.uid() is null or p_action_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select a.business_id,a.intent into target_business,target_intent from public.ai_actions a where a.id=p_action_id and a.user_id=auth.uid();
  if target_business is null or not private.can_write_business(target_business) then raise exception 'Business access denied' using errcode='42501'; end if;
  select bm.role into actor_role from public.business_members bm where bm.business_id=target_business and bm.user_id=auth.uid() for share;
  if actor_role is null or (target_intent in ('create_invoice','create_estimate','record_payment','create_change_order') and actor_role not in ('owner','admin','office')) then
    raise exception 'Business access denied' using errcode='42501'; end if;
  return private.finviant_execute_ai_mutation(p_action_id);
end;
$$;
revoke all on function public.execute_ai_mutation(uuid) from public,anon;
grant execute on function public.execute_ai_mutation(uuid) to authenticated;
