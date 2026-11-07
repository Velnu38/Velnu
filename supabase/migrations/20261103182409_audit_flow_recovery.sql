-- Preserve legacy roles and permit corrections to historical drafts. Existing ACLs and tenant checks remain in force.
create or replace function private.manage_team(b uuid,target uuid,action text,member_role text default null,modules text[] default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.businesses where id=b for update;
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can manage users' using errcode='42501';end if;
 if action='revoke' then
  update private.team_invitations set revoked_at=now() where id=target and business_id=b and accepted_at is null and revoked_at is null;
 elsif action in('update','remove') then
  if target=auth.uid() or exists(select 1 from public.business_members where business_id=b and user_id=target and role='owner') then raise exception 'The owner cannot be changed here' using errcode='42501';end if;
  if action='remove' then delete from public.business_members where business_id=b and user_id=target;
  else
   if member_role is null or (member_role not in('office','technician','viewer') and not(member_role='admin' and exists(select 1 from public.business_members where business_id=b and user_id=target and role='admin'))) or modules is null or not(modules <@ array['calendar','jobs','billing','finances']::text[]) or (member_role in('technician','viewer') and modules && array['billing','finances']) then raise exception 'Invalid team permissions' using errcode='22023';end if;
   update public.business_members set role=member_role,access_modules=modules where business_id=b and user_id=target;
  end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 if not found then raise exception 'Member or invitation unavailable' using errcode='P0002';end if;
 insert into private.team_audit(business_id,actor_id,action,target_id) values(b,auth.uid(),action,target);
end $$;

CREATE OR REPLACE FUNCTION public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare d jsonb;t text;it text;fk text;x jsonb;k integer:=0;result jsonb;dt date;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') then raise exception 'Invalid document type';end if;t:=case when document_kind='invoice' then 'invoices' else 'estimates' end;it:=case when document_kind='invoice' then 'invoice_items' else 'estimate_items' end;fk:=document_kind||'_id';execute format('select to_jsonb(d) from public.%I d where id=$1 and business_id=$2 for update',t) into d using document_id,target_business_id;if d is null or d->>'status'<>'draft' then raise exception 'Only an available draft can be edited';end if;if expected_updated_at is null or(d->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'This draft changed in another session. Reload it before saving.' using errcode='40001';end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;if dt is not null and dt<(d->>'issue_date')::date then raise exception 'Due or expiration date cannot precede the issue date';end if;execute format('update public.%I set customer_id=$1,%I=$2,notes=$3,customer_message=$4 where id=$5 and business_id=$6',t,case when document_kind='invoice' then 'due_date' else 'expires_on' end) using(payload->>'customer_id')::uuid,dt,payload->>'notes',payload->>'customer_message',document_id,target_business_id;execute format('delete from public.%I where %I=$1 and business_id=$2',it,fk) using document_id,target_business_id;for x in select value from jsonb_array_elements(payload->'items') loop execute format('insert into public.%I(%I,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,$3,$4,$5,$6,$7)',it,fk) using document_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k;k:=k+1;end loop;execute format('select to_jsonb(d) from public.%I d where id=$1',t) into result using document_id;return result;end$function$;
