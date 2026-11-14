-- Only change new-rule defaults. Preserve every saved rule and activation state.
alter table private.reminder_rules alter column after_days set default 2;
create or replace function public.get_delivery_automation(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(p_business) then raise exception 'Only the primary owner can manage automatic sending.' using errcode='42501';end if;
 return jsonb_build_object('plan',private.effective_plan(p_business),'ready',coalesce((select email_active from private.managed_delivery_accounts where business_id=p_business),false),
 'rule',coalesce((select to_jsonb(r)-'actor_id'-'business_id' from private.reminder_rules r where business_id=p_business),'{"enabled":false,"after_days":2,"repeat_days":7,"max_reminders":3}'::jsonb),
 'tasks',coalesce((select jsonb_agg(x) from(select id,kind,document_id,due_at,reminder,status,last_error from private.delivery_tasks where business_id=p_business order by created_at desc limit 25)x),'[]'::jsonb));
end $$;
