import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { pdfHeaders, PDF_REVISION } from './document-pdf-fixture.mjs'

// Customer approval pages require no Finviant Office account. All functions are mocked:
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

// Scope and terms now live in the canonical issued PDF, not duplicate HTML.
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
pdf.addPage().drawText([
  estimate.document.estimate_number,
  estimate.items[0].description,
  'Quantity: 1 | Unit price: $300.00 | Tax: $15.00 | Total: $315.00',
  'Issued: '+estimate.document.issue_date+' | Expires: '+estimate.document.expires_on,
  'Estimate terms',
  estimate.document.customer_message,
].join('\n'), { x: 40, y: 740, size: 12, font })
const issuedPdf = Buffer.from(await pdf.save())
async function reviewIssuedPdf(page) {
  const downloadButton = page.getByRole('button', { name: 'Download PDF', exact: true })
  await expect(downloadButton).toBeEnabled()
  const downloaded = page.waitForEvent('download')
  await downloadButton.click()
  const stream = await (await downloaded).createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  expect(Buffer.concat(chunks).equals(issuedPdf)).toBe(true)
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
    if (path.endsWith('/functions/v1/document-pdf')) return route.fulfill({status:200,headers:pdfHeaders,body:issuedPdf})
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
  await reviewIssuedPdf(page)
  expect(requests.some(x => x.path.endsWith('/functions/v1/document-pdf') && x.body?.token === token && x.body?.token_type === 'approval')).toBe(true)
  const accept = page.getByRole('button', { name: 'Accept estimate and agree to terms' })
  await expect(accept).toBeDisabled()
  await page.getByLabel('Full name').fill('Jamie Doe')
  await expect(accept).toBeDisabled()
  await page.getByRole('checkbox', { name: /I reviewed the displayed estimate/ }).check()
  await expect(accept).toBeEnabled()
  await accept.click()
  await expect.poll(() => requests.filter(x => x.body?.mode === 'approved').length).toBe(1)
  const accepted = requests.filter(x => x.path.endsWith('/functions/v1/customer-approval') && x.body?.mode === 'approved')
  expect(accepted).toHaveLength(1)
  expect(accepted[0].body.terms_agreed).toBe(true)
  expect(accepted[0].body.expected_revision_id).toBe(PDF_REVISION)
  expect(accepted[0].body.typed_name).toBe('Jamie Doe')
  await expect(page.getByRole('heading', { name: 'Estimate accepted' })).toBeVisible()
  await expect(accept).toHaveCount(0)
  expect(requests.filter(x => /send[-_]/.test(x.path))).toHaveLength(0)
})

test('declining an estimate does not require agreeing to its terms', async ({ page }) => {
  const requests = await mockApproval(page)
  await page.goto('/?approval=' + token)
  await reviewIssuedPdf(page)
  await page.getByLabel('Full name').fill('Jamie Doe')
  page.once('dialog',d=>d.accept());await page.getByRole('button', { name: 'Decline estimate' }).click()
  await expect.poll(() => requests.filter(x => x.body?.mode === 'declined').length).toBe(1)
  const submitted = requests.filter(x => x.body?.mode === 'declined')
  expect(submitted).toHaveLength(1)
  expect(submitted[0].body.terms_agreed).toBe(false)
  expect(submitted[0].body.expected_revision_id).toBe(PDF_REVISION)
  await expect(page.getByRole('heading', { name: 'Estimate declined' })).toBeVisible()
  expect(requests.filter(x => /send[-_]/.test(x.path))).toHaveLength(0)
})

test('estimate approval and explicit consent are usable on phone-sized screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = await mockApproval(page)
  await page.goto('/?approval=' + token)
  await reviewIssuedPdf(page)
  const checkbox = page.getByRole('checkbox', { name: /I reviewed the displayed estimate/ })
  await checkbox.scrollIntoViewIfNeeded()
  await expect(checkbox).toBeVisible()
  await checkbox.check()
  await page.getByLabel('Full name').fill('Jamie Doe')
  await expect(page.getByRole('button', { name: 'Accept estimate and agree to terms' })).toBeEnabled()
  expect(requests.filter(x => x.body?.mode === 'approved' || x.body?.mode === 'declined' || /send[-_]/.test(x.path))).toHaveLength(0)
})
