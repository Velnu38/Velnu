create table if not exists public.finviant_qa_profiles (
 dataset_id text not null check(dataset_id='finviant-chaos-v1'),
 scenario_id integer not null check(scenario_id between 1 and 1000),
 function_name text not null,
 batch smallint not null check(batch between 1 and 10),
 profile jsonb not null check(jsonb_typeof(profile)='object' and profile->>'synthetic'='true'),
 primary key(dataset_id,scenario_id),
 check(function_name= (array['createInvoice','createEstimate','createChangeOrder','recordPayment','addManualEntry','listVelnuWorkbook','listQuickBooksWorkbook','getDashboardSnapshot','parseQuickInvoice','assistantMonthlyTotal'])[batch])
);
alter table public.finviant_qa_profiles enable row level security;
revoke all on public.finviant_qa_profiles from public,anon,authenticated,service_role;
grant select on public.finviant_qa_profiles to anon,authenticated,service_role;
create policy qa_synthetic_read_only on public.finviant_qa_profiles for select to anon,authenticated using(dataset_id='finviant-chaos-v1' and profile->>'synthetic'='true');
comment on table public.finviant_qa_profiles is 'Staging-only synthetic QA inputs. Exactly 1000 scenarios in dataset finviant-chaos-v1. No customer PII, secrets, or production entitlements. Anonymous reads intentional; all browser writes denied.';
