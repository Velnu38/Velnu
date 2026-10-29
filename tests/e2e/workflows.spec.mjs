import { openWorkArea } from './navigation.mjs'
import { test, expect } from '@playwright/test'

// Browser workflow tests use a fake Supabase API. No customers are emailed, no
// live payments are recorded, and no production data is changed.
const businessId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const customerId = '44444444-4444-4444-8444-444444444444'
const invoiceId = '22222222-2222-4222-8222-222222222222'
const estimateId = '55555555-5555-4555-8555-555555555555'
const paymentId = '66666666-6666-4666-8666-666666666666'
const user = { id: userId, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const customer = { id: customerId, first_name: 'Jane', last_name: 'Doe', company: null, phone: '757-555-0100', email: 'jane@example.test' }
const company = { id: businessId, name: 'Test Plumbing', role: 'owner', phone: '757-555-0188', email: 'office@example.test', address_line1: '100 Main Street', city: 'Chesapeake', state: 'VA', postal_code: '23320', logo_path: null, document_accent: '#2563eb', profile_completed_at: '2026-10-01T00:00:00Z' }

async function installSession(page) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: header + '.' + payload + '.test', refresh_token: 'refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
  await page.addInitScript(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session)
}

async function mockWorkspace(page, seed = {}) {
  const state = {
    customers: [customer],
    invoices: [...(seed.invoices || [])],
    estimates: [...(seed.estimates || [])],
    payments: [],
    changeOrders: [...(seed.changeOrders || [])],
    requests: [],
  }
  await installSession(page)
  await page.route('https://example.supabase.co/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let body = null
    try { body = request.postDataJSON() } catch {}
    state.requests.push({ path, method, url: request.url(), body })
    const fulfill = (obj, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' },
      body: JSON.stringify(obj),
    })
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    if (path.endsWith('/user')) return fulfill(user)
    if (path.endsWith('/user_plan_preferences')) return fulfill({ user_id: '33333333-3333-4333-8333-333333333333', selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return fulfill({ id: '88888888-8888-4888-8888-888888888888', agreement_version: '2026-10-27-v3' })
    if (path.endsWith('/business_members')) return fulfill({ role: seed.role || 'owner', business_id: businessId, businesses: company })
    if (path.endsWith('/rpc/get_dashboard_invoice_totals')) {
      const open = state.invoices.filter(i => Number(i.balance_due || 0) > 0 && !['draft', 'void'].includes(i.status))
      return fulfill({
        open_invoices: open.length,
        outstanding_balance: open.reduce((sum, i) => sum + Number(i.balance_due || 0), 0),
      })
    }
    if (path.endsWith('/rpc/create_document')) {
      const isInvoice = body.document_kind === 'invoice'
      const items = body.payload.items
      const subtotal = seed.documentTotals?.subtotal ?? items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      const tax_amount = seed.documentTotals?.tax_amount ?? items.reduce((sum, item) => sum + item.quantity * item.unit_price * item.tax_rate / 100, 0)
      const next = {
        id: isInvoice ? invoiceId : estimateId, business_id: businessId, customer_id: body.payload.customer_id,
        invoice_number: isInvoice ? 'INV-1001' : undefined, estimate_number: isInvoice ? undefined : 'EST-1001',
        status: 'draft', issue_date: '2026-10-26', due_date: body.payload.due_date || null,
        expires_on: body.payload.expires_on || null, subtotal, tax_amount, total: subtotal + tax_amount,
        amount_paid: 0, balance_due: subtotal + tax_amount,
        notes: body.payload.notes || null, customer_message: null, customers: customer,
      }
      if (isInvoice) state.invoices.push(next)
      else state.estimates.push(next)
      return fulfill(next)
    }
    if (path.endsWith('/rpc/convert_estimate_to_invoice')) {
      const e = state.estimates.find(row => row.id === body.target_estimate_id)
      if (e) e.status = 'converted'
      return fulfill(invoiceId)
    }
    if (path.endsWith('/rpc/record_manual_payment')) {
      state.payments.push({ id: paymentId, amount: body.payment_amount, method: body.payment_method, status: 'succeeded', paid_at: new Date().toISOString(), invoice_id: body.invoice_id, invoices: state.invoices.find(i => i.id === body.invoice_id) })
      return fulfill(state.payments.at(-1))
    }
    if (path.endsWith('/customers')) return fulfill(state.customers)
    if (path.endsWith('/invoices')) {
      const row = state.invoices.find(i => i.id === url.searchParams.get('id')?.replace(/^eq\./, ''))
      if (row) return fulfill(row)
      const isOpenSelector = url.searchParams.has('balance_due') && url.searchParams.has('status')
      return fulfill(isOpenSelector ? state.invoices.filter(i => i.status !== 'draft' && i.status !== 'void') : state.invoices)
    }
    if (path.endsWith('/estimates')) {
      if (method === 'PATCH') {
        const target = state.estimates.find(i => i.id === url.searchParams.get('id')?.replace(/^eq\./, ''))
        if (target) target.status = body.status
        return fulfill([])
      }
      return fulfill(state.estimates)
    }
    if (path.endsWith('/payments')) return fulfill(state.payments)
    if (path.endsWith('/invoice_items')) return fulfill(seed.invoiceItems ?? (state.invoices.length ? [{ id: 'a', description: 'Faucet repair', quantity: 1, unit_price: 150, line_total: 150, tax_rate: 0, sort_order: 0 }] : []))
    if (path.endsWith('/estimate_items')) return fulfill([{ id: 'b', description: 'Faucet repair', quantity: 1, unit_price: 150, line_total: 150, tax_rate: 0, sort_order: 0 }])
    if (path.endsWith('/change_orders')) {
      if (method === 'PATCH') {
        const row = state.changeOrders.find(o => o.id === url.searchParams.get('id')?.replace(/^eq\./, ''))
        if (row) row.status = body.status
        return fulfill(row || null)
      }
      return fulfill(state.changeOrders)
    }
    if (path.endsWith('/messages') || path.endsWith('/jobs') || path.endsWith('/appointments') || path.endsWith('/reminders')) return fulfill([])
    return fulfill([])
  })
  return state
}

