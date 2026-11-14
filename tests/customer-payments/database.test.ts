import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { B, C, I, O, U, fixture, invoice, user } from '../tiers/fixture.ts'

const tokenHash='ab'.repeat(32), revision='77777777-7777-4777-8777-777777777777'
const request='66666666-6666-4666-8666-666666666666'
async function setup() {
  const db=await fixture()
  await db.exec(`create table public.payments(id uuid primary key default gen_random_uuid(),business_id uuid,invoice_id uuid,
    amount numeric not null check(amount>0),method text,provider text,provider_payment_id text,status text not null,paid_at timestamptz not null,notes text);
    create unique index provider_unique on public.payments(business_id,provider,provider_payment_id);
    create table public.bookkeeping_entries(id uuid primary key default gen_random_uuid(),business_id uuid);
    create function private.has_business_role(b uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role=any(roles))$$;
    create table private.payment_test_context(hash text primary key,payload jsonb);
    create function private.document_share_context(p_token_hash text) returns jsonb language plpgsql stable security definer set search_path='' as
      $$declare result jsonb;begin select payload into result from private.payment_test_context where hash=p_token_hash;if result is null then raise exception 'Invalid token';end if;return result;end$$;
    update public.business_members set access_modules=array['billing','finances','jobs','calendar'];`)
  await db.exec(await readFile('supabase/migrations/20261108001511_verified_customer_invoice_payments.sql','utf8'))
  await db.exec(`create trigger commerce_payment_guard before insert or update or delete on public.payments for each row execute function private.commerce_payment_guard();
    create trigger payments_prevent_overpayment before insert or update on public.payments for each row execute function public.prevent_invoice_overpayment();
    create trigger commerce_paid_recalc after insert or update or delete on public.payments for each row execute function private.commerce_paid_recalc();`)
  await invoice(db)
  await db.query("update public.invoices set status='sent',sent_at=now() where id=$1",[I])
  await db.query('insert into private.payment_test_context values($1,$2)',[tokenHash,JSON.stringify({kind:'invoice',business_id:B,document_id:I,revision_id:revision,
    publication_ready:true,superseded:false,action_state:'payment_due',currency:'USD',action_expires_at:null})])
  return db
}
async function merchant(db:any) {
  await db.exec('reset role')
  await db.query("insert into private.customer_payment_merchants(business_id,stripe_account_id,enabled,verified_at,verification_reference) values($1,'acct_merchant',true,now(),'verified-fixture')",[B])
}
async function service(db:any) { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role") }
async function value(db:any,sql:string,args:unknown[]=[]) { return (await db.query(sql,args)).rows[0].value }
const reserve=(db:any,id=request)=>value(db,'select public.reserve_customer_checkout($1,$2) value',[tokenHash,id])
async function settle(db:any,c:any,event='evt_paid',amount=10000,currency='usd',account='acct_merchant',intent='pi_paid') {
  return value(db,"select public.apply_customer_payment_event($1,$2,$3,'cs_test_fixture',$4,$5,$6,false,'paid',now(),'card') value",[event,account,c.id,intent,amount,currency])
}

test('payment setup is not fabricated; tokens, plan, revision and private RPC grants fail closed', async()=>{
  const db=await setup()
  try {
    await service(db)
    assert.equal((await value(db,'select public.get_customer_payment_context($1) value',[tokenHash])).state,'not_connected')
    await assert.rejects(()=>reserve(db),/unavailable/)
    await assert.rejects(()=>value(db,'select public.get_customer_payment_context($1) value',['ff'.repeat(32)]),/Invalid token/)
    await user(db)
    await assert.rejects(()=>reserve(db),/permission denied/)
    await assert.rejects(()=>db.query("insert into private.customer_payment_merchants(business_id,stripe_account_id) values($1,'acct_attack')",[B]),/permission denied/)
    await merchant(db);await service(db)
    const ready=await value(db,'select public.get_customer_payment_context($1) value',[tokenHash]);assert.equal(ready.state,'ready')
    await db.exec('reset role')
    await db.query("update private.payment_test_context set payload=jsonb_set(payload,'{superseded}','true') where hash=$1",[tokenHash]);await service(db)
    await assert.rejects(()=>reserve(db),/unavailable/)
  } finally {await db.close()}
})

test('one invoice reuses a frozen provider operation and validates provider/session/amount/currency',async()=>{
  const db=await setup()
  try {
    await merchant(db);await service(db)
    const c=await reserve(db)
    const again=await reserve(db,'88888888-8888-4888-8888-888888888888')
    assert.equal(again.id,c.id)
    await assert.rejects(()=>settle(db,c,'evt_wrongamount',9999),/verification failed/)
    await assert.rejects(()=>settle(db,c,'evt_wrongcurrency',10000,'eur'),/verification failed/)
    await assert.rejects(()=>settle(db,c,'evt_wrongaccount',10000,'usd','acct_other'),/Unknown invoice/)
    await assert.rejects(()=>settle(db,c,'evt_badintent',10000,'usd','acct_merchant','not_a_payment'),/reference/)
    const paid=await settle(db,c)
    assert.equal(paid.state,'paid')
    assert.equal((await settle(db,c)).duplicate,true)
    assert.equal((await settle(db,c,'evt_samepayment')).duplicate,true)
    await assert.rejects(()=>settle(db,c,'evt_conflictingintent',10000,'usd','acct_merchant','pi_other'),/reference conflict/)
    await db.exec('reset role')
    assert.equal(await value(db,'select count(*)::int value from public.payments'),1)
    assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'paid')
    assert.equal(Number(await value(db,'select amount_paid value from public.invoices where id=$1',[I])),100)
    assert.equal(await value(db,'select count(*)::int value from private.customer_payment_webhook_events'),2)
  } finally {await db.close()}
})

