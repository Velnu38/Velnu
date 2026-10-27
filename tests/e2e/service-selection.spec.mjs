import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const user = { id: userId, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, name: 'Velnu Test Services', role: 'owner', document_accent: '#2563eb', profile_completed_at: '2026-10-26T00:00:00Z', logo_path: null }
const agreement = { id:'88888888-8888-4888-8888-888888888888', agreement_version:'2026-10-26-v1' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript(session => localStorage.setItem('sb-example-auth-token', JSON.stringify(session)), {
    access_token: header + '.' + payload + '.test', refresh_token: 'test', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user,
  })
}

test('website shows non-billable à la carte chooser and carries selected interests into signup', async ({ page }) => {
  await page.goto('/services')
  await expect(page.getByRole('heading', { name: /Choose what you need/ })).toBeVisible()
  await expect(page.getByText(/non-billable feature interests/)).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(4)
  await page.getByRole('radio', { name: /À la carte/ }).check()
  await page.getByRole('checkbox', { name: /Voice-to-document assistant/ }).check()
  await page.getByRole('checkbox', { name: /Bookkeeping & integrations/ }).check()
  await expect(page.getByText('2 optional services selected')).toBeVisible()
  const pending = await page.evaluate(() => localStorage.getItem('velnu.beta.service-interests.v1'))
  expect(JSON.parse(pending)).toMatchObject({
    plan:'a_la_carte', services:['voice_drafts','bookkeeping'],
  })
  await page.getByRole('button', { name: /Continue to account setup/ }).click()
  await expect(page).toHaveURL(/\/auth\?mode=signup/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  const after = await page.evaluate(() => localStorage.getItem('velnu.beta.service-interests.v1'))
  expect(after).toBe(pending)
})

test('web app installation page explains browser access with no store download', async ({ page }) => {
  await page.goto('/install')
  await expect(page.getByRole('heading', { name: /One Velnu account/ })).toBeVisible()
  await expect(page.getByText(/There's nothing to download/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'iPhone / iPad' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Android' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open Velnu web app/ })).toHaveAttribute('href','/auth?mode=signin')
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  const parsed = await manifest.json()
  expect(parsed.start_url).toBe('/auth?mode=signin')
  expect(parsed.display).toBe('standalone')
})

test('signed-in owner saves account service interests without purchase or billing', async ({ page }) => {
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
      status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify(value),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: {'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:'' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_agreement_acceptances')) return json(agreement)
    if (path.endsWith('/business_members')) return json({business_id:businessId,role:'owner',businesses:company})
    if (path.endsWith('/business_service_interests')) return method === 'POST' ? json({},201) : json(null)
    return json([])
  })
  await page.goto('/auth?mode=signin')
  await expect(page.getByRole('button', { name: 'My services' })).toBeVisible()
  await page.getByRole('button', { name: 'My services' }).click()
  await expect(page.getByRole('heading', { name: 'Build your Velnu workspace.' })).toBeVisible()
  await page.getByRole('radio', { name: /À la carte/ }).check()
  await page.getByRole('checkbox', { name: /Online estimate approvals/ }).check()
  await page.getByRole('button', { name: 'Save my service preferences' }).click()
  await expect(page.locator('.workspace-services .form-message.success-text')).toContainText(/No services were purchased or activated/)
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
  await expect(page.getByRole('checkbox', { name: /Voice-to-document assistant/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.goto('/install')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
