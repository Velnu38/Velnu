import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const b='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', u='33333333-3333-4333-8333-333333333333', tech='44444444-4444-4444-8444-444444444444'
const migration=await readFile(new URL('../../supabase/migrations/20261106141538_business_storage_limits.sql',import.meta.url),'utf8')
async function setup() {
 const db=new PGlite()
 await db.exec(await readFile(new URL('../calendar/fixture.sql',import.meta.url),'utf8'))
 await db.exec(`
 alter table businesses add created_by_user_id uuid;
 create table private.business_entitlements(business_id uuid primary key,plan text check(plan in ('free','pro')),valid_until timestamptz);
 create table public.user_agreement_acceptances(user_id uuid,agreement_version text,terms_accepted boolean,ai_disclosure_acknowledged boolean,electronic_records_consent boolean,acceptance_method text,selected_tier_at_acceptance text);
 create table public.user_plan_preferences(user_id uuid,selected_tier text);
 alter table user_agreement_acceptances enable row level security;
 create policy velnu_agreement_acceptance_insert on user_agreement_acceptances for insert to authenticated with check(false);
 create function private.velnu_has_accepted_terms() returns boolean language sql as $$select true$$;
 create function private.is_business_member(b uuid) returns boolean language sql stable security definer set search_path='' as $$select private.velnu_has_accepted_terms() and exists(select 1 from public.business_members where business_id=b and user_id=auth.uid())$$;
 create function private.has_business_role(b uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$select private.is_business_member(b) and exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role=any(roles))$$;
 create function private.is_primary_owner(b uuid,actor uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.businesses where id=b and created_by_user_id=actor)$$;
 create function private.member_module_access(b uuid,actor uuid,m text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.business_members where business_id=b and user_id=actor and m=any(access_modules))$$;
 create schema storage;
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 create policy legacy_insert on storage.objects for insert to authenticated with check(true);
 create policy legacy_read on storage.objects for select to authenticated using(split_part(name,'/',1)='${b}');
 create policy legacy_delete on storage.objects for delete to authenticated using(split_part(name,'/',1)='${b}');
 grant usage on schema private,storage to authenticated,service_role;
 grant select,insert,update,delete on storage.objects to authenticated;
 create table public.record_photos(id uuid primary key default gen_random_uuid(),business_id uuid,job_id uuid,byte_size bigint,storage_path text,created_by uuid);
 insert into businesses(id,created_by_user_id) values('${b}','${u}'),('${other}','${other}');
 insert into business_members(business_id,user_id,role) values('${b}','${u}','owner'),('${b}','${tech}','technician');
 insert into user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values('${u}','2026-10-27-v3',true,true,true),('${tech}','2026-10-27-v3',true,true,true);
 `)
 await db.exec(migration)
 return db
}
async function reserve(db:PGlite,bytes:number,actor=u,job=true) {
 const id=crypto.randomUUID(),path=`${b}/${id}.jpg`
 await db.query('insert into record_photos(business_id,job_id,byte_size,storage_path,created_by) values($1,$2,$3,$4,$5)',[b,job?b:null,bytes,path,actor])
 await db.exec('set role service_role')
 try { await db.query('select public.reserve_attachment($1,$2,$3,$4)',[actor,'finviant-record-photos',path,bytes]) }
 finally { await db.exec('reset role') }
 return path
}
async function usage(db:PGlite,actor=u,business=b) {
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false)`)
 try { return (await db.query<{value:any}>('select get_business_storage_usage($1) value',[business])).rows[0].value }
 finally {await db.exec('reset role')}
}
test('storage: exact quota includes pending uploads, shares users, counts completion once and reclaims deleted files',async()=>{
 const db=await setup()
 try {
  const paths=[]
  for(let n=0;n<10;n++) paths.push(await reserve(db,10_000_000,n%2?tech:u))
  assert.equal((await usage(db)).warning,'full')
  await assert.rejects(()=>reserve(db,1),/allowance reached/)
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['finviant-record-photos',paths[0],{size:10_000_000}])
  assert.equal((await usage(db)).used_bytes,100_000_000)
  await db.query('select private.finish_attachment($1,$2)',['finviant-record-photos',paths[0]])
  assert.equal((await usage(db)).used_bytes,100_000_000)
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`)
  assert.equal((await db.query('select * from storage.objects')).rows.length,1)
  await db.query('delete from storage.objects where name=$1',[paths[0]])
  await db.exec('reset role')
  assert.equal((await usage(db)).used_bytes,90_000_000)
  await reserve(db,10_000_000)
 } finally {await db.close()}
})
test('storage: 100 MB / 2 GB / 10 GB, expired entitlements, downgrade and warning boundaries',async()=>{
 const db=await setup()
 try {
  assert.equal((await usage(db)).limit_bytes,100_000_000)
  await db.query('insert into private.business_entitlements(business_id,plan) values($1,$2)',[b,'basic'])
  assert.equal((await usage(db)).limit_bytes,2_000_000_000)
  await db.exec("update private.business_entitlements set plan='pro'")
  assert.equal((await usage(db)).limit_bytes,10_000_000_000)
  await db.exec("update private.business_entitlements set valid_until=now()-interval '1 day'")
  assert.equal((await usage(db)).limit_bytes,100_000_000)
  for(let n=0;n<8;n++) await reserve(db,10_000_000)
  assert.equal((await usage(db)).warning,'warning')
  await reserve(db,10_000_000);await reserve(db,5_000_000)
  assert.equal((await usage(db)).warning,'critical')
 } finally {await db.close()}
})
test('storage: tenant isolation, role/module restrictions and direct upload / reservation bypasses denied',async()=>{
 const db=await setup()
 try {
  await assert.rejects(()=>usage(db,u,other),/Not authorized/)
  await assert.rejects(()=>reserve(db,1,tech,false),/Photo access/)
  await db.exec(`update business_members set access_modules='{}' where user_id='${tech}'`)
  await assert.rejects(()=>reserve(db,1,tech),/Photo access/)
  await db.exec('set role authenticated')
  await assert.rejects(()=>db.query('select public.reserve_attachment($1,$2,$3,$4)',[u,'finviant-record-photos',`${b}/${crypto.randomUUID()}.jpg`,1]),/permission denied/)
  await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('finviant-record-photos','x')"),/row-level security/)
  await db.exec('reset role;set role anon')
  await assert.rejects(()=>db.query('select get_business_storage_usage($1)',[b]),/permission denied/)
 } finally {await db.close()}
})
test('storage: logos need paid primary owner, file limits and uncertain reservations fail closed',async()=>{
 const db=await setup()
 try {
  const logo=(actor=u,size=2_000_000)=>db.query('select private.reserve_attachment($1,$2,$3,$4)',[actor,'velnu-business-logos',`${b}/logo-${crypto.randomUUID()}.png`,size])
  await assert.rejects(()=>logo(),/activated paid plan/)
  await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro')",[b])
  await assert.rejects(()=>logo(tech),/owner access/)
  await assert.rejects(()=>logo(u,2_000_001),/at most/)
  await logo()
  await assert.rejects(()=>reserve(db,10_000_001),/record_photos_upload_size/)
  const path=await reserve(db,1)
  await db.query('select private.finish_attachment($1,$2)',['finviant-record-photos',path])
  assert.equal((await usage(db)).pending_bytes,2_000_001)
 } finally {await db.close()}
})
