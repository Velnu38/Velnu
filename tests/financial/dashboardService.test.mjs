import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Exercise the actual service with a transport that blocks every external host.
await build({ entryPoints: ['src/services/dashboard.ts'], outfile: '.qa-build/dashboard.mjs', bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://qa.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'qa-test-only' }) },
})
const { getDashboardSnapshot } = await import('../../.qa-build/dashboard.mjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const customer = { first_name: 'Jane', last_name: 'Doe', company: null }

async function fixture(options, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid', 'No external requests allowed')
    const table = url.pathname.split('/').at(-1)
    calls.push(table)
    const reply = (rows, total = 0) => new Response(JSON.stringify(rows), { headers: {
      'content-type': 'application/json', 'content-range': `0-9/${total}`,
    } })
    if (table === 'get_dashboard_invoice_totals') {
      assert.equal(JSON.parse(await request.text()).target_business_id, tenant)
      return reply({ open_invoices: 0, outstanding_balance: 0 })
    }
    assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
    if (['estimates', 'change_orders', 'invoices'].includes(table)) {
      assert.match(request.headers.get('prefer') || '', /count=exact/)
      assert.equal(url.searchParams.get('limit'), '10')
      if (table !== 'invoices') assert.equal(url.searchParams.get('status'), 'eq.sent')
      else {
        assert.equal(url.searchParams.get('balance_due'), 'gt.0')
        assert.equal(url.searchParams.get('status'), 'not.in.(draft,void)')
        assert.match(url.searchParams.get('due_date') || '', /^lt\.\d{4}-\d{2}-\d{2}$/)
      }
      if (options.fail === table) return new Response(JSON.stringify({ message: 'Approval records unavailable' }), { status: 400, headers: { 'content-type': 'application/json' } })
      const total = options.empty ? 0 : { estimates: 23, change_orders: 17, invoices: 14 }[table]
      return reply(Array.from({ length: Math.min(10, total) }, (_, n) => ({
        id: `${table}-${n}`, estimate_number: `EST-${n}`, change_order_number: `CO-${n}`, invoice_number: `INV-${n}`,
        title: 'Extra work', total: 25, balance_due: 15, due_date: '2020-01-01',
        issue_date: table === 'change_orders' ? '2020-01-01' : '2020-01-02', customers: customer,
      })), total)
    }
    if (table === 'reminders') {
      assert.match(request.headers.get('prefer') || '', /count=exact/)
      assert.equal(url.searchParams.get('status'), 'eq.pending')
      assert.match(url.searchParams.get('due_at') || '', /^lte\./)
      return reply(options.empty ? [] : Array.from({ length: 10 }, (_, n) => ({ id: `reminder-${n}` })), options.empty ? 0 : 18)
    }
    assert.ok(['jobs', 'appointments'].includes(table))
    return reply([])
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}

test('dashboard counts all pending approvals and overdue invoices beyond the bounded detail lists', () => fixture({}, async calls => {
  const snapshot = await getDashboardSnapshot(tenant)
  assert.equal(snapshot.pendingApprovalCount, 40)
  assert.equal(snapshot.pendingApprovals.length, 12)
  assert.equal(snapshot.overdueInvoiceCount, 14)
  assert.equal(snapshot.overdueInvoices.length, 10)
  assert.equal(snapshot.dueReminderCount, 18)
  assert.equal(snapshot.dueReminders.length, 10)
  assert.deepEqual(new Set(snapshot.pendingApprovals.map(row => row.document_type)), new Set(['estimate', 'change_order']))
  assert.ok(snapshot.pendingApprovals.every(row => row.customers[0].first_name === 'Jane'))
  assert.equal(calls.length, 7)
}))

test('dashboard returns zero pending approvals and an empty list when no requests are waiting', () => fixture({ empty: true }, async () => {
  const snapshot = await getDashboardSnapshot(tenant)
  assert.equal(snapshot.pendingApprovalCount, 0)
  assert.deepEqual(snapshot.pendingApprovals, [])
}))

test('dashboard rejects a failed approval source instead of presenting a partial count', () => fixture({ fail: 'change_orders' }, async () => {
  await assert.rejects(() => getDashboardSnapshot(tenant), err => err.message === 'Approval records unavailable')
}))
