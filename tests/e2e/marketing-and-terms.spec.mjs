import { test, expect } from '@playwright/test'

const userId = '33333333-3333-4333-8333-333333333333'
const user = {
  id: userId, email: 'owner@example.test', aud: 'authenticated',
  role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
}
const acceptedRecord = { id: '88888888-8888-4888-8888-888888888888', user_id: userId, agreement_version: '2026-10-26-v1' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = {
    access_token: header + '.' + payload + '.test', refresh_token: 'test',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer', user,
  }
  await page.addInitScript(value => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session)
}

test('public homepage explains features, clearly leaves Basic and Pro prices unset, and links to signup', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your work/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'A plan for where you are today.' })).toBeVisible()
  const cards = page.locator('.marketing-price-card')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0).getByText('Free', { exact: true }).first()).toBeVisible()
  await expect(cards.nth(1).getByText('Coming soon')).toBeVisible()
  await expect(cards.nth(2).getByText('Coming soon')).toBeVisible()
  await expect(cards.nth(0).getByText('0 online customer approvals / acceptances')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Another set of hands/ })).toBeVisible()
  await expect(page.getByText(/Paid capability · In testing/)).toBeVisible()
  await expect(page.getByText('No payment, subscription or automatic upgrade is activated by registering for the beta.')).toBeVisible()
  await page.getByRole('link', { name: /Join private beta/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

test('public privacy and terms pages can be read without logging in', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Velnu Business User Agreement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /AI features, voice recordings/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Employees, workers/ })).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Velnu Privacy Notice' })).toBeVisible()
  await expect(page.getByText(/Supabase for authentication and business data/)).toBeVisible()
})

test('mobile landing page has accessible signup and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Join private beta/i }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('authenticated user is blocked from workspace until AI, terms and e-record acceptance is saved', async ({ page }) => {
  await signedIn(page)
  let agreed = false
  let workspaceQueriesBeforeConsent = 0
  const writes = []
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const method = req.method()
    let body = null
    try { body = req.postDataJSON() } catch {}
    const json = (value, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(value),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_agreement_acceptances')) {
      if (method === 'POST') {
        writes.push(body)
        agreed = true
        return json(acceptedRecord, 201)
      }
      return json(agreed ? acceptedRecord : null)
    }
    if (path.endsWith('/business_members')) {
      if (!agreed) workspaceQueriesBeforeConsent++
      return json(null)
    }
    return json([])
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Review and accept the Velnu user agreement' })).toBeVisible()
  await expect(page.getByText(/Velnu uses artificial intelligence/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toHaveCount(0)
  const continueButton = page.getByRole('button', { name: 'I agree · Continue to Velnu' })
  await expect(continueButton).toBeDisabled()
  const consent = page.getByRole('checkbox')
  await consent.nth(0).check()
  await consent.nth(1).check()
  await expect(continueButton).toBeDisabled()
  await consent.nth(2).check()
  await continueButton.click()
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    user_id: user.id,
    agreement_version: '2026-10-26-v1',
    terms_accepted: true,
    ai_disclosure_acknowledged: true,
    electronic_records_consent: true,
  })
  expect(workspaceQueriesBeforeConsent).toBe(0)
})

test('existing accepted account proceeds without accepting a second time', async ({ page }) => {
  await signedIn(page)
  let agreementsRead = 0
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const json = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_agreement_acceptances')) { agreementsRead++; return json(acceptedRecord) }
    if (path.endsWith('/business_members')) return json(null)
    return json([])
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review and accept the Velnu user agreement' })).toHaveCount(0)
  expect(agreementsRead).toBeGreaterThanOrEqual(1)
})
