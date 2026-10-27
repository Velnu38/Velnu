import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const user = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, name: 'Test Service Company', role: 'owner', phone: '757-555-0100', email: 'test@example.test', document_accent: '#2563eb', profile_completed_at: '2026-10-26T00:00:00Z' }
const payment = { id: '22222222-2222-4222-8222-222222222222', amount: 150, status: 'succeeded', method: 'cash', paid_at: '2026-10-26T13:40:00Z', invoices: { invoice_number: 'INV-101' } }
const manual = { id: '44444444-4444-4444-8444-444444444444', entry_date: '2026-10-26', direction: 'expense', amount: 35, currency: 'USD', category: 'Materials & supplies', description: 'Replacement parts' }
const qbIncome = { id: '55555555-5555-4555-8555-555555555555', txn_date: '2026-10-26', direction: 'income', amount: 150, currency: 'USD', description: 'QuickBooks payment', source_type: 'Payment' }
const qbExpense = { id: '66666666-6666-4666-8666-666666666666', txn_date: '2026-10-26', direction: 'expense', amount: 25, currency: 'USD', description: 'QuickBooks purchase', source_type: 'Purchase' }
async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'test', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(value => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session)
}
async function mockFinance(page, opts={}) {
  const state = { requests: [], manualRows: [manual], connected: Boolean(opts.connected), configured: Boolean(opts.configured) }
  await signedIn(page)
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    let body = null
    try { body = request.postDataJSON() } catch {}
    state.requests.push({ path, method, body })
    const json = (payload, status=200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(payload) })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_plan_preferences')) return json({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return json({ id: '77777777-7777-4777-8777-777777777777', agreement_version: '2026-10-27-v3' })
    if (path.endsWith('/business_members')) return json({ business_id: businessId, role: 'owner', businesses: company })
    if (path.endsWith('/functions/v1/quickbooks')) {
      if (body.action === 'status') return json({ configured: state.configured, connected: state.connected, environment: 'sandbox', company_id: state.connected ? '123456' : null, last_sync_at: null, last_sync_count: 0, callback_url: 'https://example.supabase.co/functions/v1/quickbooks' })
      if (body.action === 'sync') return json({ success: true, rows_processed: 2, last_sync_at: '2026-10-26T18:00:00Z', limited: false, since: '2026-07-28' })
      if (body.action === 'disconnect') { state.connected = false; return json({ disconnected: true }) }
    }
    if (path.endsWith('/payments')) return json([payment])
    if (path.endsWith('/bookkeeping_entries')) {
      if (method === 'POST') { state.manualRows.push({ ...body, id: body.id, currency: 'USD' }); return json([], 201) }
      if (method === 'DELETE') { state.manualRows.splice(0,1); return json([]) }
      return json(state.manualRows)
    }
    if (path.endsWith('/quickbooks_transactions')) return json([qbIncome, qbExpense])
    if (path.endsWith('/customers') || path.endsWith('/jobs') || path.endsWith('/invoices') || path.endsWith('/reminders') || path.endsWith('/appointments') || path.endsWith('/estimates') || path.endsWith('/change_orders')) return json([])
    return json([])
  })
  return state
}

test('paid invoices and manual expenses appear in Finviant Office workbook, not as double-counted QuickBooks income', async ({page}) => {
  await mockFinance(page,{configured:false})
  await page.goto('/')
  await page.getByRole('button',{name:'Bookkeeping',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Know what you earned. Know what you spent.'})).toBeVisible()
  await expect(page.getByText('Payment received · INV-101')).toBeVisible()
  await expect(page.getByText('Replacement parts')).toBeVisible()
  const cards = page.locator('.bookkeeping-overview article')
  await expect(cards.nth(0).locator('strong')).toHaveText('$150.00')
  await expect(cards.nth(1).locator('strong')).toHaveText('$35.00')
  await page.getByRole('button',{name:'QuickBooks Online',exact:true}).click()
  await expect(cards.nth(0).locator('strong')).toHaveText('$150.00')
  await expect(cards.nth(1).locator('strong')).toHaveText('$25.00')
  await expect(page.getByText(/Do not add the two summaries together/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Connect QuickBooks Online'})).toBeDisabled()
})

test('bookkeeping owner can enter expense without changing payment transactions',async ({page})=>{
  const state=await mockFinance(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Bookkeeping',exact:true}).click()
  await page.getByRole('button',{name:'+ Add expense or income'}).click()
  const dialog=page.getByRole('dialog',{name:'Add workbook entry'})
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Amount in USD').fill('42.50')
  await dialog.getByLabel('Description').fill('Fuel for service truck')
  await dialog.getByRole('button',{name:'Save entry'}).click()
  await expect(page.getByText('Fuel for service truck')).toBeVisible()
  const write=state.requests.filter(x=>x.path.endsWith('/bookkeeping_entries') && x.method==='POST')
  expect(write).toHaveLength(1)
  expect(write[0].body.direction).toBe('expense')
  expect(write[0].body.amount).toBe(42.5)
  expect(write[0].body.id).toBeTruthy()
  expect(state.requests.filter(x=>x.path.endsWith('/payments') && x.method==='POST')).toHaveLength(0)
})

test('QuickBooks connection requires explicit extra-cost acknowledgment and shows sandbox state',async ({page})=>{
  await mockFinance(page,{configured:true,connected:false})
  await page.goto('/')
  await page.getByRole('button',{name:'Bookkeeping',exact:true}).click()
  await page.getByRole('button',{name:'QuickBooks Online',exact:true}).click()
  const connect=page.getByRole('button',{name:'Connect QuickBooks Online'})
  await expect(connect).toBeDisabled()
  await expect(page.getByText(/Separate fees may apply/)).toBeVisible()
  await page.getByRole('checkbox').check()
  await expect(connect).toBeEnabled()
  await expect(page.getByText(/Intuit sandbox testing/)).toBeVisible()
})

test('mobile navigation reaches workbook and separates source tabs',async ({page})=>{
  await page.setViewportSize({width:390,height:844})
  await mockFinance(page)
  await page.goto('/')
  await page.getByRole('button',{name:'More'}).click()
  await page.locator('.mobile-more-grid').getByRole('button',{name:'Bookkeeping'}).click()
  await expect(page.getByRole('button',{name:'Finviant Office workbook'})).toBeVisible()
  await expect(page.getByRole('button',{name:'QuickBooks Online'})).toBeVisible()
})
