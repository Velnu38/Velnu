import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const migration=await readFile('supabase/migrations/20261104142230_review_email_recipient_guard.sql','utf8')
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444',R='55555555-5555-4555-8555-555555555555'
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create function private.member_module_access(uuid,uuid,text) returns boolean language sql as $$select $1='${B}' and $2='${U}'$$;
 create table customers(id uuid,business_id uuid,email text);create table invoices(id uuid,business_id uuid,customer_id uuid);create table estimates(like invoices);
 create table private.finviant_email_outbox(id uuid primary key,business_id uuid,document_kind text,document_id uuid,payload jsonb);
 create function public.prepare_document_email(a uuid,b uuid,k text,d uuid,r uuid,o text) returns jsonb language plpgsql as $$begin
 insert into private.finviant_email_outbox values(r,b,k,d,jsonb_build_object('to',jsonb_build_array((select email from public.customers where id='${C}')))) on conflict do nothing;
 return jsonb_build_object('id',r,'status','queued');end$$;
 insert into customers values('${C}','${B}','customer@example.test');insert into invoices values('${D}','${B}','${C}');insert into estimates select * from invoices;`);await db.exec(migration);return db}
async function send(db:PGlite,kind='invoice',email='customer@example.test',user=U,business=B){return db.query('select prepare_review_document_email($1,$2,$3,$4,$5,$6,$7)',[user,business,kind,D,R,'https://finviant.com',email])}
for(const kind of ['invoice','estimate'])test(`review ${kind}: stale address never queues; identical retries keep one frozen recipient`,async()=>{
 const db=await setup();try{
 await assert.rejects(()=>send(db,kind,'wrong@example.test'),/Customer email changed/);assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,0)
 await send(db,kind);await db.exec("update customers set email='other@example.test'");await send(db,kind);assert.equal((await db.query('select * from private.finviant_email_outbox')).rows.length,1)
 await assert.rejects(()=>send(db,kind,'other@example.test'),/Send request changed/)
 }finally{await db.close()}
})
test('review queue denies unrelated actors, other businesses and direct browser execution',async()=>{
 const db=await setup();try{
 await assert.rejects(()=>send(db,'invoice','customer@example.test',C),/access denied/)
 await assert.rejects(()=>send(db,'invoice','customer@example.test',U,C),/access denied/)
 await assert.rejects(()=>send(db,'change_order'),/Invalid reviewed/)
 await db.exec('set role authenticated');await assert.rejects(()=>send(db),/permission denied/)
 }finally{await db.close()}
})
