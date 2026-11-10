import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333',A='44444444-4444-4444-8444-444444444444',STAFF='55555555-5555-4555-8555-555555555555'
const migration=await readFile('supabase/migrations/20261110175726_owner_record_archives.sql','utf8')
const value=async(db:PGlite,sql:string,args:unknown[]=[])=>((await db.query<{v:any}>(sql,args)).rows[0]?.v)
async function actor(db:PGlite,id=U,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
async function fixture(){
 const db=new PGlite();try{
  await db.exec(await readFile('tests/records/archive-schema.sql','utf8'))
  const owners=await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql','utf8'),start=owners.indexOf('create function private.is_primary_owner(')
  await db.exec(owners.slice(start,owners.indexOf('$$;',start)+3));await db.exec(migration)
  await db.query('insert into public.businesses(id,created_by_user_id,name) values($1,$2,$3),($4,$4,$5)',[B,U,'Archive fixture',OTHER,'Other tenant'])
  await db.query("insert into public.business_members(business_id,user_id,role) values($1,$2,'owner'),($3,$3,'owner'),($1,$4,'owner')",[B,U,OTHER,STAFF])
  await actor(db);return db
 }catch(e){await db.close();throw e}
}
test('owner snapshot includes more than 50,000 rows, remains immutable, excludes secrets and rejects other identities',async()=>{
 const db=await fixture();try{
  await db.exec('reset role')
  await db.query("insert into public.customers(id,business_id,first_name) select gen_random_uuid(),$1,'Customer '||n from generate_series(1,50001)n",[B])
  await db.query("insert into public.customers(id,business_id,first_name) values(gen_random_uuid(),$1,'Other tenant secret')",[OTHER])
  await db.query("insert into private.calendar_integrations(id,business_id,email,credentials) values(gen_random_uuid(),$1,'owner@example.test',$2)",[B,{access_token:'must-not-export'}])
  await db.query("insert into private.support_cases(id,business_id,title) values($1,$2,'Case')",[A,B]);await db.query("insert into private.support_messages(id,case_id,audience,body) values(gen_random_uuid(),$1,'customer','Customer reply'),(gen_random_uuid(),$1,'internal','Internal secret')",[A])
  await actor(db)
  assert.equal(await value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),A)
  assert.equal(await value(db,'select public.begin_owner_archive($1,$2) v',[B,A]),A,'lost-response retry reuses the snapshot')
  const state=await value(db,'select public.get_owner_archive($1,$2) v',[B,A]);assert.equal(state.counts['public.customers'],50001);assert.equal(state.counts['private.support_messages'],1);assert.ok(state.part_count>1)
  await db.exec('reset role');await db.query("update public.customers set first_name='Edited after snapshot' where business_id=$1",[B]);
  const stored=await value(db,"select count(*)::int v from private.owner_archive_rows where archive_id=$1 and collection='public.customers' and payload->>'first_name' like 'Customer %'",[A]);assert.equal(stored,50001)
  const calendar=await value(db,"select payload v from private.owner_archive_rows where archive_id=$1 and collection='private.calendar_integrations'",[A]);assert.equal(calendar.email,'owner@example.test');assert.ok(!('credentials' in calendar))
  for(const id of [OTHER,STAFF]){await actor(db,id);await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501');await assert.rejects(()=>value(db,'select public.begin_owner_archive($1,$2) v',[B,crypto.randomUUID()]),(e:any)=>e.code==='42501')}
  await actor(db,'','anon');await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501')
  await actor(db);await assert.rejects(()=>db.query('select * from private.owner_archive_rows'),(e:any)=>e.code==='42501')
  const claim=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.ok(claim.rows.length);assert.equal((await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A])).busy,true)
  await assert.rejects(()=>db.query('select public.finish_owner_archive_part($1,1,$2,$3,100,$4)',[A,claim.lease,'a'.repeat(64),[]]),(e:any)=>e.code==='42501')
  await db.exec('reset role');await db.query('update public.business_members set role=$1 where user_id=$2',['viewer',U]);await actor(db)
  await assert.rejects(()=>value(db,'select public.get_owner_archive($1,$2) v',[B,A]),(e:any)=>e.code==='42501')
 }finally{await db.close()}
})
test('archive preparation resumes expired leases, checks source changes, expires at seven days and cleanup leaves originals intact',async()=>{
 const db=await fixture();try{
  await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('finviant-record-photos',$1,$2)",[B+'/file.png',{size:4}]);await actor(db)
  await value(db,'select public.begin_owner_archive($1,$2) v',[B,A])
  const first=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);await db.exec('reset role');await db.query("update private.owner_archive_parts set lease_until=now()-interval '1 second' where archive_id=$1",[A]);await actor(db)
  const retry=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.equal(retry.part_no,first.part_no);assert.notEqual(retry.lease,first.lease)
  await actor(db,U,'service_role');await assert.rejects(()=>db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,first.part_no,first.lease,'a'.repeat(64),[]]),(e:any)=>e.code==='40001')
  await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,retry.part_no,retry.lease,'a'.repeat(64),[]]);await actor(db)
  let next=await value(db,'select public.claim_owner_archive_part($1,$2) v',[B,A]);assert.equal(next.kind,'file');const file=next.rows[0].data
  await actor(db,U,'service_role');assert.equal(await value(db,'select public.validate_owner_archive_source($1,$2,$3,$4) v',[file.bucket,file.path,file.updated_at,4]),true)
  await db.query('select public.finish_owner_archive_part($1,$2,$3,$4,100,$5)',[A,next.part_no,next.lease,'b'.repeat(64),[]]);await actor(db)
  const ready=await value(db,'select public.get_owner_archive($1,$2) v',[B,A]);assert.equal(ready.status,'ready');assert.equal(ready.ready_count,ready.part_count)
  assert.match((await value(db,'select public.owner_archive_download($1,$2,1) v',[B,A])).path,/\/1.zip$/)
  await db.exec('reset role');await db.query("update private.owner_archives set expires_at=now()-interval '21 minutes' where id=$1",[A]);await actor(db)
  assert.equal((await value(db,'select public.get_owner_archive($1,$2) v',[B,A])).status,'expired');await assert.rejects(()=>value(db,'select public.owner_archive_download($1,$2,1) v',[B,A]),(e:any)=>e.code==='42501')
  await actor(db,U,'service_role');const cleanup=await value(db,'select public.expired_owner_archive_parts() v');assert.equal(cleanup.length,ready.part_count)
  await db.query('select public.remove_expired_owner_archive_parts($1)',[JSON.stringify(cleanup)]);await db.exec('reset role')
  assert.equal(await value(db,'select count(*)::int v from private.owner_archive_rows where archive_id=$1',[A]),0)
  assert.equal(await value(db,'select count(*)::int v from storage.objects'),1);assert.equal(await value(db,'select count(*)::int v from public.businesses'),2)
 }finally{await db.close()}
})
