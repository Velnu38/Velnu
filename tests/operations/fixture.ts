import {readFile} from 'node:fs/promises'
import {fixture as base,B,C,I,O,U,user,invoice} from '../tiers/fixture.ts'
export {B,C,I,O,U,user,invoice}
export const J='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',W='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export async function operationsFixture(square=false){const db=await base();try{
 await db.exec(`set check_function_bodies=false;
 alter table public.jobs add unique(id,business_id);alter table public.invoices add unique(id,business_id);
 alter table public.jobs add column if not exists assigned_user_ids uuid[] default '{}',add column if not exists scheduled_end timestamptz,add column if not exists internal_notes text;
 create table private.worker_profiles(business_id uuid,id uuid,display_name text,primary key(business_id,id));
 create table public.bookkeeping_entries(id uuid primary key default gen_random_uuid(),business_id uuid,created_by uuid,entry_date date,direction text,amount numeric,currency text default 'USD',category text,description text,job_id uuid,invoice_id uuid,estimate_id uuid);
 create function private.has_business_role(b uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role=any(roles))$$;
 create function private.can_write_business(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role<>'viewer')$$;
 create function private.require_record_module(b uuid,m text,writing boolean default false) returns void language plpgsql security definer set search_path='' as $$begin if auth.uid() is null or not private.member_module_access(b,auth.uid(),m) or (writing and not private.has_business_role(b,array['owner','admin','office'])) then raise exception 'Access denied' using errcode='42501';end if;end$$;
 update public.business_members set access_modules=array['billing','finances','jobs','calendar'];
 create table public.business_settings(business_id uuid primary key,payment_links jsonb default '[]',payment_service_setups jsonb,payment_instructions text default '');
 insert into private.worker_profiles values('${B}','${W}','Test worker');
 insert into public.jobs(id,business_id,customer_id,title,status) values('${J}','${B}','${C}','Job fixture','lead');
 create table private.payment_test_context(hash text primary key,payload jsonb);
 create function private.document_share_context(p_token_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin select payload into result from private.payment_test_context where hash=p_token_hash;if result is null then raise exception 'Invalid token';end if;return result;end$$;
 create table public.payments(id uuid primary key default gen_random_uuid(),business_id uuid,invoice_id uuid,amount numeric not null check(amount>0),method text,provider text,provider_payment_id text,status text not null,paid_at timestamptz not null,notes text);
 create unique index provider_unique on public.payments(business_id,provider,provider_payment_id);
 `)
 await db.exec(await readFile('supabase/migrations/20261108001511_verified_customer_invoice_payments.sql','utf8'))
 await db.exec(`create trigger commerce_payment_guard before insert or update or delete on public.payments for each row execute function private.commerce_payment_guard();create trigger payments_prevent_overpayment before insert or update on public.payments for each row execute function public.prevent_invoice_overpayment();create trigger commerce_paid_recalc after insert or update or delete on public.payments for each row execute function private.commerce_paid_recalc();`)

 const baseline=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
 for(const fn of ['private.commerce_number','private.commerce_item_guard','private.commerce_recalc','public.create_document']){const a=baseline.indexOf('CREATE OR REPLACE FUNCTION '+fn+'(');await db.exec(baseline.slice(a,baseline.indexOf('$function$;',a)+12))}
 await db.exec(`create trigger commerce_number before insert on invoices for each row execute function private.commerce_number();create trigger commerce_number before insert on estimates for each row execute function private.commerce_number();create trigger item_guard before insert or update or delete on invoice_items for each row execute function private.commerce_item_guard();create trigger item_recalc after insert or update or delete on invoice_items for each row execute function private.commerce_recalc();create trigger item_guard before insert or update or delete on estimate_items for each row execute function private.commerce_item_guard();create trigger item_recalc after insert or update or delete on estimate_items for each row execute function private.commerce_recalc();`)
 await db.exec(await readFile('supabase/migrations/20261109165725_financial_job_workspace.sql','utf8'))
 if(square)await db.exec(await readFile('supabase/migrations/20261109165731_square_payment_workflow.sql','utf8'))
 await db.exec(`create schema if not exists storage;create table if not exists storage.objects(name text,bucket_id text);create table if not exists public.record_photos(id uuid primary key default gen_random_uuid(),business_id uuid,expense_id uuid,storage_path text);`)
 await db.exec(await readFile('supabase/migrations/20261109171432_operations_recovery_polish.sql','utf8'))
 if(square)await db.exec(await readFile('supabase/migrations/20261109171931_operations_foreign_key_indexes.sql','utf8'))
 return db
 }catch(e){await db.close();throw e}}
export async function value(db:any,sql:string,args:unknown[]=[]){return(await db.query(sql,args)).rows[0].value}
export async function service(db:any){await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role")}
