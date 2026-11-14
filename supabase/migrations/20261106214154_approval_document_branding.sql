-- The customer approval function resolves branding after validating its bearer link.
create function public.approval_document_has_finviant_branding(p_business uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select private.effective_plan(p_business) = 'free';
$$;

revoke all on function public.approval_document_has_finviant_branding(uuid) from public, anon, authenticated;
grant execute on function public.approval_document_has_finviant_branding(uuid) to service_role;