test('confirmed delayed payments stay pending until settled and never downgrade after success',async()=>{
  const db=await setup()
  try {
    await merchant(db);await service(db);const c=await reserve(db)
    await value(db,"select public.apply_customer_payment_event('evt_pending','acct_merchant',$1,'cs_test_fixture','pi_paid',10000,'usd',false,'pending',now(),'ach') value",[c.id])
    assert.equal((await value(db,'select public.get_customer_payment_context($1) value',[tokenHash])).state,'pending')
    await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from public.payments'),0);await service(db)
    await value(db,"select public.apply_customer_payment_event('evt_failure','acct_merchant',$1,'cs_test_fixture','pi_paid',10000,'usd',false,'failed',now(),'ach') value",[c.id])
    const stale=await value(db,"select public.apply_customer_payment_event('evt_oldpending','acct_merchant',$1,'cs_test_fixture','pi_paid',10000,'usd',false,'pending',now(),'ach') value",[c.id])
    assert.equal(stale.state,'failed','an old unpaid event must not revive a failed operation')
    await settle(db,c)
    await value(db,"select public.apply_customer_payment_event('evt_latefailure','acct_merchant',$1,'cs_test_fixture','pi_paid',10000,'usd',false,'failed',now(),'ach') value",[c.id])
    await db.exec('reset role');assert.equal(await value(db,'select status value from public.invoices where id=$1',[I]),'paid')
  } finally {await db.close()}
})

test('a credited-deposit refund keeps provider evidence and creates durable review instead of infinite retries',async()=>{
  const db=await setup()
  try {
    await merchant(db);await service(db);const c=await reserve(db);await settle(db,c)
    await db.exec('reset role')
    const depositMigration=await readFile('supabase/migrations/20261106131110_estimate_deposit_final_balance.sql','utf8')
    await db.exec(depositMigration.slice(depositMigration.indexOf('create function private.guard_credited_deposit_payment()')))
    await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,total,deposit_source_invoice_id) values('99999999-9999-4999-8999-999999999999',$1,$2,'FINAL-1',100,$3)",[B,C,I])
    await service(db)
    const args=['evt_creditedrefund','acct_merchant',c.id,'pi_paid',false,'usd',JSON.stringify([{id:'re_credited',amount_minor:2500,refunded_at:'2026-11-03T12:00:00Z'}])]
    const sql='select public.apply_customer_payment_refund($1,$2,$3,$4,$5,$6,$7) value'
    assert.equal((await value(db,sql,args)).state,'review_required')
    assert.equal((await value(db,sql,args)).duplicate,true)
    await db.exec('reset role')
    assert.equal(await value(db,'select count(*)::int value from private.customer_invoice_refunds'),1)
    assert.equal(await value(db,'select status value from public.payments'),'succeeded')
    assert.equal(await value(db,'select review_reason value from private.customer_invoice_checkouts'),'credited_deposit_refund')
    await user(db)
    assert.equal((await db.query('select * from public.list_customer_payment_reviews($1)',[B])).rows.length,1)
    const activity=(await db.query('select * from public.list_invoice_cash_activity($1)',[B])).rows
    assert.equal(activity.filter((r:any)=>r.direction==='expense').reduce((sum:number,r:any)=>sum+Number(r.amount),0),25)
  } finally {await db.close()}
})

