import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const migration = await readFile('supabase/migrations/20261104180222_customer_with_service_address.sql','utf8')
const B='11111111-1111-4111-8111-111111111111', C='22222222-2222-4222-8222-222222222222', U='33333333-3333-4333-8333-333333333333'
const payload={first_name:' Jane ',last_name:'Doe',email:'jane@example.test',address:{address_line1:' 1 Test Street ',city:'Chesapeake',state:'VA',postal_code:'23322'}}
async function setup(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function private.can_write_business(uuid) returns boolean language sql as $$select $1='${B}' and auth.uid()='${U}'$$;
 create table customers(id uuid primary key,business_id uuid,first_name text,last_name text,company text,email text,phone text,notes text,preferred_contact text,unique(id,business_id));
 create table properties(id uuid primary key,business_id uuid,customer_id uuid,label text,address_line1 text check(address_line1!='reject-address'),address_line2 text,city text,state text,postal_code text,access_notes text,foreign key(customer_id,business_id) references customers(id,business_id));
 alter table customers enable row level security;alter table properties enable row level security;
 create policy customer_scope on customers to authenticated using(private.can_write_business(business_id)) with check(private.can_write_business(business_id));
 create policy location_scope on properties to authenticated using(private.can_write_business(business_id)) with check(private.can_write_business(business_id));
 grant usage on schema auth,private to authenticated;grant select,insert on customers,properties to authenticated;
 `);await db.exec(migration);await db.exec(`set role authenticated;set test.actor='${U}'`);return db}
const save=(db:PGlite,p=payload,b=B)=>db.query('select create_customer_with_address($1,$2,$3)',[b,C,p])
test('customer and address save atomically, trim fields, retry once, and reject changed retries',async()=>{const db=await setup();try{
 await save(db);await save(db);
 const customers=await db.query<any>('select * from customers'),properties=await db.query<any>('select * from properties');assert.equal(customers.rows.length,1);assert.equal(properties.rows.length,1);assert.equal(customers.rows[0].first_name,'Jane');assert.equal(properties.rows[0].address_line1,'1 Test Street');assert.equal(properties.rows[0].customer_id,C)
 await assert.rejects(save(db,{...payload,last_name:'Different'}),/already saved with different details/)
 }finally{await db.close()}})
test('location failure rolls back the new customer; retry can complete',async()=>{const db=await setup();try{
 await assert.rejects(save(db,{...payload,address:{...payload.address,address_line1:'reject-address'}}),/check constraint/);assert.equal((await db.query('select * from customers')).rows.length,0)
 await save(db);assert.equal((await db.query('select * from customers')).rows.length,1)
 }finally{await db.close()}})
test('customer/address RPC denies other tenants, anonymous callers, read-only users, missing names and incomplete addresses',async()=>{const db=await setup();try{
 await assert.rejects(save(db,payload,C),/access denied/)
 await db.exec(`set test.actor='${C}'`);await assert.rejects(save(db),/access denied/);await db.exec(`set test.actor='${U}'`)
 await assert.rejects(save(db,{...payload,first_name:'',last_name:''}),/name or company/)
 await assert.rejects(save(db,{...payload,address:{...payload.address,address_line1:''}}),/Street address/)
 await db.exec('reset role;set role anon');await assert.rejects(save(db),/permission denied/)
 }finally{await db.close()}})
