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

  // Simulate browser speech recognition, rather than calling a paid transcription API.
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {}
      stop() {
        this.onresult?.({ results: [[{ transcript: 'Create an invoice for Bob Smith for $150' }]] })
        this.onend?.()
      }
    }
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Talk to Velnu' })).toBeVisible()
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('button', { name: 'Tap and speak' }).click()
  await expect(page.getByRole('button', { name: 'Tap to stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Tap to stop' }).click()
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


test('Safari no-speech error shows a keyboard microphone fallback instead of a silent failure', async ({ page }) => {
  await signedIn(page)
  await page.route('https://example.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    const body = path.endsWith('/user') ? user : path.endsWith('/business_members') ? { business_id: businessId, role: 'owner', businesses: { id: businessId, name: 'Velnu Test Services' } } : []
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {}
      stop() {
        this.onerror?.({ error: 'no-speech' })
        this.onend?.()
      }
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('button', { name: 'Tap and speak' }).click()
  await page.getByRole('button', { name: 'Tap to stop' }).click()
  await expect(page.getByText(/No speech detected by Safari/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Describe your invoice or request' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review invoice' })).toHaveCount(0)
})

test('Safari retains speech for other commands and makes the user submit deliberately', async ({ page }) => {
  await signedIn(page)
  const invoked = []
  await page.route('https://example.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    invoked.push(path)
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    const body = path.endsWith('/user') ? user : path.endsWith('/business_members') ? { business_id: businessId, role: 'owner', businesses: { id: businessId, name: 'Velnu Test Services' } } : []
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {}
      stop() {
        this.onresult?.({ results: [[{ transcript: 'Who has not paid me?' }]] })
        this.onend?.()
      }
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('button', { name: 'Tap and speak' }).click()
  await page.getByRole('button', { name: 'Tap to stop' }).click()
  await expect(page.getByRole('textbox', { name: 'Describe your invoice or request' })).toHaveValue('Who has not paid me?')
  await expect(page.getByRole('button', { name: 'Send command' })).toBeEnabled()
  expect(invoked.filter(path => path.includes('/functions/v1/ai-command'))).toHaveLength(0)
})


test('cloud recording uses server transcription and opens draft review, without sending an invoice', async ({ page }) => {
  await signedIn(page)
  const calls = []
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    calls.push({ path, method, type: request.headers()['content-type'] || '' })
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/business_members')) return json({ business_id: businessId, role: 'owner', businesses: { id: businessId, name: 'Velnu Test Services' } })
    if (path.endsWith('/functions/v1/transcribe-voice')) {
      return request.headers()['content-type']?.includes('application/json')
        ? json({ configured: true, model: 'gpt-transcribe' })
        : json({ transcript: 'Create an invoice for Bob Smith for $150', transcription_id: '55555555-5555-4555-8555-555555555555' })
    }
    return json([])
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    })
    window.MediaRecorder = class {
      static isTypeSupported(mime) { return mime === 'audio/webm;codecs=opus' }
      constructor(_stream, options) {
        this.state = 'inactive'
        this.mimeType = options?.mimeType || 'audio/webm'
      }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([new Uint8Array(512)], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk to Velnu' }).click()
  await page.getByRole('button', { name: 'Tap and speak' }).click()
  await expect(page.getByRole('button', { name: 'Tap to stop' })).toBeVisible()
  await page.getByRole('button', { name: 'Tap to stop' }).click()
  await expect(page.getByRole('heading', { name: 'Review the invoice before saving' })).toBeVisible()
  await expect(page.getByLabel('Amount ($)')).toHaveValue('150')
  expect(calls.filter(x => x.path.endsWith('/functions/v1/transcribe-voice'))).toHaveLength(2)
  expect(calls.filter(x => x.path.endsWith('/invoices') && x.method === 'POST')).toHaveLength(0)
  expect(calls.filter(x => x.path.includes('/send-invoice-email'))).toHaveLength(0)
})
