import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const user = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, created_by_user_id: user.id, name: 'Test Electric', legal_name: null, phone: '757-555-0100', email: 'info@example.test', website: null, address_line1: '101 Main Street', address_line2: null, city: 'Chesapeake', state: 'VA', postal_code: '23320', logo_path: null, document_accent: '#2563eb', document_footer: null, business_description: null, services_offered: null, service_area: null, team_size: null, team_roles: null, profile_completed_at: '2026-10-26T00:00:00Z' }

async function signedIn(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(value => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session)
}

async function mockBusiness(page, existing = false, paid = existing) {
  let record = { ...company }
  let completed = existing, channels = null, delivery = {plan:'free',email:'info@example.test',phone:'+17575550100',personal_email_ready:false,personal_sms_ready:false,managed_email_ready:false,managed_sms_ready:false,acknowledged:false}
  let documentSettings = {default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:'',payment_service_setups:null}
  const writes = []
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const method = req.method()
    let body = null
    try { body = req.postDataJSON() } catch {}
    if (method !== 'OPTIONS') writes.push({ path, method, body })
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': Array.isArray(payload) ? `0-${Math.max(0,payload.length-1)}/${payload.length}` : '0-0/1' }, body: JSON.stringify(payload) })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/rpc/get_private_beta_access')) return json({allowed:true})
    if (path.endsWith('/rpc/business_onboarding_status')) {channels=body?.p_channels||channels;completed=completed||body?.p_complete===true;return json({required:!completed,completed,channels})}
    if (path.endsWith('/rpc/save_delivery_setup')) {delivery={...delivery,email:body.p_email,phone:body.p_phone,personal_email_ready:body.p_email_ready,personal_sms_ready:body.p_sms_ready,acknowledged:body.p_acknowledged};return json(delivery)}
    if (path.endsWith('/rpc/get_delivery_setup')) return json(delivery)
    if (path.endsWith('/business_settings')) {if(method==='POST'||method==='PATCH')documentSettings={...documentSettings,...body};return json(documentSettings)}
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_plan_preferences')) return json({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return json({ id: '88888888-8888-4888-8888-888888888888', agreement_version: '2026-10-27-v3' })
    if (path.endsWith('/business_members')) return json(existing ? { role: 'owner', business_id: record.id, access_modules:['calendar','jobs','billing','finances'], businesses: record } : null)
    if (path.endsWith('/rpc/get_business_storage_usage')) return json({ plan: paid === 'basic' ? 'basic' : paid ? 'pro' : 'free', limit_bytes: paid ? 2000000000 : 100000000, remaining_bytes: paid ? 2000000000 : 100000000, used_bytes: 0, pending_bytes: 0, warning: 'none', logo_allowed: !!paid })
    if (path.endsWith('/functions/v1/upload-attachment')) return json({ path: new URL(req.url()).searchParams.get('path') })
    if (path.endsWith('/rpc/get_plan_usage')) return json({ plan: paid === 'basic' ? 'basic' : paid ? 'pro' : 'free', ai_limit: paid ? 50 : 0, voice_limit: paid ? 50 : 0, logo_bytes_limit: paid ? 131072 : 0 })
    if (path.endsWith('/business_service_interests')) return json(method === 'POST' ? {} : null, method === 'POST' ? 201 : 200)
    if (path.endsWith('/businesses') && (method === 'POST' || method === 'PATCH')) {
      record = { ...record, ...(body || {}) }
      existing = true
      return json(record, method === 'POST' ? 201 : 200)
    }
    if (path.includes('/storage/v1/object/')) return json({ Key: 'test-logo' })
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '*/0' } })
    return json([])
  })
  return writes
}