test('owner creates a branded invoice atomically and it remains a draft until manually sent', async ({ page }) => {
  const state = await mockWorkspace(page)
  await page.goto('/')
  await openWorkArea(page, 'Invoices')
  await page.getByRole('button', { name: '+ New invoice' }).click()
  await page.getByLabel('Customer', { exact: true }).selectOption(customerId)
  await page.getByPlaceholder('Description').fill('Faucet repair')
  await page.getByPlaceholder('Unit price').fill('150')
  await page.getByPlaceholder('Tax %').fill('5')
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await expect(page.getByRole('heading', { name: 'INV-1001' })).toBeVisible()
  await expect(page.locator('.invoice-document .letterhead-company')).toHaveText('Test Plumbing')
  await expect(page.getByText('100 Main Street')).toBeVisible()
  const created = state.requests.filter(x => x.path.endsWith('/rpc/create_document'))
  expect(created).toHaveLength(1)
  expect(created[0].body.document_kind).toBe('invoice')
  expect(created[0].body.payload.items[0].tax_rate).toBe(5)
  expect(created[0].body.request_id).toBeTruthy()
  expect(state.requests.filter(x => x.path.endsWith('/invoices') && x.method === 'POST')).toHaveLength(0)
  expect(state.requests.filter(x => x.path.includes('/send-invoice-email'))).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0)
})

test('estimate requires explicit offline acceptance before conversion to invoice', async ({ page }) => {
  const state = await mockWorkspace(page)
  page.on('dialog', async dialog => { await dialog.accept() })
  await page.goto('/')
  await openWorkArea(page, 'Estimates')
  await page.getByRole('button', { name: '+ New estimate' }).click()
  await page.getByLabel('Customer', { exact: true }).selectOption(customerId)
  await page.getByPlaceholder('Description').fill('Faucet repair')
  await page.getByPlaceholder('Unit price').fill('150')
  await page.getByRole('button', { name: 'Create estimate' }).click()
  await expect(page.getByRole('button', { name: 'Mark sent manually' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create invoice' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark sent manually' }).click()
  await page.getByRole('button', { name: 'Record acceptance' }).click()
  await expect(page.getByRole('button', { name: 'Create invoice' })).toBeVisible()
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await expect(page.getByRole('heading', { name: 'Create the invoice' })).toBeVisible()
  await page.getByRole('button', { name: 'Create invoice', exact: true }).last().click()
  expect(state.requests.some(x => x.path.endsWith('/rpc/convert_estimate_to_invoice'))).toBe(true)
  const created = state.requests.filter(x => x.path.endsWith('/rpc/create_document'))
  expect(created[0].body.document_kind).toBe('estimate')
  expect(state.estimates[0].status).toBe('converted')
})

test('payments exclude draft invoices and use retry-safe server recording', async ({ page }) => {
  const draft = { id: '77777777-7777-4777-8777-777777777777', invoice_number: 'INV-DRAFT', status: 'draft', total: 150, balance_due: 150, amount_paid: 0, customers: customer }
  const sent = { id: invoiceId, invoice_number: 'INV-SENT', status: 'sent', total: 150, balance_due: 150, amount_paid: 0, customers: customer }
  const state = await mockWorkspace(page, { invoices: [draft, sent] })
  page.on('dialog', async dialog => { await dialog.accept() })
  await page.goto('/')
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  await page.getByRole('button', { name: '+ Record payment' }).click()
  await expect(page.getByLabel('Invoice', { exact: true }).locator('option', { hasText: /INV-SENT/ })).toHaveCount(1)
  const options = await page.getByLabel('Invoice', { exact: true }).locator('option').allTextContents()
  expect(options.join(' ')).toContain('INV-SENT')
  expect(options.join(' ')).not.toContain('INV-DRAFT')
  await page.getByLabel('Invoice', { exact: true }).selectOption(invoiceId)
  await page.getByRole('button', { name: 'Record payment', exact: true }).last().click()
  const requests = state.requests.filter(x => x.path.endsWith('/rpc/record_manual_payment'))
  expect(requests).toHaveLength(1)
  expect(requests[0].body.payment_amount).toBe(150)
  expect(requests[0].body.request_id).toBeTruthy()
  expect(state.requests.filter(x => x.path.endsWith('/payments') && x.method === 'POST')).toHaveLength(0)
})

test('mobile More menu exposes invoices and editable company settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockWorkspace(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'More' }).click()
  await page.locator('.mobile-more-grid').getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Make Finviant Office yours.' })).toBeVisible()
})


