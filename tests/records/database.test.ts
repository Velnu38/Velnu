import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const b='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222',
  u='33333333-3333-4333-8333-333333333333', j='44444444-4444-4444-8444-444444444444',
  e='55555555-5555-4555-8555-555555555555', i='66666666-6666-4666-8666-666666666666'
const fixture=await readFile(new URL('../calendar/fixture.sql',import.meta.url),'utf8')
const migration=await readFile(new URL('../../supabase/migrations/20261102152958_record_photos_expenses.sql',import.meta.url),'utf8')
async function setup() {
  const db=new PGlite()
  await db.exec(fixture)
  await db.exec(`
    alter table jobs add unique(id,business_id);
    create function private.has_business_role(b uuid, roles text[]) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.business_members m where m.business_id=b and m.user_id=auth.uid() and m.role=any(roles))$$;
    grant usage on schema private to authenticated;
    create table bookkeeping_entries(id uuid primary key default gen_random_uuid(),business_id uuid,created_by uuid default auth.uid(),direction text,amount numeric(14,2));
    alter table bookkeeping_entries enable row level security;
    grant select,insert,delete on bookkeeping_entries to authenticated;
    create policy finance on bookkeeping_entries to authenticated using(private.has_business_role(business_id,array['owner','admin','office'])) with check(private.has_business_role(business_id,array['owner','admin','office']) and created_by=auth.uid());
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
  `)
  await db.exec(migration)
  await db.exec(`insert into auth.users values('${u}');insert into businesses(id) values('${b}'),('${other}');
    insert into business_members values('${b}','${u}','owner');
    insert into jobs(id,business_id,title) values('${j}','${b}','Repair');
    insert into estimates(id,business_id) values('${e}','${b}');insert into invoices(id,business_id) values('${i}','${b}');
    set role authenticated;select set_config('request.jwt.claim.sub','${u}',false);`)
  return db
}
async function photo(db:PGlite, column='job_id',target=j,business=b) {
  return (await db.query<{id:string;storage_path:string}>(`insert into record_photos(business_id,${column},file_name,byte_size,media_type) values($1,$2,'receipt.png',200,'image/png') returning id,storage_path`,[business,target])).rows[0]
}
test('record resources: all three targets persist photos and expenses; private object paths are immutable',async()=>{
  const db=await setup()
  try {
    for (const [column,target] of [['job_id',j],['estimate_id',e],['invoice_id',i]]) {
      const p=await photo(db,column,target)
      assert.equal(p.storage_path,`${b}/${p.id}.png`)
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['finviant-record-photos',p.storage_path])
      await db.query(`insert into bookkeeping_entries(business_id,${column},direction,amount) values($1,$2,'expense',24.75)`,[b,target])
    }
    assert.equal((await db.query<{total:string}>('select sum(amount) total from bookkeeping_entries')).rows[0].total,'74.25')
    assert.equal((await db.query('select * from storage.objects')).rows.length,3)
    assert.equal((await db.query("update storage.objects set name='forged' returning id")).rows.length,0)
    await assert.rejects(()=>db.query("update record_photos set file_name='changed'"),/permission denied/)
    await db.exec('reset role')
    assert.equal((await db.query<{public:boolean}>('select public from storage.buckets')).rows[0].public,false)
  } finally { await db.close() }
})
test('record resources: tenant forgery, mismatched targets, missing targets and unsupported images are rejected',async()=>{
  const db=await setup()
  try {
    await photo(db)
    await assert.rejects(()=>photo(db,'job_id',j,other),/row-level security/)
    await assert.rejects(()=>photo(db,'job_id',e),/foreign key/)
    await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('finviant-record-photos','forged.jpg')"),/row-level security/)
    await assert.rejects(()=>db.query(`insert into record_photos(business_id,file_name,byte_size,media_type) values('${b}','x.svg',20,'image/svg+xml')`),/check constraint/)
    await assert.rejects(()=>db.query(`insert into bookkeeping_entries(business_id,job_id,estimate_id,direction,amount) values('${b}','${j}','${e}','expense',1)`),/check constraint/)
    await assert.rejects(()=>db.query(`insert into bookkeeping_entries(business_id,job_id,direction,amount) values('${b}','${j}','income',1)`),/check constraint/)
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`)
    assert.equal((await db.query('select * from record_photos')).rows.length,0)
    assert.equal((await db.query('select * from storage.objects')).rows.length,0)
    assert.equal((await db.query('select * from bookkeeping_entries')).rows.length,0)
    await db.exec('reset role;set role anon;')
    await assert.rejects(()=>db.query('select * from record_photos'),/permission denied/)
  } finally { await db.close() }
})
test('record resources: field staff can add job photos but cannot access financial document photos or expenses; viewers cannot upload',async()=>{
  const db=await setup()
  try {
    await photo(db,'invoice_id',i)
    await db.exec(`reset role;update business_members set role='technician';set role authenticated`)
    const p=await photo(db)
    await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['finviant-record-photos',p.storage_path])
    assert.equal((await db.query('select * from record_photos')).rows.length,1)
    await assert.rejects(()=>photo(db,'estimate_id',e),/row-level security/)
    await assert.rejects(()=>db.query(`insert into bookkeeping_entries(business_id,job_id,direction,amount) values('${b}','${j}','expense',1)`),/row-level security/)
    await db.exec(`reset role;update business_members set role='viewer';set role authenticated`)
    assert.equal((await db.query('select * from record_photos')).rows.length,1)
    await assert.rejects(()=>photo(db),/row-level security/)
  } finally { await db.close() }
})
