import { openWorkArea } from './navigation.mjs'
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
  const state = { requests: [], manualRows: opts.manualRows || [manual], connected: Boolean(opts.connected), configured: Boolean(opts.configured), failManualRead: Boolean(opts.failManualRead) }
  await signedIn(page)
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    let body = null
    try { body = request.postDataJSON() } catch {}
    state.requests.push({ path, method, body, query: Object.fromEntries(new URL(request.url()).searchParams) })
    const json = (payload, status=200, total=Array.isArray(payload) ? payload.length : 1) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '0-' + Math.max(0, (Array.isArray(payload) ? payload.length : 1) - 1) + '/' + total }, body: JSON.stringify(payload) })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/get_dashboard_invoice_totals')) return json({open_invoices:0,outstanding_balance:0})
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
      if (state.failManualRead) return json({ message: 'Workbook unavailable for QA' }, 503)
      const params = new URL(request.url()).searchParams
      const from = Number(params.get('offset') || 0)
      const limit = Number(params.get('limit') || 1000)
      return json(state.manualRows.slice(from, from + limit), 200, state.manualRows.length)
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
  await openWorkArea(page, 'Bookkeeping')
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

test('workbook totals and CSV include entries beyond the first API page', async ({page}) => {
  const rows = Array.from({length:1001}, (_, i) => ({...manual, id: String(i).padStart(6,'0'), amount: 1, description: 'QA expense ' + i}))
  const state = await mockFinance(page,{manualRows:rows})
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
  await page.getByLabel('Period').selectOption('all')
  await expect(page.locator('.bookkeeping-overview article').nth(1).locator('strong')).toHaveText('$1,001.00')
  await expect(page.getByText('QA expense 1000',{exact:true})).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button',{name:'Download CSV'}).click()
  const stream = await (await downloaded).createReadStream()
  let csv=''
  for await (const chunk of stream) csv += chunk.toString()
  expect(csv).toContain('QA expense 1000')
  expect(csv.split('\r\n')).toHaveLength(1003) // header + 1001 expenses + one payment
  // React Strict Mode can repeat the initial read. Check the page boundaries
  // and tenant scope; the totals and CSV above prove rows are not duplicated.
  const pages = state.requests.filter(x=>x.path.endsWith('/bookkeeping_entries') && x.method==='GET')
  expect([...new Set(pages.map(x=>Number(x.query.offset || 0)))].sort((a,b)=>a-b)).toEqual([0,1000])
  expect(pages.every(x=>x.query.business_id === 'eq.' + businessId && x.query.limit === '1000' && x.query.order === 'id.asc')).toBe(true)
})

test('bookkeeping owner can enter expense without changing payment transactions',async ({page})=>{
  const state=await mockFinance(page)
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
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
  await openWorkArea(page, 'Bookkeeping')
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
  await page.locator('.mobile-more-grid').getByRole('button',{name:'Financial performance'}).click()
  await expect(page.getByRole('button',{name:'Finviant Office workbook'})).toBeVisible()
  await expect(page.getByRole('button',{name:'QuickBooks Online'})).toBeVisible()
})

test('a failed workbook read shows unavailable totals and can recover without reporting a zero balance', async ({page}) => {
  const state = await mockFinance(page, {failManualRead:true})
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
  await expect(page.getByRole('heading',{name:'Workbook could not be loaded'})).toBeVisible({timeout:15000})
  await expect(page.locator('.bookkeeping-overview strong')).toHaveText(['Unavailable','Unavailable','Unavailable'])
  await expect(page.getByRole('button',{name:'Download CSV'})).toBeDisabled()
  await expect(page.getByRole('heading',{name:'Your workbook is ready'})).toHaveCount(0)
  // One failed source must not invalidate a separately verified source.
  await page.getByRole('button',{name:'QuickBooks Online',exact:true}).click()
  await expect(page.locator('.bookkeeping-overview strong').first()).toHaveText('$150.00')
  await expect(page.getByRole('button',{name:'Download CSV'})).toBeEnabled()
  await page.getByRole('button',{name:'Finviant Office workbook',exact:true}).click()
  state.failManualRead = false
  await page.getByRole('button',{name:'Retry loading workbook'}).click()
  await expect(page.locator('.bookkeeping-overview strong').nth(1)).toHaveText('$35.00')
  await expect(page.getByRole('button',{name:'Download CSV'})).toBeEnabled()
})

test('a failed reload after a write prevents exporting the previous workbook snapshot', async ({page}) => {
  const state = await mockFinance(page)
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
  await expect(page.getByText('Replacement parts',{exact:true})).toBeVisible()
  state.failManualRead = true
  await page.getByRole('button',{name:'+ Add expense or income'}).click()
  const dialog = page.getByRole('dialog',{name:'Add workbook entry'})
  await dialog.getByLabel('Amount in USD').fill('42.50')
  await dialog.getByLabel('Description').fill('Fuel after stale snapshot')
  await dialog.getByRole('button',{name:'Save entry'}).click()
  await expect(page.getByRole('heading',{name:'Workbook could not be loaded'})).toBeVisible({timeout:15000})
  await expect(page.getByText('Replacement parts',{exact:true})).toHaveCount(0)
  await expect(page.locator('.bookkeeping-overview strong')).toHaveText(['Unavailable','Unavailable','Unavailable'])
  await expect(page.getByRole('button',{name:'Download CSV'})).toBeDisabled()
  state.failManualRead = false
  await page.getByRole('button',{name:'Retry loading workbook'}).click()
  await expect(page.locator('.bookkeeping-overview strong').nth(1)).toHaveText('$77.50')
})

test('workbook text stays inert in HTML and formula prefixes are escaped in CSV', async ({page}) => {
  const markup = '<img src=x onerror="window.qaInjected=true">'
  await mockFinance(page,{manualRows:[{...manual,description:markup},{...manual,id:'88888888-8888-4888-8888-888888888888',description:'=1+1'}]})
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
  await expect(page.getByText(markup,{exact:true})).toBeVisible()
  expect(await page.evaluate(() => window.qaInjected)).toBeUndefined()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button',{name:'Download CSV'}).click()
  const stream = await (await downloaded).createReadStream()
  let csv=''
  for await (const chunk of stream) csv += chunk.toString()
  expect(csv).toContain('"\'=1+1"')
  expect(csv).not.toContain(',"=1+1",')
})

test('a failed workspace module preserves navigation and offers recovery', async ({page}) => {
  await mockFinance(page)
  await page.route('**/src/pages/BookkeepingPage.tsx*', route => route.abort('failed'))
  await page.goto('/')
  await openWorkArea(page, 'Bookkeeping')
  await expect(page.getByRole('heading',{name:'This page could not be opened'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Reload workspace'})).toBeEnabled()
  await expect(page.getByRole('button',{name:'Dashboard',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Dashboard',exact:true}).click()
  await expect(page.getByRole('heading',{name:'This page could not be opened'})).toHaveCount(0)
})
