import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const invoiceId = '22222222-2222-4222-8222-222222222222'
const user = { id: '33333333-3333-4333-8333-333333333333', email: 'contractor@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const customer = { id: '44444444-4444-4444-8444-444444444444', first_name: 'Trial', last_name: 'Customer', company: null, email: 'customer@example.test', phone: null }
const invoice = { id: invoiceId, business_id: businessId, customer_id: customer.id, invoice_number: 'INV-1001', status: 'draft', issue_date: '2026-09-14', due_date: '2026-10-01', subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100, notes: 'Private office note', customer_message: 'Thank you', sent_at: null, paid_at: null, customers: customer }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: `${header}.${payload}.test-signature`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(session => localStorage.setItem('sb-example-auth-token', JSON.stringify(session)), session)
}

async function mockApi(page, options = {}) {
  const requests = []
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON()
    requests.push({ path: url.pathname, query: url.searchParams, method: request.method(), body })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) })
    if (url.pathname.endsWith('/recover')) return json({})
    if (url.pathname.endsWith('/user')) return json(user)
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
    if (url.pathname.endsWith('/invoices')) return json({ ...invoice, customers: options.customerArray ? [customer] : customer })
    if (url.pathname.endsWith('/invoice_items')) return json([{ id: 'item-1', description: 'Trial service', quantity: 1, unit_price: 100, tax_rate: 0, line_total: 100 }])
    if (url.pathname.endsWith('/payments') || url.pathname.endsWith('/messages')) return json([])
    if (url.pathname.endsWith('/send-invoice-email')) {
      const attempts = requests.filter(item => item.path.endsWith('/send-invoice-email') && item.method === 'POST').length
      if (options.failFirst && attempts === 1) return json({ error: 'Provider unavailable. Retry the same send.' }, 502)
      return json({ status: 'accepted', email_id: 'test-email-id', recipient: customer.email })
    }
    return json({ error: `Unexpected mocked request: ${url.pathname}` }, 400)
  })
  return requests
}

test('forgot password requests an on-site recovery link and gives a generic account message', async ({ page }) => {
  const requests = await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('If an account exists')
  const request = requests.find(item => item.path.endsWith('/recover'))
  expect(request.body.email).toBe(user.email)
  expect(request.query.get('redirect_to')).toBe('http://127.0.0.1:4173/?recovery=1')
})

test('expired recovery link offers a fresh link instead of a password form', async ({ page }) => {
  await mockApi(page)
  await page.goto('/?recovery=1#error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('invalid or expired')
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0)
})

test('password mismatch cannot submit an account update', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/?recovery=1')
  await page.getByLabel('New password', { exact: true }).fill('TrialPassword123!')
  await page.getByLabel('Confirm password').fill('DifferentPassword123!')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('status')).toContainText('do not match')
  expect(requests.filter(item => item.path.endsWith('/user') && item.method === 'PUT')).toHaveLength(0)
})

test('valid password update completes and signs out', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/?recovery=1')
  await page.getByLabel('New password', { exact: true }).fill('TrialPassword123!')
  await page.getByLabel('Confirm password').fill('TrialPassword123!')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to Velnu' })).toBeEnabled()
  expect(requests.filter(item => item.path.endsWith('/user') && item.method === 'PUT')).toHaveLength(1)
  expect(requests.filter(item => item.path.endsWith('/logout'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Return to Velnu' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
})

test('invoice resolves object customer relation and requires send confirmation', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/tests/invoice.html')
  await expect(page.getByText('Trial Customer · customer@example.test')).toBeVisible()
  await page.getByRole('button', { name: 'Email customer', exact: true }).click()
  expect(requests.filter(item => item.path.endsWith('/send-invoice-email'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('accepted for delivery')
  const sends = requests.filter(item => item.path.endsWith('/send-invoice-email') && item.method === 'POST')
  expect(sends).toHaveLength(1)
  expect(sends[0].body.business_id).toBe(businessId)
  expect(sends[0].body.invoice_id).toBe(invoiceId)
  expect(sends[0].body).not.toHaveProperty('recipient')
  expect(sends[0].body).not.toHaveProperty('notes')
})

test('failed email retries reuse the request identifier', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page, { failFirst: true, customerArray: true })
  await page.goto('/tests/invoice.html')
  await page.getByRole('button', { name: 'Email customer', exact: true }).click()
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Provider unavailable')
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('accepted for delivery')
  const sends = requests.filter(item => item.path.endsWith('/send-invoice-email') && item.method === 'POST')
  expect(sends).toHaveLength(2)
  expect(sends[0].body.request_id).toBe(sends[1].body.request_id)
})

test('canceling the email confirmation never sends a message', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/tests/invoice.html')
  await page.getByRole('button', { name: 'Email customer', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(requests.filter(item => item.path.endsWith('/send-invoice-email'))).toHaveLength(0)
})

test('sign-in and password recovery remain usable on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-recovery.png', fullPage: true })
})
