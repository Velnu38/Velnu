import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// A focused SQL integration test. Live tenant/RLS testing is separate.
test('100 historical invoices + 100 estimates preserve issue dates, retries and audit timestamps', async () => {
  const db = new PGlite()
  const business='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222'
  await db.exec(`create schema auth;create schema private;
    create function auth.uid() returns uuid language sql as $$select '33333333-3333-4333-8333-333333333333'::uuid$$;
    create function private.can_write_business(uuid) returns boolean language sql as $$select true$$;
    create table businesses(id uuid primary key,timezone text);
    create table business_settings(business_id uuid,payment_links jsonb,payment_instructions text);
    create table invoices(id uuid primary key default gen_random_uuid(),business_id uuid,customer_id uuid,issue_date date,due_date date,notes text,customer_message text,request_id uuid,request_fingerprint text,payment_links jsonb,payment_instructions text,created_at timestamptz default now());
    create table estimates(id uuid primary key default gen_random_uuid(),business_id uuid,customer_id uuid,issue_date date,expires_on date,notes text,customer_message text,request_id uuid,request_fingerprint text,created_at timestamptz default now());
    create table invoice_items(invoice_id uuid,business_id uuid,description text,quantity numeric,unit_price numeric,tax_rate numeric,sort_order int);
    create table estimate_items(estimate_id uuid,business_id uuid,description text,quantity numeric,unit_price numeric,tax_rate numeric,sort_order int);
    insert into businesses values('${business}','America/New_York');`)
  await db.exec(await readFile('supabase/migrations/20261102194320_historical_document_dates.sql','utf8'))
  try {
    for(const kind of ['invoice','estimate']) for(let i=0;i<100;i++) {
      const issue=`2026-${String(1+i%10).padStart(2,'0')}-${String(1+i%27).padStart(2,'0')}`
      const id=crypto.randomUUID(),payload={customer_id:customer,issue_date:issue,[kind==='invoice'?'due_date':'expires_on']:issue,items:[{description:`Historical ${i}`,quantity:1,unit_price:100+i,tax_rate:5.3}]}
      const query=()=>db.query<{result:any}>('select create_document($1,$2,$3,$4) result',[business,kind,id,JSON.stringify(payload)])
      const row=(await query()).rows[0].result
      assert.equal(row.issue_date,issue);assert.notEqual(row.created_at.slice(0,10),issue)
      assert.equal((await query()).rows[0].result.id,row.id)
      await assert.rejects(()=>db.query('select create_document($1,$2,$3,$4)',[business,kind,id,JSON.stringify({...payload,issue_date:'2026-01-01',notes:'changed'})]),/different content/)
      await assert.rejects(()=>db.query('select create_document($1,$2,$3,$4)',[business,kind,crypto.randomUUID(),JSON.stringify({...payload,issue_date:'2026-02-30'})]),/date/)
      await assert.rejects(()=>db.query('select create_document($1,$2,$3,$4)',[business,kind,crypto.randomUUID(),JSON.stringify({...payload,issue_date:'2099-01-01'})]),/issue date/)
      await assert.rejects(()=>db.query('select create_document($1,$2,$3,$4)',[business,kind,crypto.randomUUID(),JSON.stringify({...payload,[kind==='invoice'?'due_date':'expires_on']:'2025-01-01'})]),/precede/)
    }
    assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,100)
    assert.equal((await db.query('select count(*)::int n from estimates')).rows[0].n,100)
  } finally {await db.close()}
})
