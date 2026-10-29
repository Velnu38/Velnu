-- Freeze the business's public-facing identity at the moment a document first leaves draft.
-- Existing already-issued documents remain NULL rather than inventing historical details.
alter table public.invoices add column if not exists issuer_snapshot jsonb;
alter table public.estimates add column if not exists issuer_snapshot jsonb;
alter table public.change_orders add column if not exists issuer_snapshot jsonb;

create or replace function private.velnu_freeze_document_issuer()
returns trigger
language plpgsql security invoker
set search_path = ''
as $fn$
declare details jsonb;
begin
  if tg_op = 'INSERT' then
    new.issuer_snapshot := null;
    return new;
  end if;

  -- Clients cannot supply or rewrite a frozen identity on an existing row.
  if new.issuer_snapshot is distinct from old.issuer_snapshot then
    raise exception 'Issued company identity is read only';
  end if;

  if old.status = 'draft' and new.status <> 'draft' then
    select jsonb_build_object(
      'name', b.name,
      'legal_name', b.legal_name,
      'email', b.email,
      'phone', b.phone,
      'website', b.website,
      'address_line1', b.address_line1,
      'address_line2', b.address_line2,
      'city', b.city,
      'state', b.state,
      'postal_code', b.postal_code,
      'logo_path', b.logo_path,
      'document_accent', b.document_accent,
      'document_footer', b.document_footer
    ) into details
    from public.businesses b
    where b.id = new.business_id;

    if details is null then
      raise exception 'Company profile unavailable; cannot issue this document';
    end if;
    new.issuer_snapshot := details;
  end if;
  return new;
end;
$fn$;

drop trigger if exists velnu_freeze_issuer on public.invoices;
create trigger velnu_freeze_issuer
before insert or update on public.invoices
for each row execute function private.velnu_freeze_document_issuer();

drop trigger if exists velnu_freeze_issuer on public.estimates;
create trigger velnu_freeze_issuer
before insert or update on public.estimates
for each row execute function private.velnu_freeze_document_issuer();

drop trigger if exists velnu_freeze_issuer on public.change_orders;
create trigger velnu_freeze_issuer
before insert or update on public.change_orders
for each row execute function private.velnu_freeze_document_issuer();

comment on column public.invoices.issuer_snapshot is 'Immutable public business issuer information captured on first draft -> issued status transition.';
comment on column public.estimates.issuer_snapshot is 'Immutable public business issuer information captured on first draft -> issued status transition.';
comment on column public.change_orders.issuer_snapshot is 'Immutable public business issuer information captured on first draft -> issued status transition.';