test('new owner completes required setup, then saves optional context, branding and service preferences', async ({ page }) => {
  await signedIn(page)
  const writes = await mockBusiness(page)
  await page.goto('/?view=dashboard')
  await expect(page.getByRole('heading', { name: 'Thank You for choosing Finviant!' })).toBeVisible()
  await page.getByLabel('Business name · Required', { exact: true }).fill('Test Electric')
  await page.getByRole('radio', { name: 'Both', exact: true }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Business reply email · Required', { exact: true }).fill('info@example.test')
  await page.getByLabel('Business / owner mobile · Required for texting', { exact: true }).fill('757-555-0100')
  await page.locator('summary').filter({hasText:'Optional business details'}).click()
  await page.getByLabel('Street address · Optional', {exact:true}).fill('101 Main Street')
  await page.getByLabel('City · Optional', {exact:true}).fill('Chesapeake')
  await page.getByLabel('State / region · Optional', {exact:true}).fill('VA')
  await page.getByRole('button', { name: 'Save & continue', exact:true }).click()
  await expect(page.getByRole('heading',{name:'Check your sending methods',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Save & finish setup',exact:true})).toBeDisabled()
  await page.locator('summary').filter({hasText:'Using your own email or messaging apps'}).click()
  await page.getByLabel('My email app is configured.',{exact:true}).check()
  await page.getByLabel('My text app and mobile service are configured.',{exact:true}).check()
  await page.getByLabel('I understand sending must be activated',{exact:false}).check()
  await page.getByRole('button',{name:'Save & finish setup',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Your required business details are saved!',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Open my dashboard',exact:true}).click()
  await expect(page.locator('.sidebar').getByRole('button', { name: 'More', exact: true })).toBeVisible()
  const save = writes.find(x => x.method === 'POST' && x.path.endsWith('/businesses'))
  expect(save).toBeTruthy()
  expect(save.body).toMatchObject({name:'Test Electric',email:'info@example.test',phone:'757-555-0100',address_line1:'101 Main Street',city:'Chesapeake',state:'VA'})
  expect(save.body.profile_completed_at).toBeTruthy()
  expect(writes.some(x=>x.path.endsWith('/rpc/business_onboarding_status')&&x.body.p_complete===true&&x.body.p_channels==='both')).toBe(true)
  expect(writes.some(x=>x.path.endsWith('/rpc/save_delivery_setup')&&x.body.p_acknowledged===true&&x.body.p_email_ready===true&&x.body.p_sms_ready===true)).toBe(true)

  await page.goto('/?view=settings&section=company')
  await page.getByLabel('What does your business do?').fill('We install and repair electrical equipment.')
  await page.getByLabel('Services offered').fill('Repairs, wiring, inspections')
  await page.getByLabel('Number of people (including owner)').fill('4')
  await page.getByLabel('Team responsibilities (optional)').fill('Owner handles quotes; electricians do field work.')
  await page.getByRole('button', { name: 'Save company profile', exact:true }).click()
  await expect(page.getByRole('status').filter({hasText:'Company profile saved'})).toBeVisible()
  await page.locator('summary').filter({hasText:'Optional Finviant services'}).click()
  await page.getByRole('radio', { name: /^Individual / }).check()
  await page.getByRole('button', { name: 'Save service preferences', exact:true }).click()
  await expect(page.getByRole('status').filter({hasText:'Service preferences saved'})).toBeVisible()
  const preferences = writes.find(x => x.method === 'POST' && x.path.endsWith('/business_service_interests'))
  expect(preferences?.body.preferred_plan).toBe('basic')
  await page.goto('/?view=settings&section=documents')
  await page.getByLabel('Document footer', {exact:true}).fill('Thank you for your business.')
  await page.getByRole('button', { name: 'Save document setup', exact:true }).click()
  await expect(page.getByRole('status').filter({hasText:'Document setup saved'})).toBeVisible()
  const updated=writes.filter(x=>x.method==='PATCH'&&x.path.endsWith('/businesses')).at(-1).body
  expect(updated).toMatchObject({team_size:4,services_offered:'Repairs, wiring, inspections',business_description:'We install and repair electrical equipment.',team_roles:'Owner handles quotes; electricians do field work.',document_footer:'Thank you for your business.'})
})

test('existing owner edits company details and context, then document branding in their settings sections', async ({ page }) => {
  await signedIn(page)
  const writes = await mockBusiness(page, true)
  await page.goto('/?view=dashboard')
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Company Profile/ }).click()
  await page.getByLabel('Business phone').fill('757-555-0199')
  await page.getByLabel('Services offered').fill('Electrical inspections and repairs')
  await page.getByRole('button', { name: 'Save company profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Company profile saved' })).toBeVisible()
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Invoice & Estimate Setup/ }).click()
  await page.getByLabel('Company logo (PNG, JPG or WebP, up to 2 MB)').setInputFiles({
    name: 'company-logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'),
  })
  await page.getByLabel('Document footer', { exact: true }).fill('Thank you for your business.')
  await page.getByRole('button', { name: 'Save document setup' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Document setup saved' })).toBeVisible()
  const updates = writes.filter(x => x.method === 'PATCH' && x.path.endsWith('/businesses'))
  expect(updates.at(-1).body.logo_path).toMatch(/^11111111-1111-4111-8111-111111111111\/logo-/)
  expect(updates.at(-1).body.phone).toBe('757-555-0199')
  expect(updates.at(-1).body.services_offered).toContain('Electrical inspections')
  expect(writes.some(x => x.path.endsWith('/functions/v1/upload-attachment'))).toBe(true)
})

test('free owner has manual branding but no hosted logo uploads or paid AI assistant', async ({ page }) => {
  await signedIn(page)
  await mockBusiness(page, true, false)
  await page.goto('/?view=dashboard')
  await expect(page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true})).toHaveCount(0)
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Invoice & Estimate Setup/ }).click()
  await expect(page.getByText(/Hosted logo uploads require an activated paid plan/)).toBeVisible()
  await expect(page.getByLabel('Company logo (PNG, JPG or WebP, up to 2 MB)')).toHaveCount(0)
  await expect(page.getByLabel('Accent color', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Document footer', { exact: true })).toBeVisible()
})

test('activated Basic tier can upload company logo when backend grants storage quota', async ({ page }) => {
  await signedIn(page)
  const writes = await mockBusiness(page, true, 'basic')
  await page.goto('/?view=dashboard')
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Invoice & Estimate Setup/ }).click()
  await page.getByLabel('Company logo (PNG, JPG or WebP, up to 2 MB)').setInputFiles({
    name: 'basic-logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'),
  })
  await page.getByRole('button', { name: 'Save document setup' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Document setup saved' })).toBeVisible()
  expect(writes.some(x => x.path.endsWith('/functions/v1/upload-attachment'))).toBe(true)
})