test('refund ledger is idempotent, preserves gross dated cash flows and prevents manual overpayment',async()=>{
  const db=await setup()
  try {
    await merchant(db);await service(db);const c=await reserve(db);await settle(db,c)
    const refund={id:'re_first',amount_minor:2500,refunded_at:'2026-11-01T12:00:00Z'}
    const apply=(event:string,rows:unknown[])=>value(db,"select public.apply_customer_payment_refund($1,'acct_merchant',$2,'pi_paid',false,'usd',$3) value",[event,c.id,JSON.stringify(rows)])
    await assert.rejects(()=>value(db,"select public.apply_customer_payment_refund('evt_nullcurrency','acct_merchant',$1,'pi_paid',false,null,'[]') value",[c.id]),/verification/)
    await apply('evt_refund',[refund]);assert.equal((await apply('evt_refund',[refund])).duplicate,true)
    await apply('evt_refundagain',[refund])
    await db.exec('reset role')
    assert.equal(Number(await value(db,'select balance_due value from public.invoices where id=$1',[I])),25)
    assert.equal(await value(db,'select status value from public.payments'),'partially_refunded')
    await assert.rejects(()=>db.query("insert into public.payments(business_id,invoice_id,amount,method,status,paid_at) values($1,$2,26,'cash','succeeded',now())",[B,I]),/overpay/)
    await user(db)
    const cash=(await db.query('select * from public.list_invoice_cash_activity($1)',[B])).rows
    assert.equal(cash.length,2);assert.equal(Number(cash.find((r:any)=>r.direction==='income').amount),100)
    assert.equal(Number(cash.find((r:any)=>r.direction==='expense').amount),25)
    await service(db)
    await assert.rejects(()=>apply('evt_excessive',[refund,{id:'re_excess',amount_minor:8000,refunded_at:'2026-11-02T12:00:00Z'}]),/exceeds/)
    await apply('evt_full',[refund,{id:'re_remaining',amount_minor:7500,refunded_at:'2026-11-02T12:00:00Z'}])
    await db.exec('reset role');assert.equal(Number(await value(db,'select balance_due value from public.invoices where id=$1',[I])),100)
    assert.equal(await value(db,'select status value from public.payments'),'refunded')
    assert.equal(await value(db,'select count(*)::int value from private.customer_invoice_refunds'),2)
  } finally {await db.close()}
})

test('verified funds arriving after a manual payment are recorded for reconciliation without double posting',async()=>{
  const db=await setup()
  try {
    await merchant(db);await service(db);const c=await reserve(db)
    await db.exec('reset role')
    await db.query("insert into public.payments(business_id,invoice_id,amount,method,status,paid_at) values($1,$2,50,'cash','succeeded',now())",[B,I]);await service(db)
    assert.equal((await settle(db,c)).state,'review_required')
    assert.equal((await value(db,'select public.get_customer_payment_context($1) value',[tokenHash])).state,'review_required')
    await assert.rejects(()=>reserve(db,'88888888-8888-4888-8888-888888888888'),/unavailable/)
    await db.exec('reset role');assert.equal(await value(db,'select count(*)::int value from public.payments'),1)
    assert.equal(await value(db,'select review_reason value from private.customer_invoice_checkouts where id=$1',[c.id]),'settled_payment_needs_reconciliation')
  } finally {await db.close()}
})
