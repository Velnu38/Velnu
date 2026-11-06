import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
export const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',I='55555555-5555-4555-8555-555555555555'
export async function fixture(){
 const db=new PGlite()
 await db.exec(`create schema auth;create schema private;create schema extensions;create role anon;create role authenticated;create role service_role;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat(md5(gen_random_uuid()::text),2),'hex')$$;
 create function private.valid_payment_links(jsonb) returns boolean language sql immutable as $$select true$$;
 grant usage on schema public,auth,private to authenticated,service_role,anon;`)
 await db.exec(await readFile('tests/tiers/schema.sql','utf8'))
 await db.exec(`create function private.is_business_member(target_business_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=target_business_id and user_id=auth.uid())$$;
 create function private.is_primary_owner(b uuid,actor uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.businesses x join public.business_members m on m.business_id=x.id and m.user_id=actor and m.role='owner' where x.id=b and x.created_by_user_id=actor)$$;
 create function private.fin_access(b uuid,resource text,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and(not writing or role in('owner','office','admin')))$$;
 create function private.member_module_access(b uuid,actor uuid,feature text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=actor and feature=any(access_modules))$$;
 create function private.can_manage_schedule(b uuid,actor uuid default auth.uid()) returns boolean language sql as $$select private.member_module_access(b,actor,'calendar')$$;
 create function private.sms_owner_phone_verified(b uuid) returns boolean language sql as $$select true$$;
 create function private.attachment_limit(plan_name text) returns bigint language sql as $$select case plan_name when 'pro' then 10000000000 when 'basic' then 2000000000 else 100000000 end$$;
 create function private.commerce_quota() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger commerce_quota before insert on customers for each row execute function private.commerce_quota();
 create function private.html_escape(value text) returns text language sql as $$select value$$;
 create function private.invoice_payment_url(provider text,url text,balance numeric,reference text,currency text) returns text language sql as $$select url$$;
 insert into auth.users values('${U}'),('${O}');
 insert into businesses(id,name,created_by_user_id,email) values('${B}','Test Company','${U}','owner@example.test');
 insert into business_members(business_id,user_id,role) values('${B}','${U}','owner'),('${B}','${O}','office');
 insert into user_agreement_acceptances(user_id,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values('${U}',true,true,true);
 insert into private.business_entitlements(business_id,plan) values('${B}','pro');
 insert into private.test_account_slots(slot,user_id) values(1,'${U}');
 `)
 const reminder=await readFile('supabase/migrations/20261105161826_invoice_payment_reminders.sql','utf8');const a=reminder.indexOf('create function private.invoice_reminder_review('),b=reminder.indexOf('$$;',a);await db.exec(reminder.slice(a,b+3))
 await db.exec(await readFile('supabase/migrations/20261106150713_tier_entitlements_and_personal_delivery.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261106151510_managed_messaging_and_reminders.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261106161000_revalidate_queued_delivery.sql','utf8'))
 await db.exec(`update private.workspace_feature_flags set enabled=true where name='tier_testing';grant select,insert,update,delete on all tables in schema public to authenticated;create function public.get_plan_usage(target_business_id uuid) returns jsonb language sql as $$select private.get_plan_usage(target_business_id)$$;grant execute on function private.get_plan_usage(uuid) to authenticated;
 create trigger commerce_quota before insert on invoices for each row execute function private.commerce_quota();
 select set_config('request.jwt.claim.sub','${U}',false);`)
 return db
}
export async function user(db:PGlite,id=U){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)}
export async function plan(db:PGlite,tier:string|null){await user(db);return (await db.query<{s:any}>('select set_tier_test($1,$2) s',[B,tier])).rows[0].s}
export async function invoice(db:PGlite){await db.exec('reset role');await db.query("insert into customers(id,business_id,first_name,email,phone) values($1,$2,'Jordan','jordan@example.test','+17575550123') on conflict do nothing",[C,B]);await db.query("insert into invoices(id,business_id,customer_id,invoice_number,status,total,subtotal,issue_date,due_date) values($1,$2,$3,'INV-1','draft',100,100,current_date,current_date-7) on conflict do nothing",[I,B,C]);await db.query("insert into invoice_items(business_id,invoice_id,description,quantity,unit_price) values($1,$2,'Mowing',1,100)",[B,I])}