test('issued invoice preserves original company letterhead after profile changes', async ({ page }) => {
  const issued = {
    id: invoiceId, invoice_number: 'INV-HISTORIC', status: 'sent',
    issue_date: '2026-10-26', due_date: null, subtotal: 150, tax_amount: 0, total: 150,
    amount_paid: 0, balance_due: 150, notes: 'Private note', customer_message: null,
    customer_id: customerId, sent_at: '2026-10-26T12:00:00Z', paid_at: null,
    customers: customer,
    issuer_snapshot: {
      name: 'Original Plumbing Co', address_line1: '55 Historic Road',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      phone: '757-555-1111', document_accent: '#335577',
      document_footer: 'Original invoice terms',
    },
  }
  await mockWorkspace(page, { invoices: [issued] })
  await page.goto('/')
  await openWorkArea(page, 'Invoices')
  await page.getByRole('button', { name: /INV-HISTORIC/ }).click()
  await expect(page.locator('.invoice-document .letterhead-company')).toHaveText('Original Plumbing Co')
  await expect(page.locator('.invoice-document')).toContainText('55 Historic Road')
  await expect(page.locator('.invoice-document')).toContainText('Original invoice terms')
  await expect(page.locator('.invoice-document')).not.toContainText('100 Main Street')
})

test('issued estimate preview shows original issuer and saved footer, not current company profile', async ({ page }) => {
  const issued = {
    id: estimateId, estimate_number: 'EST-HISTORIC', status: 'sent',
    issue_date: '2026-10-26', expires_on: '2026-11-15',
    subtotal: 150, tax_amount: 0, total: 150, customer_id: customerId,
    customers: customer, customer_message: '30-day validity',
    issuer_snapshot: {
      name: 'Original Estimate Co', address_line1: '75 Old Street',
      city: 'Chesapeake', state: 'VA', postal_code: '23320',
      document_accent: '#113355', document_footer: 'Original estimate terms',
    },
  }
  await mockWorkspace(page, { estimates: [issued] })
  await page.goto('/')
  await openWorkArea(page, 'Estimates')
  await page.getByRole('button', { name: 'Preview / Print' }).click()
  const document = page.locator('.estimate-preview-document')
  await expect(document.locator('.letterhead-company')).toHaveText('Original Estimate Co')
  await expect(document).toContainText('75 Old Street')
  await expect(document).toContainText('Original estimate terms')
  await expect(document).not.toContainText('100 Main Street')
})


test('technician keeps field navigation but cannot edit invoices, estimates or payments', async ({ page }) => {
  await mockWorkspace(page, { role: 'technician' })
  await page.goto('/')
  await openWorkArea(page, 'Jobs')
  await expect(page.getByRole('button', { name: '+ New job' })).toBeVisible()
  await openWorkArea(page, 'Invoices')
  await expect(page.getByRole('button', { name: '+ New invoice' })).toHaveCount(0)
  await openWorkArea(page, 'Estimates')
  await expect(page.getByRole('button', { name: '+ New estimate' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Payments', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ Record payment' })).toHaveCount(0)
})


