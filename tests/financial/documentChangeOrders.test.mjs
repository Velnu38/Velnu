import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

await build({ entryPoints: ['src/lib/documentChangeOrders.ts'], outfile: '.qa-build/documentChangeOrders.mjs', bundle: true, platform: 'node', format: 'esm' })
await build({ entryPoints: ['src/services/changeOrders.ts'], outfile: '.qa-build/changeOrders.mjs', bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://qa.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'qa-test-only' }) },
})
const { offersDocumentChangeOrders, matchesChangeOrderContext } = await import('../../.qa-build/documentChangeOrders.mjs')
const { createChangeOrder } = await import('../../.qa-build/changeOrders.mjs')

test('change orders are offered on issued documents, including later sent-document statuses', () => {
  for (const status of ['sent', 'viewed', 'partial', 'paid', 'overdue']) assert.equal(offersDocumentChangeOrders('invoice', status), true)
  for (const status of ['sent', 'accepted', 'converted']) assert.equal(offersDocumentChangeOrders('estimate', status), true)
  for (const status of ['draft', 'void', 'unknown']) assert.equal(offersDocumentChangeOrders('invoice', status), false)
  for (const status of ['draft', 'declined', 'expired', 'unknown']) assert.equal(offersDocumentChangeOrders('estimate', status), false)
})

test('document context only offers the matching customer and linked job', () => {
  const context = { documentType: 'invoice', documentId: 'invoice-1', documentNumber: 'INV-1', customerId: 'customer-1', jobId: 'job-1' }
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-1', job_id: 'job-1' }, context), true)
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-2', job_id: 'job-1' }, context), false)
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-1', job_id: 'job-2' }, context), false)
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-1', job_id: 'job-2' }, { ...context, jobId: null }), true)
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-2' }, { ...context, jobId: null }), false)
  assert.equal(matchesChangeOrderContext({ customer_id: 'customer-2', job_id: 'job-2' }), true)
})

test('document-based change order retains the existing atomic creation contract and source reference', async () => {
  const original = globalThis.fetch
  const input = { request_id: 'request-1', customer_id: 'customer-1', job_id: 'job-1', estimate_id: 'estimate-1', title: 'Add a light', notes: 'Requested from estimate EST-1 (estimate-1).', items: [{ description: 'Light fixture', quantity: 1, unit_price: 75, tax_rate: 5 }] }
  const requests = []
  globalThis.fetch = async (url, options) => {
    const request = new Request(url, options)
    assert.equal(new URL(request.url).hostname, 'qa.invalid', 'No external requests allowed')
    assert.ok(new URL(request.url).pathname.endsWith('/rpc/create_change_order_document'))
    const body = await request.json()
    requests.push(body)
    assert.equal(body.target_business_id, 'business-1')
    assert.equal(body.request_id, input.request_id)
    assert.equal(body.payload.customer_id, input.customer_id)
    assert.equal(body.payload.job_id, input.job_id)
    assert.equal(body.payload.estimate_id, input.estimate_id)
    assert.equal(body.payload.notes, input.notes)
    assert.deepEqual(body.payload.items, input.items)
    return new Response(JSON.stringify({ id: 'co-1', status: 'draft', total: 78.75 }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    assert.equal((await createChangeOrder('business-1', input)).status, 'draft')
    await assert.rejects(() => createChangeOrder('business-1', { ...input, job_id: '' }), /Choose an existing job/)
    assert.equal(requests.length, 1)
  } finally { globalThis.fetch = original }
})
