import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const user = { id: userId, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, created_by_user_id: user.id, name: 'Finviant Test Services', role: 'owner', document_accent: '#2563eb', profile_completed_at: '2026-10-26T00:00:00Z', logo_path: null }
const agreement = { id:'88888888-8888-4888-8888-888888888888', agreement_version:'2026-10-27-v3' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript(session => localStorage.setItem('sb-example-auth-token', JSON.stringify(session)), {
    access_token: header + '.' + payload + '.test', refresh_token: 'test', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user,
  })
}

test('legacy services URL shows private testing and directs users to signup without selling a plan', async ({ page }) => {
  await page.goto('/services')
  await expect(page.getByRole('heading', { name: 'Test Finviant Office before public beta.' })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByText(/No subscription or charges are active/)).toBeVisible()
  await page.getByRole('link', { name: /Join private beta/i }).first().click()
  await expect(page).toHaveURL(/\/auth\?mode=signup/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

test('web app installation page explains browser access with no store download', async ({ page }) => {
  await page.goto('/install')
  await expect(page.getByRole('heading', { name: /One Finviant Office account/ })).toBeVisible()
  await expect(page.getByText(/There's nothing to download/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'iPhone / iPad' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Android' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open Finviant Office web app/ })).toHaveAttribute('href','/auth?mode=signin')
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  const parsed = await manifest.json()
  expect(parsed.start_url).toBe('/auth?mode=signin')
  expect(parsed.display).toBe('standalone')
})

async function openServicePreferences(page) {
  await signedIn(page)
  const requests = []
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const method = req.method()
    let body = null
    try { body = req.postDataJSON() } catch {}
    if (method !== 'OPTIONS') requests.push({ path, method, body })
    const json = (value,status=200) => route.fulfill({
      status,contentType:'application/json',headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': Array.isArray(value) ? `0-${Math.max(0,value.length-1)}/${value.length}` : '0-0/1' },
      body:JSON.stringify(value),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: {'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_plan_preferences')) return json({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return json(agreement)
    if (path.endsWith('/business_members')) return json({business_id:businessId,role:'owner',businesses:company})
    if (path.endsWith('/businesses') && method === 'PATCH') return json({ ...company, ...body })
    if (path.endsWith('/business_service_interests')) return method === 'POST' ? json({},201) : json(null)
    return json([])
  })
  await page.goto('/auth?mode=signin')
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Company Profile/ }).click()
  await page.getByText('Optional Finviant services',{exact:true}).click()
  return requests
}

test('signed-in owner saves account service interests without purchase or billing', async ({ page }) => {
  const requests = await openServicePreferences(page)
  await page.getByRole('radio', { name: /À la carte/ }).check()
  await page.getByRole('checkbox', { name: /Online estimate approvals/ }).check()
  await page.getByRole('button', { name: 'Save service preferences' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Service preferences saved' })).toBeVisible()
  const writes = requests.filter(x=>x.path.endsWith('/business_service_interests') && x.method==='POST')
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toMatchObject({
    business_id: businessId, updated_by: userId,
    preferred_plan:'a_la_carte',selected_services:['estimate_approvals'],
  })
  expect(requests.filter(x=>/checkout|subscription|billing|payment_intents/i.test(x.path))).toHaveLength(0)
  expect(await page.evaluate(() => localStorage.getItem('velnu.beta.service-interests.v1'))).toBeNull()
})

test('mobile service selector and install guide are responsive', async ({ page }) => {
  await page.setViewportSize({width:390,height:844})
  await page.goto('/services')
  await expect(page.getByRole('heading', { name: 'Test Finviant Office before public beta.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.goto('/install')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})


test('company service preferences show proposed assistant prices and Free eligibility without activating purchases', async ({ page }) => {
  const requests = await openServicePreferences(page)
  const assistants = page.locator('.service-assistant-options')
  const scheduling = assistants.locator('label.service-addon-card').filter({ hasText: 'Scheduling Assistant' }).getByRole('checkbox')
  const bookkeeping = assistants.locator('label.service-addon-card').filter({ hasText: 'Bookkeeping Assistant' }).getByRole('checkbox')

  await expect(scheduling).toBeDisabled()
  await expect(bookkeeping).toBeDisabled()
  await page.getByRole('radio', { name: /Basic/ }).check()
  await expect(scheduling).toBeEnabled()
  await scheduling.check()
  await bookkeeping.check()
  await expect(assistants.locator('.service-assistant-subtotal')).toContainText('$34.97 / month')
  await expect(assistants.getByText('$9.99 / mo')).toBeVisible()
  await expect(assistants.getByText('$14.99 / mo')).toBeVisible()

  await page.getByRole('radio', { name: /Pro/ }).check()
  await expect(scheduling).toBeChecked()
  await expect(bookkeeping).toBeChecked()
  await expect(assistants.locator('.service-assistant-subtotal')).toContainText('$44.97 / month')
  await expect(assistants.getByText('$7.99 / mo')).toBeVisible()
  await expect(assistants.getByText('$11.99 / mo')).toBeVisible()

  await page.getByRole('radio', { name: /^Free/ }).check()
  await expect(scheduling).toBeDisabled()
  await expect(bookkeeping).toBeDisabled()
  await expect(scheduling).not.toBeChecked()
  await expect(bookkeeping).not.toBeChecked()
  expect(requests.filter(x => x.path.endsWith('/business_service_interests') && x.method === 'POST')).toHaveLength(0)
  expect(requests.filter(x => /checkout|subscription|payment_intents/i.test(x.path))).toHaveLength(0)
})

test('marketing homepage keeps proposed assistant subscriptions out of the private-testing landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.marketing-assistant-price-table')).toHaveCount(0)
  await expect(page.getByText(/No subscription or charges are active/)).toBeVisible()
  await expect(page.locator('.marketing-ai-status')).toContainText('In testing.')
})
