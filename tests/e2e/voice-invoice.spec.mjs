import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const newCustomerId = '44444444-4444-4444-8444-444444444444'
const invoiceId = '22222222-2222-4222-8222-222222222222'
const user = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(value => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session)
}

test('dictated one-line invoice is reviewed before saving and stays draft', async ({ page }) => {
  const requests = []
  await signedIn(page)
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    let body = null
    try { body = request.postDataJSON() } catch {}
    requests.push({ path, method, body })
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/business_members')) return json({ business_id: businessId, role: 'owner', businesses: { id: businessId, name: 'Velnu Test Services' } })
    if (path.endsWith('/customers') && method === 'POST') return json({ id: newCustomerId, company: 'Bob Smith', first_name: null, last_name: null, email: null, phone: null }, 201)
    if (path.endsWith('/invoices') && method === 'POST') return json({ id: invoiceId, invoice_number: 'INV-TEST-1' }, 201)
    if (path.endsWith('/invoice_items') && method === 'POST') return json([], 201)
    if (path.endsWith('/invoices') && request.url().includes('id=eq.')) return json({ id: invoiceId, invoice_number: 'INV-TEST-1', status: 'draft', subtotal: 150, tax_amount: 0, total: 150, amount_paid: 0, balance_due: 150, due_date: null })
    return json([])
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Talk to Velnu' })).toBeVisible()
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('textbox', { name: 'Describe your invoice or request' }).fill('Create an invoice for Bob Smith for $150')
  await expect(page.getByRole('button', { name: 'Review invoice' })).toBeVisible()
  await page.getByRole('button', { name: 'Review invoice' }).click()
  await expect(page.getByRole('heading', { name: 'Review the invoice before saving' })).toBeVisible()
  await expect(page.getByLabel('New customer name or company')).toHaveValue('Bob Smith')
  await expect(page.getByLabel('Amount ($)')).toHaveValue('150')
  expect(requests.filter(item => item.path.endsWith('/invoices') && item.method === 'POST')).toHaveLength(0)

  await page.getByLabel('Work performed / line-item description').fill('Faucet repair')
  await page.getByRole('button', { name: 'Save draft invoice' }).click()
  await expect(page.getByText('Invoice INV-TEST-1 is ready.')).toBeVisible()
  const invoiceWrites = requests.filter(item => item.path.endsWith('/invoices') && item.method === 'POST')
  expect(invoiceWrites).toHaveLength(1)
  expect(invoiceWrites[0].body.status).toBe('draft')
  expect(requests.filter(item => item.path.includes('/send-invoice-email'))).toHaveLength(0)
})

test('multiple stated amounts are never silently turned into a one-line invoice', async ({ page }) => {
  await signedIn(page)
  await page.route('https://example.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    const body = path.endsWith('/user') ? user : path.endsWith('/business_members') ? { business_id: businessId, role: 'owner', businesses: { id: businessId, name: 'Velnu Test Services' } } : []
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('textbox', { name: 'Describe your invoice or request' }).fill('Make an invoice for Bob Smith for $300 labor and $200 materials')
  await page.getByRole('button', { name: 'Review invoice' }).click()
  await expect(page.getByText(/multiple amounts/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save draft invoice' })).toBeDisabled()
})
