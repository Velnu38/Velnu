import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Compile the actual service. The transport below rejects every unknown host;
// this is a contract simulation, not evidence of live provider/RLS behavior.
await build({ entryPoints: ['src/services/bookkeeping.ts'], outfile: '.qa-build/bookkeeping.mjs', bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://qa.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'qa-test-only' }) },
})
const { listVelnuWorkbook, listQuickBooksWorkbook } = await import('../../.qa-build/bookkeeping.mjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const paymentRows = Array.from({ length: 1001 }, (_, i) => ({ id: 'p' + i, amount: 1, paid_at: '2026-10-28T12:00:00Z', status: 'succeeded', method: 'cash', invoices: { invoice_number: 'INV-' + i } }))
const manualRows = Array.from({ length: 1001 }, (_, i) => ({ id: 'm' + i, amount: 2, entry_date: '2026-10-28', direction: 'expense', description: 'Expense ' + i, category: 'Parts', currency: 'USD' }))

async function fixture(options, run) {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid', 'No external requests allowed')
    assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
    assert.equal(url.searchParams.get('order'), 'id.asc')
    assert.match(request.headers.get('prefer') || '', /count=exact/)
    const table = url.pathname.split('/').at(-1), from = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000)
    calls.push({ table, from, limit })
    if (options.failSecond && from > 0) return new Response(JSON.stringify({ message: 'QA page unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })
    const rows = table === 'payments' ? paymentRows : table === 'bookkeeping_entries' ? manualRows : manualRows.map(r => ({ ...r, txn_date: r.entry_date, source_type: 'Purchase' }))
    if (table === 'payments') assert.equal(url.searchParams.get('status'), 'eq.succeeded')
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
