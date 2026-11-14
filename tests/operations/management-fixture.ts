import {readFile} from 'node:fs/promises'
import {operationsFixture} from './fixture.ts'
export {B,C,I,J,O,U,W,invoice,user,value} from './fixture.ts'
export async function managementFixture(){const db=await operationsFixture();try{
 await db.exec(`reset role;alter table public.change_orders add column change_totals jsonb,add column if not exists source_invoice_id uuid;alter table auth.users add column raw_user_meta_data jsonb default '{}';alter table private.worker_profiles add column active boolean default true;create function private.lock_job_for_scheduling(job uuid) returns public.jobs language plpgsql security definer set search_path='' as $$declare j public.jobs;begin select * into j from public.jobs where id=job for update;if not private.member_module_access(j.business_id,auth.uid(),'calendar') then raise exception 'Scheduling access required' using errcode='42501';end if;if j.status in('completed','canceled') then raise exception 'Reopen job';end if;return j;end$$;`)
 await db.exec(`create function private.change_order_billing_state(c public.change_orders) returns jsonb language sql as $$select jsonb_build_object('action',case when c.status='approved' then 'add_to_draft' else 'awaiting_approval' end)$$;`)
 await db.exec(await readFile('supabase/migrations/20261109184128_job_management_workspace.sql','utf8'))
 return db
 }catch(e){await db.close();throw e}}
