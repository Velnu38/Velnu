import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Compile the actual service. The transport below rejects every unknown host;
// this is a contract simulation, not evidence of live provider/RLS behavior.
await build({ entryPoints: ['src/services/bookkeeping.ts'], outfile: '.qa-build/bookkeeping.mjs', bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://qa.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'qa-test-only' }) },
})
const { listVelnuWorkbook, listQuickBooksWorkbook, addManualEntry } = await import('../../.qa-build/bookkeeping.mjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const paymentRows = Array.from({ length: 1001 }, (_, i) => ({ id: 'p' + i, amount: 1, occurred_at: '2026-10-28T12:00:00Z', direction: 'income', currency: 'USD', method: 'cash', invoice_number: 'INV-' + i }))
const manualRows = Array.from({ length: 1001 }, (_, i) => ({ id: 'm' + i, amount: 2, entry_date: '2026-10-28', direction: 'expense', description: 'Expense ' + i, category: 'Parts', currency: 'USD' }))

async function fixture(options, run) {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid', 'No external requests allowed')
    const cash = url.pathname.endsWith('/rpc/list_invoice_cash_activity')
    if (cash) assert.equal((await request.json()).p_business, tenant)
    else assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
    assert.equal(url.searchParams.get('order'), 'id.asc')
    assert.match(request.headers.get('prefer') || '', /count=exact/)
    const table = url.pathname.split('/').at(-1), from = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000)
    calls.push({ table, from, limit })
    if (options.failSecond && from > 0) return new Response(JSON.stringify({ message: 'QA page unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })
    const rows = cash ? (options.cashRows || paymentRows) : table === 'bookkeeping_entries' ? manualRows : manualRows.map(r => ({ ...r, txn_date: r.entry_date, source_type: 'Purchase' }))
    const page = rows.slice(from, from + limit)
    return new Response(JSON.stringify(page), { headers: { 'content-type': 'application/json', ...(options.missingCount ? {} : { 'content-range': from + '-' + (from + page.length - 1) + '/' + rows.length }) } })
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}

test('actual workbook service loads all 2002 local records and preserves tenant filters', () => fixture({}, async calls => {
  const rows = await listVelnuWorkbook(tenant)
  assert.equal(rows.length, 2002)
  assert.equal(rows.filter(r => r.direction === 'income').reduce((sum, r) => sum + r.amount, 0), 1001)
  assert.equal(rows.filter(r => r.direction === 'expense').reduce((sum, r) => sum + r.amount, 0), 2002)
  assert.equal(new Set(rows.map(r => r.id)).size, 2002)
  assert.equal(calls.length, 4)
}))
test('actual QuickBooks service loads its separate second page', () => fixture({}, async calls => {
  const rows = await listQuickBooksWorkbook(tenant)
  assert.equal(rows.length, 1001)
  assert.ok(rows.every(r => r.source === 'quickbooks' && !r.removable))
  assert.equal(calls.length, 2)
}))
test('actual service propagates second-page failure instead of a partial total', () => fixture({ failSecond: true }, async () => {
  await assert.rejects(() => listQuickBooksWorkbook(tenant), /QA page unavailable/)
}))
test('actual service rejects a response without the completeness count', () => fixture({ missingCount: true }, async () => {
  await assert.rejects(() => listQuickBooksWorkbook(tenant), /Unable to verify/)
}))

const entry = { id: '44444444-4444-4444-8444-444444444444', business_id: tenant, entry_date: '2026-10-28', direction: 'expense', amount: 42.5, category: 'Parts', description: 'Replacement part', notes: 'Receipt 1' }
async function duplicateEntry(existing, run) {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid', 'No external requests allowed')
    assert.ok(url.pathname.endsWith('/bookkeeping_entries'))
    calls.push(request.method)
    if (request.method === 'POST') return new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409, headers: { 'content-type': 'application/json' } })
    assert.equal(request.method, 'GET')
    assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
    assert.equal(url.searchParams.get('id'), 'eq.' + entry.id)
    return new Response(JSON.stringify(existing), { headers: { 'content-type': 'application/json' } })
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}
test('manual-entry retry rejects a previously saved ID with changed financial details', () => duplicateEntry({ ...entry, currency: 'USD', amount: 10 }, async () => {
  await assert.rejects(() => addManualEntry(entry), /different details/)
}))
test('manual-entry retry verifies identical stored data in the same workspace', () => duplicateEntry({ ...entry, currency: 'USD' }, async calls => {
  await addManualEntry({ ...entry, description: '  Replacement part  ' })
  assert.deepEqual(calls, ['POST', 'GET'])
}))
test('manual-entry retry cannot claim success when the stored row is inaccessible', () => duplicateEntry(null, async () => {
  await assert.rejects(() => addManualEntry(entry), /verify/)
}))

test('ranged workbook uses business-zone month boundaries and exposes original record sources', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid')
    const payment = url.pathname.endsWith('/rpc/list_invoice_cash_activity')
    if (payment) {
      assert.deepEqual(await request.json(), { p_business:tenant,p_from:'2026-11-01T04:00:00.000Z',p_to:'2026-12-01T05:00:00.000Z' })
    } else {
      assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
      assert.deepEqual(url.searchParams.getAll('entry_date'), ['gte.2026-11-01','lt.2026-12-01'])
    }
    const row = payment ? { id:'p1',invoice_id:'inv1',amount:123.45,occurred_at:'2026-12-01T04:30:00Z',direction:'income',currency:'USD',method:'cash',invoice_number:'INV-1' }
      : { id:'m1',job_id:'job1',entry_date:'2026-11-30',direction:'expense',amount:12,currency:'USD',category:'Parts',description:'Copper',notes:'Receipt 123',jobs:{title:'Kitchen repair'} }
    return new Response(JSON.stringify([row]), {headers:{'content-type':'application/json','content-range':'0-0/1'}})
  }
  try {
    const rows = await listVelnuWorkbook(tenant,{from:'2026-11-01',to:'2026-12-01',timezone:'America/New_York'})
    const payment = rows.find(row => row.source === 'invoice_payment')
    assert.equal(payment.entry_date,'2026-11-30');assert.equal(payment.source_id,'inv1');assert.equal(payment.payment_method,'cash')
    const expense = rows.find(row => row.source === 'manual')
    assert.equal(expense.source_reference,'Kitchen repair');assert.equal(expense.source_view,'work');assert.equal(expense.notes,'Receipt 123')
  } finally { globalThis.fetch = original }
})

