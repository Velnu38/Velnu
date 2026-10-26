import { test, expect } from '@playwright/test'

// Customer approval pages require no Velnu account. All functions are mocked:
// these tests never send email, accept real work, or change business data.
const token = 'velnu-test-token-'.padEnd(48, 'a')
const estimate = {
  business_name: 'Chesapeake Plumbing',
  business_profile: {
    name: 'Chesapeake Plumbing', phone: '757-555-0144',
    address_line1: '100 Test Street', city: 'Chesapeake', state: 'VA',
    document_accent: '#1d4ed8', document_footer: 'Thank you for your business.'
  },
  document_type: 'estimate',
  document: {
    id: '22222222-2222-4222-8222-222222222222',
    estimate_number: 'EST-2026-101', status: 'sent',
    issue_date: '2026-10-26', expires_on: '2026-11-15',
    subtotal: 300, tax_amount: 15, total: 315,
    customer_message: 'A 25% deposit is due before work begins.'
  },
  items: [{ description: 'Replace kitchen faucet', quantity: 1, unit_price: 300, tax_rate: 5, line_total: 300 }],
  customer: { first_name: 'Jamie', last_name: 'Doe', company: null },
  expires_at: '2026-11-15T23:59:59Z', completed: null
}

async function mockApproval(page) {
  let complete = null
  const requests = []
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    let body = null
    try { body = request.postDataJSON() } catch {}
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    }
    requests.push({ path, body })
    if (path.endsWith('/functions/v1/customer-approval')) {
      if (body?.mode === 'approved' || body?.mode === 'declined') {
        complete = { action: body.mode, typed_name: body.typed_name, created_at: new Date().toISOString(), amount: 315, terms_agreed: body.terms_agreed }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ action: body.mode, already_consumed: false }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ...estimate, completed: complete }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' })
  })
  return requests
}

test('sent estimate shows scope, terms, required agreement and an acceptance button', async ({ page }) => {
  const requests = await mockApproval(page)
  await page.goto('/?approval=' + token)
  await expect(page.getByRole('heading', { name: 'EST-2026-101' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Estimate terms' })).toBeVisible()
  await expect(page.getByText('A 25% deposit is due before work begins.')).toBeVisible()
  const accept = page.getByRole('button', { name: 'Accept estimate and agree to terms' })
  await expect(accept).toBeDisabled()
  await page.getByLabel('Full name').fill('Jamie Doe')
  await expect(accept).toBeDisabled()
  await page.getByRole('checkbox', { name: /I have reviewed the estimate/ }).check()
  await expect(accept).toBeEnabled()
  await accept.click()
  const accepted = requests.filter(x => x.path.endsWith('/functions/v1/customer-approval') && x.body?.mode === 'approved')
  expect(accepted).toHaveLength(1)
  expect(accepted[0].body.terms_agreed).toBe(true)
  expect(accepted[0].body.typed_name).toBe('Jamie Doe')
  await expect(page.getByRole('heading', { name: 'Document accepted' })).toBeVisible()
  await expect(accept).toHaveCount(0)
})

test('declining an estimate does not require agreeing to its terms', async ({ page }) => {
  const requests = await mockApproval(page)
  await page.goto('/?approval=' + token)
  await page.getByLabel('Full name').fill('Jamie Doe')
  await page.getByRole('button', { name: 'Decline' }).click()
  const submitted = requests.filter(x => x.body?.mode === 'declined')
  expect(submitted).toHaveLength(1)
  expect(submitted[0].body.terms_agreed).toBe(false)
  await expect(page.getByRole('heading', { name: 'Document declined' })).toBeVisible()
})

test('estimate approval and explicit consent are usable on phone-sized screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApproval(page)
  await page.goto('/?approval=' + token)
  await expect(page.getByRole('heading', { name: 'Estimate terms' })).toBeVisible()
  const checkbox = page.getByRole('checkbox', { name: /I have reviewed the estimate/ })
  await checkbox.scrollIntoViewIfNeeded()
  await expect(checkbox).toBeVisible()
  await checkbox.check()
  await page.getByLabel('Full name').fill('Jamie Doe')
  await expect(page.getByRole('button', { name: 'Accept estimate and agree to terms' })).toBeEnabled()
})
