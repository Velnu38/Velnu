import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { readReleaseQaTarget } from '../../scripts/qa/release-target.mjs'

const target = readReleaseQaTarget()

async function signIn(page, role) {
  const context = page.context()
  // Establish the bypass cookie only on the exact QA origin. Never add this
  // header to browser requests that could go to Supabase or another origin.
  const anonymous = await context.request.get(target.preview, { maxRedirects: 0 })
  const location = anonymous.headers().location
  const redirect = location ? new URL(location, target.preview) : null
  const sso = anonymous.status() >= 300 && anonymous.status() < 400 && redirect?.origin === 'https://vercel.com'
    && ['/login', '/sso-api'].includes(redirect.pathname)
  expect(sso || [401, 403].includes(anonymous.status()), 'Vercel must challenge unauthenticated QA access').toBe(true)
  const allowed = await context.request.get('/auth?mode=signin', {
    maxRedirects: 0,
    headers: {
      'x-vercel-protection-bypass': target.bypass,
      'x-vercel-set-bypass-cookie': 'true',
    },
  })
  expect(allowed.ok(), 'QA automation credential must reach the preview').toBe(true)

  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    const blocked = url.origin === target.database
      && /^\/functions\/v1\/(?:send-|fin-|ai-|transcribe-|execute-ai-|stripe-|twilio-|resend-|private-integration)/.test(url.pathname)
    if (blocked || ![target.preview, target.database].includes(url.origin)) return route.abort()
    return route.continue()
  })
  await page.goto('/auth?mode=signin')
  await expect(page.locator('meta[name="finviant-qa-commit"]')).toHaveAttribute('content', target.commit)
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  const { email, password } = target.accounts[role]
  try {
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
  } catch {
    // Do not print a Playwright fill error that could contain a credential.
    throw new Error('Unable to fill the QA sign-in form')
  }
  const [login] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.origin === target.database && url.pathname === '/auth/v1/token' && response.request().method() === 'POST'
    }),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ])
  expect(login.ok(), 'QA Supabase accepted the login').toBe(true)
  const business = role === 'outsider' ? target.outsiderBusiness : target.business
  await expect(page.getByRole('heading', { level: 1, name: business, exact: true })).toBeVisible()
  await expect(page.locator('.topbar-business .role-pill')).toHaveText(role === 'outsider' ? 'owner' : role)
}