test('verified refunds remain separate nonremovable dated outflows without deleting gross income', () => fixture({ cashRows: [
  { id:'receipt1',invoice_id:'inv1',invoice_number:'INV-1',amount:100,direction:'income',currency:'USD',occurred_at:'2026-10-28T12:00:00Z',method:'card' },
  { id:'re_refund1',invoice_id:'inv1',invoice_number:'INV-1',amount:25,direction:'expense',currency:'USD',occurred_at:'2026-11-02T12:00:00Z',method:'card' },
] }, async () => {
  const rows = (await listVelnuWorkbook(tenant)).filter(row => row.source === 'invoice_payment')
  assert.equal(rows.length, 2)
  assert.equal(rows.filter(row => row.direction === 'income').reduce((sum,row)=>sum+row.amount,0),100)
  const refund = rows.find(row => row.direction === 'expense')
  assert.equal(refund.amount,25);assert.equal(refund.entry_date,'2026-11-02');assert.equal(refund.source_label,'Invoice refund')
  assert.equal(refund.source_id,'inv1');assert.equal(refund.removable,false)
}))

test('a missing invoice cash ledger fails visibly rather than displaying an incorrect zero total', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input,init) => {
    const request = new Request(input,init), url = new URL(request.url)
    assert.equal(url.hostname,'qa.invalid')
    if(url.pathname.endsWith('/rpc/list_invoice_cash_activity')) return new Response(JSON.stringify({message:'Invoice cash activity unavailable'}),{status:503,headers:{'content-type':'application/json'}})
    return new Response('[]',{headers:{'content-type':'application/json','content-range':'0-0/0'}})
  }
  try { await assert.rejects(()=>listVelnuWorkbook(tenant),/cash activity unavailable/) }
  finally { globalThis.fetch=original }
})
