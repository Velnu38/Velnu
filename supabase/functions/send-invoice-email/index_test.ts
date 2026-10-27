type Handler = (request: Request) => Promise<Response>
let handle: Handler
const originalServe = Deno.serve
Deno.serve = ((handler: Handler) => { handle = handler; return {} }) as typeof Deno.serve
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
Deno.env.set('SUPABASE_ANON_KEY', 'test-key')
Deno.env.set('RESEND_API_KEY', 'test-resend-key')
await import('./index.ts')
Deno.serve = originalServe

const businessId = '11111111-1111-4111-8111-111111111111'
const invoiceId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const customerId = '44444444-4444-4444-8444-444444444444'
const requestId = '55555555-5555-4555-8555-555555555555'
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function request(overrides: Record<string, unknown> = {}, auth = true, origin = 'https://finviant.com') {
  return new Request('https://example.supabase.co/functions/v1/send-invoice-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: 'Bearer test-session' } : {}) }, body: JSON.stringify({ business_id: businessId, invoice_id: invoiceId, request_id: requestId, ...overrides }) })
}

type Options = { role?: string; missingInvoice?: boolean; missingEmail?: boolean }
async function withMock(options: Options, run: (state: { emails: Record<string, unknown>[]; requests: URL[] }) => Promise<void>) {
  const originalFetch = globalThis.fetch
  const emails: Record<string, unknown>[] = []
  const requests: URL[] = []
  const messages = new Map<string, Record<string, unknown>>()
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    requests.push(url)
    if (url.hostname === 'api.resend.com') { emails.push(await req.json()); return json({ id: 'test-provider-id' }) }
    if (url.hostname !== 'example.supabase.co') throw new Error('Unexpected external network request')
    if (url.pathname === '/auth/v1/user') return json({ id: userId, email: 'owner@example.test', app_metadata: {}, user_metadata: {} })
    const table = url.pathname.split('/').pop()
    if (table === 'business_members') return json({ role: options.role || 'owner' })
    if (table === 'businesses') return json({ name: 'Trial Business', email: 'owner@example.test', phone: '', currency: 'USD' })
    if (table === 'customers') return json({ id: customerId, first_name: 'Trial', last_name: 'Customer', email: options.missingEmail ? null : 'customer@example.test' })
    if (table === 'invoice_items') return json([{ description: '<script>alert(1)</script>', quantity: 1, unit_price: 100, tax_rate: 0, line_total: 100 }])
    if (table === 'invoices') {
      if (req.method === 'PATCH') return new Response(null, { status: 204 })
      return json(options.missingInvoice ? [] : { id: invoiceId, customer_id: customerId, invoice_number: 'INV-1001', status: 'draft', issue_date: '2026-09-14', due_date: '2026-10-01', subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100, customer_message: 'Thank you', notes: 'CONFIDENTIAL_INTERNAL_NOTES' })
    }
    if (table === 'messages') {
      if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': '0-0/0' } })
      if (req.method === 'POST') { const row = await req.json(); messages.set(row.id, { ...row, created_at: new Date().toISOString() }); return new Response(null, { status: 201 }) }
      const id = url.searchParams.get('id')?.replace('eq.', '') || ''
      if (req.method === 'PATCH') { messages.set(id, { ...messages.get(id), ...await req.json() }); return new Response(null, { status: 204 }) }
      return json(messages.has(id) ? messages.get(id) : [])
    }
    throw new Error(`Unexpected request: ${req.method} ${url}`)
  }
  try { await run({ emails, requests }) } finally { globalThis.fetch = originalFetch }
}

Deno.test('unauthenticated requests cannot send email', async () => {
  await withMock({}, async state => { const response = await handle(request({}, false)); assert(response.status === 401, 'Expected 401'); assert(state.emails.length === 0, 'No email should be sent') })
})
Deno.test('unapproved browser origins cannot send email', async () => {
  await withMock({}, async state => { const response = await handle(request({}, true, 'https://unrelated.example')); assert(response.status === 403, 'Expected 403'); assert(state.emails.length === 0, 'No email should be sent') })
})
Deno.test('viewer cannot email invoices', async () => {
  await withMock({ role: 'viewer' }, async state => { const response = await handle(request()); assert(response.status === 403, 'Expected viewer denial'); assert(state.emails.length === 0, 'No email should be sent') })
})
Deno.test('unavailable invoice is not emailed', async () => {
  await withMock({ missingInvoice: true }, async state => { const response = await handle(request()); assert(response.status === 404, 'Expected unavailable invoice'); assert(state.emails.length === 0, 'No email should be sent') })
})
Deno.test('customer must have a valid email', async () => {
  await withMock({ missingEmail: true }, async state => { const response = await handle(request()); assert(response.status === 409, 'Expected missing-email error'); assert(state.emails.length === 0, 'No email should be sent') })
})
Deno.test('invoice send excludes internal notes, escapes HTML and scopes database requests', async () => {
  await withMock({}, async state => {
    const response = await handle(request())
    assert(response.status === 200, `Expected success, got ${response.status}: ${await response.clone().text()}`)
    assert(state.emails.length === 1, 'Exactly one provider call')
    const email = state.emails[0]
    assert(!String(email.text).includes('CONFIDENTIAL_INTERNAL_NOTES'), 'Internal notes must stay private')
    assert(!String(email.html).includes('<script>'), 'HTML must be escaped')
    assert(String(email.html).includes('&lt;script&gt;'), 'Escaped item description is included')
    for (const url of state.requests.filter(url => ['/rest/v1/invoices', '/rest/v1/customers', '/rest/v1/invoice_items', '/rest/v1/business_members', '/rest/v1/messages'].includes(url.pathname))) assert(url.searchParams.get('business_id') === `eq.${businessId}` || url.pathname === '/rest/v1/messages' && !url.searchParams.has('select') && !url.searchParams.has('id'), `Missing tenant filter: ${url}`)
  })
})
Deno.test('retry of accepted request does not send a second email', async () => {
  await withMock({}, async state => {
    const first = await handle(request())
    assert(first.status === 200, 'First send succeeds')
    const second = await handle(request())
    assert(second.status === 200, 'Retry succeeds')
    assert((await second.json()).already_sent === true, 'Retry is identified')
    assert(state.emails.length === 1, 'Provider is called only once')
  })
})

Deno.test('technicians cannot send financial documents directly through the Edge Function', async () => {
  await withMock({ role: 'technician' }, async state => {
    const response = await handle(request())
    assert(response.status === 403, 'Technician must not send invoices')
    assert(state.emails.length === 0, 'No provider request must be made')
  })
})

Deno.test('100 input send-and-retry attempts produce 50 unique mocked provider messages', async () => {
  await withMock({}, async state => {
    for (let i = 0; i < 50; i++) {
      const id = '66666666-6666-4666-8666-' + String(i).padStart(12, '0')
      const first = await handle(request({ request_id: id, to: 'attacker@example.invalid' }))
      assert(first.status === 200, 'Case ' + i + ': initial send must succeed')
      const repeated = await handle(request({ request_id: id, to: 'other@example.invalid' }))
      assert(repeated.status === 200 && (await repeated.json()).already_sent === true, 'Case ' + i + ': must deduplicate')
    }
    assert(state.emails.length === 50, '100 input attempts should cause only 50 mock provider calls')
    for (const mail of state.emails) {
      assert(JSON.stringify(mail.to) === JSON.stringify(['customer@example.test']), 'Server must not trust recipient supplied by the request')
    }
  })
})