async function addCustomer(page, name, email = '') {
  await page.goto('/?view=customers')
  await page.getByRole('button', { name: /New customer/ }).click()
  const form = page.getByRole('dialog', { name: 'Add a customer', exact: true })
  await form.getByLabel('First name', { exact: true }).fill(name)
  if (email) await form.getByLabel('Email', { exact: true }).fill(email)
  await form.getByLabel('Street address (optional)', { exact: true }).fill('100 Synthetic QA Way')
  await form.getByLabel('City', { exact: true }).fill('Test City')
  await form.getByLabel('State', { exact: true }).fill('VA')
  await form.getByLabel('ZIP', { exact: true }).fill('23320')
  await form.getByRole('button', { name: 'Save customer', exact: true }).click()
  await expect(page).toHaveURL(/view=customers&document=[a-f0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
  return new URL(page.url()).search
}

async function confirmAction(page, button, message) {
  await Promise.all([
    page.waitForEvent('dialog', { timeout: 15_000 }).then(async dialog => {
      try {
        expect(dialog.type()).toBe('confirm')
        expect(dialog.message()).toContain(message)
        await dialog.accept()
      } catch (error) {
        await dialog.dismiss().catch(() => {})
        throw error
      }
    }),
    button.click(),
  ])
}

test('owner records a synthetic job from customer creation through payment and reporting', async ({ page }) => {
  const tag = randomUUID().slice(0, 8)
  const customer = 'Release QA ' + tag
  const work = 'QA service visit ' + tag
  await test.step('Sign in and verify the QA owner workspace', () => signIn(page, 'owner'))
  await test.step('Create a customer and reopen it from the real backend', async () => {
    const record = await addCustomer(page, customer)
    await page.goto('/' + record)
    await expect(page.getByRole('heading', { level: 1, name: customer, exact: true })).toBeVisible()
  })

  await test.step('Save a priced estimate and record synthetic acceptance', async () => {
    await page.goto('/?view=estimates')
    await page.getByRole('button', { name: 'Create estimate', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Create an estimate', exact: true })
    await form.getByRole('combobox', { name: 'Customer', exact: true }).fill(customer)
    await form.getByRole('option', { name: new RegExp(customer) }).click()
    await form.getByLabel('Line 1 description', { exact: true }).fill(work)
    await form.getByLabel('Line 1 unit price', { exact: true }).fill('150')
    await form.locator('.document-tax-options > summary').click()
    await form.getByLabel('Default tax rate (%)', { exact: true }).fill('0')
    await form.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(form.locator('.document-paper')).toContainText('$150.00')
    await form.getByRole('button', { name: 'Save Draft', exact: true }).click()
    const saved = page.getByRole('dialog', { name: 'Estimate preview', exact: true })
    await expect(saved.locator('.document-paper')).toContainText(work)
    await confirmAction(page, saved.getByRole('button', { name: 'Mark sent manually' }), 'Mark this estimate')
    await confirmAction(page, saved.getByRole('button', { name: 'Record acceptance' }), 'accepted this estimate')
    await expect(page.getByRole('dialog', { name: 'Find a time that works', exact: true })).toBeVisible()
  })

  await test.step('Book the accepted estimate and complete the job', async () => {
    const schedule = page.getByRole('dialog', { name: 'Find a time that works', exact: true })
    await schedule.getByRole('button', { name: 'Time already agreed', exact: true }).click()
    await schedule.getByLabel('Job name', { exact: true }).fill(work)
    await expect(schedule.getByLabel('Service address', { exact: true })).not.toHaveValue('')
    await schedule.getByRole('button', { name: 'Confirm booking', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Your next step is ready', exact: true })).toContainText(/Job booked/)
    await page.getByRole('dialog', { name: 'Your next step is ready', exact: true }).getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto('/?view=work')
    await page.getByLabel('Search jobs', { exact: true }).fill(work)
    const job = page.getByRole('article').filter({ hasText: work })
    await job.getByRole('button', { name: 'Start job', exact: true }).click()
    await confirmAction(page, job.getByRole('button', { name: 'Mark complete', exact: true }), 'Complete this job?')
    await expect(job.getByText('Completed', { exact: true })).toBeVisible()
  })

  const invoiceNumber = await test.step('Open the generated invoice and record a synthetic cash payment', async () => {
    await page.goto('/?view=invoices')
    await page.getByLabel('Search invoices', { exact: true }).fill(customer)
    await page.getByRole('button', { name: new RegExp('^Open invoice .* for ' + customer + '$') }).click()
    const invoice = page.locator('.invoice-hero')
    await expect(invoice).toContainText(customer)
    await expect(invoice.locator('.invoice-hero-balance')).toContainText('$150.00')
    await expect(page.getByRole('link', { name: 'Open original approved estimate' })).toBeVisible()
    const number = await invoice.getByRole('heading', { level: 1 }).innerText()
    await confirmAction(page, page.getByRole('button', { name: 'Mark sent manually', exact: true }), 'records that you sent the invoice')
    await page.getByRole('button', { name: 'Mark Paid', exact: true }).click()
    const payment = page.getByRole('dialog', { name: 'Mark Paid', exact: true })
    await payment.getByLabel('Method', { exact: true }).selectOption('cash')
    await payment.getByLabel('Notes', { exact: true }).fill('Synthetic Finviant release QA payment')
    await confirmAction(page, payment.getByRole('button', { name: 'Mark Paid', exact: true }), 'Have you actually received this payment?')
    await expect(invoice.locator('.invoice-hero-balance strong')).toHaveText('$0.00')
    return number
  })

  await test.step('Verify the recorded payment appears in the workbook', async () => {
    await page.goto('/?view=bookkeeping')
    const entries = page.getByRole('row').filter({ hasText: 'Payment received · ' + invoiceNumber })
    await expect(entries).toHaveCount(1)
    await expect(entries.first()).toContainText('+$150.00')
  })
})

test('the owner can open each Needs Attention category backed by the live QA database', async ({ page }) => {
  await signIn(page, 'owner')
  const categories = page.getByRole('group', { name: 'Needs Attention categories', exact: true })
  for (const [label, filter] of [
    ['Schedule work', 'schedule'],
    ['Finish invoices', 'invoice'],
    ['Overdue payments', 'overdue'],
    ['Follow-ups due', 'follow_up'],
  ]) {
    const category = categories.getByRole('button', { name: new RegExp('^' + label + ' \\d+$') })
    const [result] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.origin === target.database && url.pathname === '/rest/v1/rpc/get_dashboard_attention_page'
          && response.request().method() === 'POST' && response.request().postDataJSON()?.p_filter === filter
      }),
      category.click(),
    ])
    expect(result.ok(), 'QA database accepted the ' + label + ' filter').toBe(true)
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    const queue = page.getByRole('region', { name: label, exact: true })
    await expect(queue).toHaveAttribute('aria-busy', 'false')
    await expect(queue.getByRole('alert')).toHaveCount(0)
  }
})

test('Fin offers a real saved QA customer and opens a prefilled invoice draft', async ({ page }) => {
  const tag = randomUUID().slice(0, 8)
  const customer = 'Fin customer QA ' + tag
  const email = 'finviant-qa-' + tag + '@example.test'
  await signIn(page, 'owner')
  await addCustomer(page, customer, email)
  await page.goto('/')
  await page.locator('.fin-launcher').getByRole('button', { name: 'Ask Fin', exact: true }).click()
  const assistant = page.getByRole('dialog', { name: 'Fin — your office assistant' })
  await assistant.getByRole('textbox', { name: 'Describe your invoice or request' }).fill(
    'Open invoice and create a new invoice for ' + customer + ' mowing $100',
  )
  await assistant.getByRole('button', { name: new RegExp('^Create invoice for ' + customer) }).click()
  await expect(page).toHaveURL(/view=invoices/)
  const editor = page.getByRole('dialog', { name: 'Create an invoice', exact: true })
  await expect(editor.getByRole('combobox', { name: 'Customer', exact: true })).toHaveValue(customer)
  await expect(editor.locator('.customer-picker-selected')).toContainText(email)
  await expect(editor.getByLabel('Line 1 description', { exact: true })).toHaveValue('mowing')
  await expect(editor.getByLabel('Line 1 unit price', { exact: true })).toHaveValue('100')
})

test('office staff with billing access can open Invoices', async ({ page }) => {
  await signIn(page, 'office')
  await page.goto('/?view=invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Know what’s owed and get paid faster.' })).toBeVisible()
})

test('technicians can open Jobs and are denied the direct invoice route', async ({ page }) => {
  await signIn(page, 'technician')
  await page.goto('/?view=work')
  await expect(page.getByRole('heading', { level: 1, name: 'Keep every job moving.' })).toBeVisible()
  await page.goto('/?view=invoices')
  await expect(page.getByRole('alert')).toContainText('This area is not included in your access.')
})

test('a second test business cannot open another tenant’s customer record', async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: target.preview, serviceWorkers: 'block' })
  const outsider = await browser.newContext({ baseURL: target.preview, serviceWorkers: 'block' })
  try {
    const ownerPage = await owner.newPage()
    const outsiderPage = await outsider.newPage()
    await signIn(ownerPage, 'owner')
    const customer = 'Tenant isolation QA ' + randomUUID().slice(0, 8)
    const record = await addCustomer(ownerPage, customer)
    await signIn(outsiderPage, 'outsider')
    await outsiderPage.goto('/' + record)
    await expect(outsiderPage.getByRole('heading', { name: 'Customer unavailable', exact: true })).toBeVisible()
    await expect(outsiderPage.getByText(customer, { exact: true })).toHaveCount(0)
  } finally {
    await Promise.all([owner.close(), outsider.close()])
  }
})
