-- Releasing an explicitly voided invoice allows the original expense to be
-- corrected or billed again, without deleting either invoice's history.
create or replace function private.bill_expense_to_draft(p_business uuid,p_expense uuid,p_customer uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.bookkeeping_entries%rowtype; existing uuid;customer uuid;document jsonb;
begin
 if auth.uid() is null or not private.member_module_access(p_business,auth.uid(),'finances') or not private.member_module_access(p_business,auth.uid(),'billing') or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Financial and billing access required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-billing:'||p_business::text||':'||p_expense::text,0));
 select * into e from public.bookkeeping_entries where business_id=p_business and id=p_expense for update;
 if not found then raise exception 'Expense unavailable.' using errcode='42501';end if;
 select invoice_id into existing from private.expense_invoice_drafts where business_id=p_business and expense_id=p_expense;
 if found and exists(select 1 from public.invoices where id=existing and business_id=p_business and status='void') then delete from private.expense_invoice_drafts where expense_id=p_expense and business_id=p_business;existing:=null;end if;
 if existing is not null then return jsonb_build_object('id',existing,'existing',true,'status',(select status from public.invoices where id=existing and business_id=p_business));end if;
 if exists(select 1 from public.record_photos p where p.business_id=p_business and p.expense_id=p_expense and not exists(select 1 from storage.objects o where o.bucket_id='finviant-record-photos' and o.name=p.storage_path)) then raise exception 'The receipt upload or removal is not confirmed. Review its receipt before billing this expense.' using errcode='23514';end if;
 if e.direction<>'expense' or e.currency<>'USD' or e.invoice_id is not null then raise exception 'Choose an unbilled USD expense that is not already attached to an invoice.' using errcode='23514';end if;
 if e.job_id is not null then select customer_id into customer from public.jobs where id=e.job_id and business_id=p_business;
 elsif e.estimate_id is not null then select customer_id into customer from public.estimates where id=e.estimate_id and business_id=p_business;end if;
 if customer is not null and p_customer is distinct from customer then raise exception 'Bill this expense to the customer on its source record.' using errcode='23514';end if;
 if not exists(select 1 from public.customers where id=p_customer and business_id=p_business and not archived) then raise exception 'Choose a current customer from this business.' using errcode='42501';end if;
 document:=public.create_document(p_business,'invoice',p_request,jsonb_build_object('customer_id',p_customer,'due_date',(now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date,'notes','Expense reimbursement draft. Review the receipt, tax treatment and customer agreement before sending.','items',jsonb_build_array(jsonb_build_object('description',e.description,'quantity',1,'unit_price',e.amount,'tax_rate',0))));
 if document->>'status' is distinct from 'draft' then raise exception 'This request belongs to an earlier invoice. Open the saved invoice or start a new billing request.' using errcode='23514';end if;
 if e.job_id is not null then update public.invoices set job_id=e.job_id where id=(document->>'id')::uuid and business_id=p_business and status='draft';end if;
 insert into private.expense_invoice_drafts(expense_id,business_id,invoice_id) values(p_expense,p_business,(document->>'id')::uuid);
 return jsonb_build_object('id',document->>'id','existing',false,'status','draft');
end $$;
create function private.release_void_expense_billing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='void' and old.status is distinct from 'void' then
  delete from private.expense_invoice_drafts where business_id=new.business_id and invoice_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.release_void_expense_billing() from public,anon,authenticated,service_role;
create trigger release_void_expense_billing after update of status on public.invoices for each row execute function private.release_void_expense_billing();

-- Receipt removal and expense billing use the same transaction lock. A billed
-- receipt cannot disappear before a financial-row delete fails, and a receipt
-- removed just before billing is detected instead of silently losing evidence.
create function private.can_remove_unbilled_receipt(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare photo public.record_photos%rowtype;
begin
 select * into photo from public.record_photos where storage_path=p_path;
 if not found or photo.expense_id is null then return true;end if;
 if auth.uid() is null or not private.member_module_access(photo.business_id,auth.uid(),'finances') or not private.has_business_role(photo.business_id,array['owner','admin','office']) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-billing:'||photo.business_id::text||':'||photo.expense_id::text,0));
 return not exists(select 1 from private.expense_invoice_drafts where business_id=photo.business_id and expense_id=photo.expense_id);
end $$;
revoke all on function private.can_remove_unbilled_receipt(text) from public,anon,authenticated,service_role;
grant execute on function private.can_remove_unbilled_receipt(text) to authenticated;
create policy protect_billed_receipt_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'finviant-record-photos' or private.can_remove_unbilled_receipt(name));
