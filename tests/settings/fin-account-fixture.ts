import {readFile} from 'node:fs/promises'
import {finDatabase} from './fin-database-fixture'
export async function accountDatabase(){
 const db=await finDatabase();await db.exec('reset role');
 const baseline=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8');
 for(const table of ['bookkeeping_entries','quickbooks_transactions','quickbooks_connections','document_approvals','business_service_interests']){
 const match=baseline.match(new RegExp('create table "public"\\."'+table+'" \\(([\\s\\S]*?)\\);','i'))!;
 await db.exec('create table public.'+table+' ('+match[1]+');grant select,insert,update,delete on '+table+' to authenticated;');
 }
 await db.exec(`alter table invoices add column if not exists work_completed boolean not null default false;alter table invoices add column if not exists work_completed_at timestamptz;alter table businesses add column if not exists team_size integer default 1;alter table businesses add column if not exists document_accent text default '#2563eb';alter table businesses add column if not exists document_footer text;alter table business_settings add column if not exists default_tax_rate numeric default 0;alter table business_settings add column if not exists pricing_adjustment_percent numeric default 0;alter table bookkeeping_entries add column if not exists job_id uuid;alter table bookkeeping_entries add column if not exists estimate_id uuid;alter table bookkeeping_entries add column if not exists invoice_id uuid;`);
 for(const [file,table] of [['20261102144435_calendar_sync_dashboard.sql','private.calendar_integrations'],['20261103215156_platform_admin_support.sql','private.support_cases'],['20261102152958_record_photos_expenses.sql','public.record_photos']] as const){const sql=await readFile('supabase/migrations/'+file,'utf8');const start=sql.indexOf('create table '+table);await db.exec(sql.slice(start,sql.indexOf('\n);',start)+3));}
 const team=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8');for(const table of ['private.team_invitations','private.team_audit']){const start=team.indexOf('create table '+table);await db.exec(team.slice(start,team.indexOf(';',start)+1));}
 for(const name of ['private.team_state','public.get_team_settings','private.manage_team','public.manage_team_member']){const start=team.indexOf('create function '+name+'(');await db.exec(team.slice(start,team.indexOf('$$;',team.indexOf('as $$',start)+5)+3));}
 await db.exec(`create table private.finviant_ai_attempt_budget(business_id uuid,period date,kind text,attempts integer default 0,minute_start timestamptz default now(),minute_attempts integer default 0,primary key(business_id,period,kind));
 create function private.is_pro(b uuid) returns boolean language sql as $$select exists(select 1 from private.business_entitlements where business_id=b and plan='pro')$$;
 create function public.get_sms_setup_status(b uuid) returns jsonb language sql as $$select '{"owner_mobile_verified":false,"customer_sms_enabled":false}'::jsonb$$;
 create function public.get_plan_usage(b uuid) returns jsonb language sql as $$select '{"plan":"pro"}'::jsonb$$;
 grant select on public.record_photos to authenticated;`);
 await db.exec(await readFile('supabase/migrations/20261104213217_fin_account_coverage.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261104213955_fin_support_reporter_scope.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261104214408_fin_completed_work_guard.sql','utf8'));
 await db.exec('set role authenticated');return db;
}
