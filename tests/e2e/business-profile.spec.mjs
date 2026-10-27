import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const user = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, name: 'Test Electric', legal_name: null, phone: '757-555-0100', email: 'info@example.test', website: null, address_line1: '101 Main Street', address_line2: null, city: 'Chesapeake', state: 'VA', postal_code: '23320', logo_path: null, document_accent: '#2563eb', document_footer: null, business_description: null, services_offered: null, service_area: null, team_size: null, team_roles: null, profile_completed_at: '2026-10-26T00:00:00Z' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(value => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session)
}

async function mockBusiness(page, existing = false, paid = existing) {
  let record = { ...company }
  const writes = []
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const method = req.method()
    let body = null
    try { body = req.postDataJSON() } catch {}
    if (method !== 'OPTIONS') writes.push({ path, method, body })
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(payload) })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_plan_preferences')) return json({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return json({ id: '88888888-8888-4888-8888-888888888888', agreement_version: '2026-10-26-v2' })
    if (path.endsWith('/business_members')) return json(existing ? { role: 'owner', business_id: businessId, businesses: record } : null)
    if (path.endsWith('/rpc/get_plan_usage')) return json({ plan: paid ? 'pro' : 'free', ai_limit: paid ? 50 : 0, voice_limit: paid ? 50 : 0, logo_bytes_limit: paid ? 131072 : 0 })
    if (path.endsWith('/business_service_interests')) return json(method === 'POST' ? {} : null, method === 'POST' ? 201 : 200)
    if (path.endsWith('/businesses') && (method === 'POST' || method === 'PATCH')) {
      record = { ...record, ...(body || {}) }
      return json(record, method === 'POST' ? 201 : 200)
    }
    if (path.includes('/storage/v1/object/')) return json({ Key: 'test-logo' })
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '*/0' } })
    return json([])
  })
  return writes
}

test('new owner can enter company branding and business context during onboarding', async ({ page }) => {
  await signedIn(page)
  const writes = await mockBusiness(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible()
  await page.getByLabel('Company name', { exact: true }).fill('Test Electric')
  await page.getByLabel('Business phone').fill('757-555-0100')
  await page.getByLabel('Street address').fill('101 Main Street')
  await page.getByLabel('City').fill('Chesapeake')
  await page.getByLabel('State / region').fill('VA')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Personalize invoices and estimates' })).toBeVisible()
  await page.getByLabel('Optional footer on invoices and estimates').fill('Thank you for your business.')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('What does your business do?').fill('We install and repair electrical equipment.')
  await page.getByLabel('Services offered').fill('Repairs, wiring, inspections')
  await page.getByLabel('Number of people (including owner)').fill('4')
  await page.getByLabel('Team responsibilities (optional)').fill('Owner handles quotes; electricians do field work.')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your optional Velnu services' })).toBeVisible()
  await page.getByRole('radio', { name: /À la carte/ }).check()
  await page.getByRole('checkbox', { name: /Voice-to-document assistant/ }).check()
  await page.getByRole('button', { name: 'Create my business' }).click()
  await expect(page.getByRole('button', { name: 'Company settings' })).toBeVisible()
  const save = writes.find(x => x.method === 'POST' && x.path.endsWith('/businesses'))
  expect(save).toBeTruthy()
  expect(save.body.name).toBe('Test Electric')
  expect(save.body.address_line1).toBe('101 Main Street')
  expect(save.body.team_size).toBe(4)
  expect(save.body.services_offered).toContain('Repairs')
  expect(save.body.profile_completed_at).toBeTruthy()
  const preferences = writes.find(x => x.method === 'POST' && x.path.endsWith('/business_service_interests'))
  expect(preferences?.body.preferred_plan).toBe('a_la_carte')
  expect(preferences?.body.selected_services).toContain('voice_drafts')
})

test('existing owner can update letterhead, upload a logo and retain business context', async ({ page }) => {
  await signedIn(page)
  const writes = await mockBusiness(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Company settings' }).click()
  await expect(page.getByRole('heading', { name: 'Make Velnu yours.' })).toBeVisible()
  await page.getByLabel('Business phone').fill('757-555-0199')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Company logo (optional, up to 2 MB)').setInputFiles({
    name: 'company-logo.png', mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Services offered').fill('Electrical inspections and repairs')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your optional Velnu services' })).toBeVisible()
  await page.getByRole('button', { name: 'Save company profile & services' }).click()
  await expect(page.getByRole('heading', { name: 'Make Velnu yours.' })).toBeVisible()
  await expect(page.getByText('757-555-0199')).toBeVisible()
  const updates = writes.filter(x => x.method === 'PATCH' && x.path.endsWith('/businesses'))
  expect(updates.length).toBeGreaterThanOrEqual(2)
  expect(updates.at(-1).body.logo_path).toMatch(/^11111111-1111-4111-8111-111111111111\/logo-/)
  expect(writes.some(x => x.path.includes('/storage/v1/object/velnu-business-logos/'))).toBe(true)
})


test('free owner has manual branding but no hosted logo uploads or paid AI assistant', async ({ page }) => {
  await signedIn(page)
  await mockBusiness(page, true, false)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Talk to Velnu' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Company settings' }).click()
  await expect(page.getByRole('heading', { name: 'Make Velnu yours.' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/Logo uploads are unavailable on Free/)).toBeVisible()
  await expect(page.getByLabel('Company logo (optional, up to 2 MB)')).toHaveCount(0)
  await expect(page.getByLabel('Document accent color')).toBeVisible()
})
