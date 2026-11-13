import {customerSearchResponse} from './job-customer-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
import { openWorkArea, createWork } from './navigation.mjs'
import { test, expect } from '@playwright/test'

const businessId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const customerId = '44444444-4444-4444-8444-444444444444'
const propertyId = '55555555-5555-4555-8555-555555555555'
const user = { id: userId, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const company = { id: businessId, created_by_user_id: user.id, name: 'Velnu Test Plumbing', role: 'owner', profile_completed_at: '2026-10-26T00:00:00Z' }
const customer = { id: customerId, first_name: 'Jane', last_name: 'Doe', company: null }
const property = { id: propertyId, customer_id: customerId, label: 'Service address', address_line1: '123 Example Street', address_line2: null, city: 'Chesapeake', state: 'VA', postal_code: '23320', access_notes: 'Private gate code 98765' }

async function fakeSession(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'test', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session)
}

async function mockBusinessData(page) {
  const requests = []
  await fakeSession(page)
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    let body = null
    try { body = request.postDataJSON() } catch {}
    requests.push({ path, method, body })
    const json = (obj, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': Array.isArray(obj) ? `0-${Math.max(0,obj.length-1)}/${obj.length}` : '0-0/1' },
      body: JSON.stringify(obj),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' })
    if (path.endsWith('/get_dashboard_invoice_totals')) return json({open_invoices:0,outstanding_balance:0})
    if (path.endsWith('/rpc/get_private_beta_access')) return json({allowed:true})
    if (path.endsWith('/rpc/business_onboarding_status')) return json({required:false,completed:true})
    if (path.endsWith('/user')) return json(user)
    if (path.endsWith('/user_plan_preferences')) return json({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return json({ id: '88888888-8888-4888-8888-888888888888', agreement_version: '2026-10-27-v3' })
    if (path.endsWith('/business_members')) return json({ business_id: businessId, role: 'owner', businesses: company })
    if (path.endsWith('/properties')) {
      const filters = new URL(request.url()).searchParams
      if (filters.has('id')) return json({ id: propertyId })
      if (filters.has('customer_id')) return json([property])
      return json([{ ...property, customers: customer }])
    }
    if (path.endsWith('/rpc/search_job_customers')) return json(customerSearchResponse([customer],body))
  if (path.endsWith('/customers')) return json(new URL(request.url()).searchParams.has('id') ? customer : [customer])
    if (path.endsWith('/rpc/create_job_atomic') && method === 'POST') return json({ id: '77777777-7777-4777-8777-777777777777', ...body.payload, status: 'lead' }, 200)
    if (path.endsWith('/jobs')) return json([])
    if (path.endsWith('/appointments')) {
      const start = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      return json([{ id: '66666666-6666-4666-8666-666666666666', title: 'Faucet replacement', starts_at: start, ends_at: null, status: 'scheduled', customers: customer, jobs: { id: '77777777-7777-4777-8777-777777777777', title: 'Faucet replacement', status: 'scheduled', properties: property } }])
    }
    return json([])
  })
  await mockJobDirectory(page,()=>[])
  return requests
}

test('service location opens a valid Google Maps view and driving directions without revealing access notes', async ({ page }) => {
  await mockBusinessData(page)
  await page.goto('/?view=dashboard')
  await page.locator('.sidebar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog',{name:'More navigation',exact:true}).getByRole('link',{name:/^Customers/}).click()
  await page.getByRole('button', { name: /Jane Doe/ }).click()
  await expect(page.getByRole('heading', { name: 'Address',exact:true })).toBeVisible()
  await expect(page.getByText('123 Example Street', { exact: true })).toBeVisible()
  const map = page.getByRole('link', { name: /View 123 Example Street.*Google Maps/ })
  const directions = page.getByRole('link', { name: /Get driving directions to 123 Example Street/ })
  await expect(map).toBeVisible()
  await expect(directions).toBeVisible()
  const searchUrl = new URL(await map.getAttribute('href'))
  const directionsUrl = new URL(await directions.getAttribute('href'))
  expect(searchUrl.origin).toBe('https://www.google.com')
  expect(searchUrl.pathname).toBe('/maps/search/')
  expect(searchUrl.searchParams.get('api')).toBe('1')
  expect(searchUrl.searchParams.get('query')).toContain('123 Example Street')
  expect(directionsUrl.pathname).toBe('/maps/dir/')
  expect(directionsUrl.searchParams.get('destination')).toContain('Chesapeake')
  expect(directionsUrl.searchParams.get('travelmode')).toBe('driving')
  expect((searchUrl.toString() + directionsUrl.toString()).includes('98765')).toBe(false)
  await expect(page.locator('iframe[src*="google.com/maps/embed"]')).toHaveCount(0)
})

test('owner assigns a matching customer property when creating a job', async ({ page }) => {
  const requests = await mockBusinessData(page)
  await page.goto('/?view=dashboard')
  await createWork(page,'job')
  await page.getByRole('combobox',{name:'Customer',exact:true}).click();await page.locator('[data-customer-id="'+customerId+'"]').click()
  await expect(page.getByLabel('Service location').locator('option[value="' + propertyId + '"]')).toHaveCount(1)
  await page.getByLabel('Service location').selectOption(propertyId)
  await page.getByRole('textbox', { name: 'Job title' }).fill('Replace faucet')
  await page.getByRole('button', { name: 'Create job',exact:true }).click()
  await expect.poll(() => requests.filter(r => r.path.endsWith('/rpc/create_job_atomic') && r.method === 'POST').length).toBe(1)
  const write = requests.find(r => r.path.endsWith('/rpc/create_job_atomic') && r.method === 'POST')
  expect(write.body.target_business_id).toBe(businessId)
  expect(write.body.payload.customer_id).toBe(customerId)
  expect(write.body.payload.property_id).toBe(propertyId)
  expect(write.body.request_id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(requests.filter(r => r.path.endsWith('/jobs') && r.method === 'POST')).toHaveLength(0)
})

test('schedule shows driving directions from its associated job location', async ({ page }) => {
  await mockBusinessData(page)
  await page.goto('/?view=dashboard')
  await openWorkArea(page, 'Schedule')
  const url = await page.getByRole('link', { name: /Get driving directions to 123 Example Street/ }).getAttribute('href')
  expect(new URL(url).searchParams.get('destination')).toContain('123 Example Street')
  await expect(page.getByText(/Faucet replacement/).first()).toBeVisible()
})

test('mobile Customers contains service locations and route links without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBusinessData(page)
  await page.goto('/?view=dashboard')
  await page.locator('.mobile-nav').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog',{name:'More navigation',exact:true}).getByRole('link', { name: /^Customers/ }).click()
  await page.getByRole('button', { name: /Jane Doe/ }).click()
  await expect(page.getByRole('link', { name: /Get driving directions to 123 Example Street/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
