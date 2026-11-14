import { test, expect } from '@playwright/test'
import {fulfillPdf,PDF_REVISION} from './document-pdf-fixture.mjs'
async function openDelivery(page){
 await page.getByRole('button',{name:'Send invoice',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Send invoice',exact:true})
 await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
 return dialog
}

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
    if (url.pathname.endsWith('/functions/v1/document-pdf')) return fulfillPdf(route)
    if (url.pathname.endsWith('/rpc/get_plan_usage')) return json({plan:'pro',ai_limit:0,voice_limit:0})
    if (url.pathname.endsWith('/rpc/get_delivery_setup')) return json({plan:'pro',personal_email_ready:false,personal_sms_ready:false,managed_email_ready:true,managed_sms_ready:false,acknowledged:true,email:user.email,phone:null})
    if (url.pathname.endsWith('/rpc/get_delivery_automation')) return json({plan:'pro',ready:true,rule:{enabled:false,after_days:3,repeat_days:7,max_reminders:3},tasks:[]})
    if (url.pathname.endsWith('/rpc/get_invoice_payment_operations')) return json({state:'clear',refunds:[]})
    if (url.pathname.endsWith('/rpc/get_document_change_context')) return json({can_change:false,work_status:'unscheduled'})
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
  await page.goto('/auth?mode=signin')
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
  await expect(page.getByRole('button', { name: 'Return to Finviant Office' })).toBeEnabled()
  expect(requests.filter(item => item.path.endsWith('/user') && item.method === 'PUT')).toHaveLength(1)
  expect(requests.filter(item => item.path.endsWith('/logout'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Return to Finviant Office' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
})

test('invoice resolves object customer relation and sends directly from the review', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/tests/invoice.html')
  await expect(page.getByText('Trial Customer · customer@example.test')).toBeVisible()
  const delivery=await openDelivery(page)
  await delivery.getByRole('button', { name: 'Send Email', exact: true }).click()
  await expect(delivery.getByRole('status')).toContainText('accepted for delivery')
  const sends = requests.filter(item => item.path.endsWith('/send-invoice-email') && item.method === 'POST')
  expect(sends).toHaveLength(1)
  expect(sends[0].body.business_id).toBe(businessId)
  expect(sends[0].body.invoice_id).toBe(invoiceId)
  expect(sends[0].body.expected_recipient).toBe(customer.email)
  expect(sends[0].body.expected_revision_id).toBe(PDF_REVISION)
  expect(sends[0].body).not.toHaveProperty('recipient')
  expect(sends[0].body).not.toHaveProperty('notes')
})

test('failed email retries reuse the request identifier', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page, { failFirst: true, customerArray: true })
  await page.goto('/tests/invoice.html')
  const delivery=await openDelivery(page)
  await delivery.getByRole('button', { name: 'Send Email', exact: true }).click()
  await expect(delivery.getByRole('alert')).toContainText('Provider unavailable')
  await delivery.getByRole('button', { name: 'Retry email', exact: true }).click()
  await expect(delivery.getByRole('status')).toContainText('accepted for delivery')
  const sends = requests.filter(item => item.path.endsWith('/send-invoice-email') && item.method === 'POST')
  expect(sends).toHaveLength(2)
  expect(sends[0].body.request_id).toBe(sends[1].body.request_id)
})

test('reviewing the saved invoice without pressing send never sends a message', async ({ page }) => {
  await signedIn(page)
  const requests = await mockApi(page)
  await page.goto('/tests/invoice.html')
  const delivery=await openDelivery(page)
  await expect(delivery.getByRole('button', { name: 'Send Email', exact: true })).toBeEnabled()
  expect(requests.filter(item => item.path.endsWith('/send-invoice-email'))).toHaveLength(0)
})

test('sign-in and password recovery remain usable on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto('/auth?mode=signin')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-recovery.png', fullPage: true })
})


test('repeat signup response does not imply a new account or require waiting forever', async ({ page }) => {
  let signups = 0
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const json = (value, status=200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value),
    })
    if (req.method() === 'OPTIONS') return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '',
    })
    if (path.endsWith('/signup')) {
      signups++
      // Supabase masks repeated registration of confirmed accounts using a successful response.
      return json({ user: { ...user, id: '99999999-9999-4999-8999-999999999999' }, session: null })
    }
    if (path.endsWith('/recover')) return json({})
    return json({})
  })
  await page.goto('/auth?mode=signup')
  await page.getByLabel('Email', { exact: true }).fill('existing@example.test')
  await page.getByLabel('Password', { exact: true }).fill('NotARealPassword123!')
  await page.getByLabel('Confirm password', {exact:true}).fill('NotARealPassword123!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('If you registered before')
  await expect(page.getByRole('button', {name:'Already registered? Sign in'})).toBeVisible()
  expect(signups).toBe(1)
  await page.getByRole('button', {name:'Already registered? Sign in'}).click()
  await expect(page.getByRole('heading', {name:'Sign in', exact:true})).toBeVisible()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('button', {name:'Send reset link'})).toBeVisible()
})