test('issued change order cannot be reverted to draft and voiding requires confirmation', async ({ page }) => {
  const changeOrderId = '99999999-9999-4999-8999-999999999999'
  const order = {
    id: changeOrderId, change_order_number: 'CO-TEST', status: 'sent',
    title: 'Extra plumbing work', description: 'Install valve', reason: 'Customer request',
    issue_date: '2026-10-26', subtotal: 80, tax_amount: 0, total: 80,
    customer_id: customerId, job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    customers: customer, jobs: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Kitchen repair' },
    schedule_impact_days: 0, schedule_note: null, sent_at: '2026-10-26T12:00:00Z',
  }
  const issuedInvoice = { id: invoiceId, invoice_number: 'INV-CONTEXT', status: 'sent', issue_date: '2026-10-26', customer_id: customerId, job_id: order.job_id, subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100, customers: customer }
  const state = await mockWorkspace(page, { changeOrders: [order], invoices: [issuedInvoice], invoiceItems: [{ id: 'context-item', description: 'Original work', quantity: 1, unit_price: 100, line_total: 100, tax_rate: 0, sort_order: 0 }] })
  page.on('dialog', async dialog => { await dialog.accept() })
  await page.goto('/')
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Change Orders', exact: true })).toHaveCount(0)
  await openWorkArea(page, 'Invoices')
  await page.getByRole('button', { name: /INV-CONTEXT/ }).click()
  await page.getByRole('button', { name: 'Change orders', exact: true }).click()
  await expect(page.getByText('CO-TEST')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark sent manually' })).toHaveCount(0)
  await expect(page.locator('.change-order-row select')).toHaveCount(0)
  await page.getByRole('button', { name: 'Void', exact: true }).click()
  await expect(page.locator('.change-order-row .status-chip')).toHaveText('void')
  const changed = state.requests.filter(x => x.path.endsWith('/change_orders') && x.method === 'PATCH')
  expect(changed).toHaveLength(1)
  expect(changed[0].body.status).toBe('void')
})


test('dashboard uses one tenant-scoped aggregate RPC instead of downloading invoice balances', async ({ page }) => {
  const state = await mockWorkspace(page, {
    invoices: [
      { id: invoiceId, status: 'sent', balance_due: 125, due_date: '2026-10-31' },
      { id: '77777777-7777-4777-8777-777777777777', status: 'draft', balance_due: 900 },
    ],
  })
  await page.goto('/')
  await expect(page.getByLabel('Open invoice balance', { exact: true })).toContainText('$125.00')
  const aggregates = state.requests.filter(r => r.path.endsWith('/rpc/get_dashboard_invoice_totals'))
  expect(aggregates).toHaveLength(1)
  expect(aggregates[0].body.target_business_id).toBe(businessId)
  const unbounded = state.requests.filter(r => r.path.endsWith('/invoices') &&
    new URL(r.url).searchParams.get('select') === 'balance_due')
  expect(unbounded).toHaveLength(0)
})

test('fractional invoice preview and saved draft retain database per-line rounding', async ({ page }) => {
  const invoiceItems = ['First fractional service', 'Second fractional service'].map((description, i) => ({ id: 'fractional-' + i, description, quantity: 1.5, unit_price: 0.01, line_total: 0.02, tax_rate: 0, sort_order: i }))
  const state = await mockWorkspace(page, { documentTotals: { subtotal: 0.04, tax_amount: 0 }, invoiceItems })
  await page.goto('/')
  await openWorkArea(page, 'Invoices')
  await page.getByRole('button', { name: '+ New invoice' }).click()
  await page.getByLabel('Customer', { exact: true }).selectOption(customerId)
  await page.getByPlaceholder('Description').fill('First fractional service')
  await page.getByPlaceholder('Qty').fill('1.5')
  await page.getByPlaceholder('Unit price').fill('0.01')
  await page.getByRole('button', { name: '+ Add line' }).click()
  await page.getByPlaceholder('Description').nth(1).fill('Second fractional service')
  await page.getByPlaceholder('Qty').nth(1).fill('1.5')
  await page.getByPlaceholder('Unit price').nth(1).fill('0.01')
  await expect(page.locator('.estimate-total strong')).toHaveText('$0.04')
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'INV-1001' })).toBeVisible()
  await expect(page.locator('.invoice-document')).toContainText('$0.04')
  await expect(page.locator('.invoice-document')).toContainText('First fractional service')
  await expect(page.locator('.invoice-document')).toContainText('Second fractional service')
  const writes = state.requests.filter(x => x.path.endsWith('/rpc/create_document'))
  expect(writes).toHaveLength(1)
  expect(writes[0].body.payload.items).toHaveLength(2)
  expect(writes[0].body.payload.items.every(x => x.quantity === 1.5 && x.unit_price === 0.01)).toBe(true)
})
