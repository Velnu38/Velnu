insert into public.finviant_qa_profiles
select 'finviant-chaos-v1', (b-1)*100+p.scenario_id,
(array['createInvoice','createEstimate','createChangeOrder','recordPayment','addManualEntry','listVelnuWorkbook','listQuickBooksWorkbook','getDashboardSnapshot','parseQuickInvoice','assistantMonthlyTotal'])[b],b,
p.profile || jsonb_build_object('owner',p.profile->'owner'||jsonb_build_object('name','QA Business '||((b-1)*100+p.scenario_id),'email','qa-'||((b-1)*100+p.scenario_id)||'@example.invalid'),'test',
case when b in(2,3) then p.profile->'test'
when b in(4,5) then jsonb_build_object('expect',case when p.scenario_id%2=0 then 'accept' else 'reject' end,'input',case when p.scenario_id%2=1 then 'null'::jsonb when b=4 then jsonb_build_object('invoice_id','22222222-2222-4222-8222-222222222222','amount',p.scenario_id*1.01,'method','cash') else jsonb_build_object('id',gen_random_uuid(),'business_id','11111111-1111-4111-8111-111111111111','entry_date','2028-02-29','direction','expense','amount',p.scenario_id*1.01,'category','QA','description','QA entry '||p.scenario_id) end)
when b in(6,7) then jsonb_build_object('expect',case when p.scenario_id<=80 then 'accept' else 'reject' end,'input',jsonb_build_object('size',p.scenario_id*11,'amount',p.scenario_id*1.01,'fault',case when p.scenario_id<=80 then null else 'bad-amount' end))
when b=8 then jsonb_build_object('expect',case when p.scenario_id<=80 then 'accept' else 'reject' end,'input',jsonb_build_object('count',p.scenario_id,'balance',p.scenario_id*1.01,'fault',case when p.scenario_id<=80 then null else 'bad-amount' end))
when b=9 then jsonb_build_object('expect',case when p.scenario_id%2=0 then 'accept' else 'empty' end,'amount',(p.scenario_id*1.01)::text,'input','Create invoice for QA'||p.scenario_id||' for service: Repair '||case when p.scenario_id%2=0 then '$'||(p.scenario_id*1.01)::text else 'refund $20' end)
else jsonb_build_object('expect',case when p.scenario_id%2=0 then 'accept' else 'reject' end,'input',jsonb_build_object('tier',case when p.scenario_id%2=0 then 'pro' else 'rogue' end,'choices',jsonb_build_array('scheduling_assistant','scheduling_assistant')))
end)
from public.finviant_qa_profiles p cross join generate_series(2,10) b
where p.batch=1 on conflict do nothing;
