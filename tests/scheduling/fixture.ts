import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

export const ids = {
  owner: '11111111-1111-4111-8111-111111111111', worker: '22222222-2222-4222-8222-222222222222',
  business: '33333333-3333-4333-8333-333333333333', other: '44444444-4444-4444-8444-444444444444',
  customer: '55555555-5555-4555-8555-555555555555', site: '66666666-6666-4666-8666-666666666666',
  outsider: '77777777-7777-4777-8777-777777777777',
}
const baseline = await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
const migration = await readFile('supabase/migrations/20261102221000_guided_scheduling_workflow.sql','utf8')
function fn(name: string) {
  const from = baseline.indexOf('CREATE OR REPLACE FUNCTION '+name+'(')
  if (from < 0) throw new Error('Missing baseline function '+name)
  return baseline.slice(from,baseline.indexOf('$function$;',from)+12)
}
export async function fixture() {
  const db = new PGlite()
  await db.exec(`set check_function_bodies=false;create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text);
    create table business_members(business_id uuid,user_id uuid,role text,access_modules text[] default array['jobs','calendar','billing','finances'],created_at timestamptz default now(),primary key(business_id,user_id));
    create table private.business_entitlements(business_id uuid primary key,plan text,valid_until timestamptz);
    create table public.user_agreement_acceptances(user_id uuid,terms_accepted boolean,ai_disclosure_acknowledged boolean,electronic_records_consent boolean);
    create function private.has_business_role(b uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role=any(roles))$$;
    create function private.member_module_access(b uuid,actor uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=actor and feature=any(access_modules) and (feature not in('billing','finances') or role in('owner','admin','office')))$$;
    create function private.can_write_business(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role<>'viewer')$$;
    create function private.html_escape(value text) returns text language sql immutable as $$select replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;')$$;
    grant usage on schema public,private,auth to authenticated;grant execute on function auth.uid() to authenticated;
  `)
  for(const table of ['businesses','customers','properties','jobs','appointments','estimates','invoices','estimate_items','invoice_items','business_settings','messages']) {
    const match=baseline.match(new RegExp('create table "public"\\."'+table+'" \\(([\\s\\S]*?)\\);','i'))
    if(!match) throw new Error('Missing table '+table)
    await db.exec('create table public.'+table+' ('+match[1]+');')
    await db.exec('alter table public.'+table+' add primary key ('+(table==='business_settings'?'business_id':'id')+');')
    if(table!=='business_settings') await db.exec('alter table public.'+table+' add unique(id,business_id);'.replace(table==='businesses'?'id,business_id':'__unused__',table==='businesses'?'id':'__unused__'))
  }
  await db.exec(`create table public.document_schedules(id uuid primary key default gen_random_uuid(),business_id uuid,estimate_id uuid,invoice_id uuid,job_title text,description text,timezone text,status text,scheduled_start_time timestamptz,scheduled_end_time timestamptz);
    create table private.finviant_email_outbox(id uuid primary key,business_id uuid,actor_id uuid,document_kind text,document_id uuid,payload jsonb,status text default 'queued',attempts int default 0,lease_id uuid,lease_until timestamptz,provider_id text,created_at timestamptz default now(),next_attempt_at timestamptz default now(),last_code text,last_event_at timestamptz,
    constraint finviant_email_outbox_document_kind_check check(document_kind in('invoice','estimate','change_order')));
    create unique index invoices_one_estimate on invoices(estimate_id);
    grant select,insert,update,delete on all tables in schema public to authenticated;
  `)
  for(const name of ['private.commerce_document_guard','private.commerce_identity_guard','private.commerce_item_guard','private.commerce_recalc','private.velnu_financial_role_guard','private.finviant_sync_job_status','public.convert_estimate_to_invoice']) await db.exec(fn(name))
  for(const table of ['estimates','invoices']) await db.exec(`create trigger document_guard before insert or update or delete on ${table} for each row execute function private.commerce_document_guard();
    create trigger identity_guard before update on ${table} for each row execute function private.commerce_identity_guard();
    create trigger finance_guard before insert or update or delete on ${table} for each row execute function private.velnu_financial_role_guard();`)
  for(const table of ['estimate_items','invoice_items']) await db.exec(`create trigger item_guard before insert or update or delete on ${table} for each row execute function private.commerce_item_guard();
    create trigger item_recalc after insert or update or delete on ${table} for each row execute function private.commerce_recalc();
    create trigger finance_guard before insert or update or delete on ${table} for each row execute function private.velnu_financial_role_guard();`)
  await db.exec('create trigger job_status after update of status on jobs for each row execute function private.finviant_sync_job_status();')
  // The deployed calendar view already exists before the additive migration.
  const calendar=await readFile('supabase/migrations/20261102144435_calendar_sync_dashboard.sql','utf8')
  await db.exec(calendar.slice(calendar.indexOf('create view public.calendar_work'),calendar.indexOf('-- A unified projection')))
  await db.exec(migration)
  await db.exec(await readFile('supabase/migrations/20261103004720_dashboard_attention_calendar_sync.sql','utf8'))
  await db.exec(`insert into auth.users values('${ids.owner}','owner@example.test'),('${ids.worker}','worker@example.test'),('${ids.outsider}','outsider@example.test');
    select set_config('request.jwt.claim.sub','${ids.owner}',false);
    insert into businesses(id,name) values('${ids.business}','Test Trades'),('${ids.other}','Other');
    insert into business_members(business_id,user_id,role) values('${ids.business}','${ids.owner}','owner'),('${ids.business}','${ids.worker}','technician'),('${ids.other}','${ids.outsider}','owner');
    insert into private.business_entitlements values('${ids.business}','pro',null);
    insert into user_agreement_acceptances values('${ids.owner}',true,true,true);
    insert into customers(id,business_id,first_name,email) values('${ids.customer}','${ids.business}','Customer','customer@example.test');
    insert into properties(id,business_id,customer_id,address_line1) values('${ids.site}','${ids.business}','${ids.customer}','1 Test Street');
    insert into business_settings(business_id) values('${ids.business}');
    set role authenticated;`)
  return db
}
export const actor=(db:PGlite,id:string)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
export async function estimate(db:PGlite) {
  const e=(await db.query<{id:string}>(`insert into estimates(business_id,customer_id,property_id) values($1,$2,$3) returning id`,[ids.business,ids.customer,ids.site])).rows[0].id
  await db.query(`insert into estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Mow and trim',2,50,5,0)`,[e,ids.business])
  await db.query("update estimates set status='accepted' where id=$1",[e])
  return e
}
