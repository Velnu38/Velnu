import { test, expect } from '@playwright/test'

// Mock-only integration tests. No production login, email, billing, or database writes.
// The existing Playwright config supplies the fake Supabase URL.
const BID = '11111111-1111-4111-8111-111111111111'
const UID = '33333333-3333-4333-8333-333333333333'
const CID = '44444444-4444-4444-8444-444444444444'
const AID = '55555555-5555-4555-8555-555555555555'
const user = { id: UID, email: 'qa-owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const customer = { id: CID, first_name: 'Jane', last_name: 'Doe', company: null }
const business = { id: BID, name: 'Velnu QA', legal_name: null, role: 'owner', profile_completed_at: '2026-10-01T00:00:00Z', document_accent: '#2563eb', logo_path: null }
const id = n => '88888888-8888-4888-8888-' + String(n).padStart(12, '0')
const todayISO = () => new Date().toISOString().slice(0, 10)
const localDatetime = (offsetDays = 1, hours = 10, minutes = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hours, minutes, 0, 0)
  const two = x => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes())
}
const appointment = (n = 1) => ({
  id: id(n), title: 'Visit ' + n,
  starts_at: new Date(Date.now() + 86400000).toISOString(),
  ends_at: null, status: 'scheduled', customer_id: CID,
  customers: customer, jobs: null,
})
const reminder = (n = 1) => ({
  id: id(n), kind: 'invoice_follow_up', due_at: new Date(Date.now() - 3600000).toISOString(),
  note: 'Call customer ' + n, status: 'pending', invoice_id: null, estimate_id: null,
  job_id: null, customer_id: CID,
})

async function mockWorkspace(page, options = {}) {
  const sessionHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const sessionBody = Buffer.from(JSON.stringify({ sub: UID, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const session = { access_token: sessionHeader + '.' + sessionBody + '.test', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }
  await page.addInitScript(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session)

  const state = {
    role: options.role || 'owner',
    customers: options.customers || [customer],
    appointments: [...(options.appointments || [])],
    reminders: [...(options.reminders || [])],
    invoices: [...(options.invoices || [])],
    estimates: [...(options.estimates || [])],
    changeOrders: [...(options.changeOrders || [])],
    requests: [],
    savedJobs: new Map(),
    aggregate: options.aggregate ?? { open_invoices: 0, outstanding_balance: 0 },
    aggregateFailures: options.aggregateFailures || 0,
    aggregateDelay: options.aggregateDelay || 0,
    jobError: options.jobError || false,
    appointmentError: options.appointmentError || false,
    reminderError: options.reminderError || false,
    appointmentPatchError: options.appointmentPatchError || false,
  }
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    let body
    try { body = req.postDataJSON() } catch { body = null }
    state.requests.push({ path, method, url: url.toString(), body })
    const reply = (value, status = 200, total = 0) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': total ? `0-${Math.min(10, total) - 1}/${total}` : '0-0/0' },
      body: JSON.stringify(value),
    })
    const fail = message => reply({ message, code: 'PGRST_TEST', details: '', hint: '' }, 400)
    if (method === 'OPTIONS') return route.fulfill({
      status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' }, body: '',
    })
    if (path.endsWith('/auth/v1/user')) return reply(user)
    if (path.endsWith('/user_plan_preferences')) return reply({ user_id: UID, selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return reply({ id: id(91), agreement_version: '2026-10-26-v2' })
    if (path.endsWith('/business_members')) return reply({ role: state.role, business_id: BID, businesses: business })
    if (path.endsWith('/rpc/get_plan_usage')) return reply({ plan: 'free', ai_limit: 0, voice_limit: 0, logo_bytes_limit: 0 })
    if (path.endsWith('/rpc/create_scheduled_job')) {
      if (state.jobError) return fail('Unable to create job')
      if (state.appointmentError) return fail('Unable to create appointment')
      const previous = state.savedJobs.get(body.request_id)
      if (previous) return reply(previous)
      const row = {
        id: id(80), appointment_id: id(81), business_id: body.target_business_id,
        customer_id: body.payload.customer_id, property_id: body.payload.property_id,
        title: body.payload.title, status: 'scheduled',
        scheduled_start: body.payload.scheduled_start, scheduled_end: body.payload.scheduled_end,
      }
      state.savedJobs.set(body.request_id, row)
      state.appointments.push({
        id: row.appointment_id, job_id: row.id, business_id: row.business_id,
        customer_id: row.customer_id, title: row.title, status: 'scheduled',
        starts_at: row.scheduled_start, ends_at: row.scheduled_end,
        customers: customer, jobs: null,
      })
      return reply(row)
    }
    if (path.endsWith('/rpc/get_dashboard_invoice_totals')) {
      if (state.aggregateDelay) await new Promise(resolve => setTimeout(resolve, state.aggregateDelay))
      if (state.aggregateFailures-- > 0) return fail('Dashboard summary temporarily unavailable')
      return reply(state.aggregate)
    }
    if (path.endsWith('/customers')) return reply(state.customers)
    if (path.endsWith('/properties')) return reply([])
    if (path.endsWith('/jobs')) {
      if (method === 'POST') {
        if (state.jobError) return fail('Unable to create job')
        return reply({ id: id(80), ...body }, 201)
      }
      if (method === 'DELETE') return reply([])
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: '' })
      return reply([])
    }
    if (path.endsWith('/appointments')) {
      if (method === 'POST') {
        if (state.appointmentError) return fail('Unable to create appointment')
        state.appointments.push({ id: id(81), ...body, customers: customer, jobs: null })
        return reply([], 201)
      }
      if (method === 'PATCH') {
        if (state.appointmentPatchError) return fail('Unable to update schedule')
        const target = url.searchParams.get('id')?.replace('eq.', '')
        const row = state.appointments.find(a => a.id === target)
        if (row) Object.assign(row, body)
        return reply([])
      }
      return reply(state.appointments.filter(a => a.status !== 'canceled'))
    }
    if (path.endsWith('/reminders')) {
      if (method === 'PATCH') {
        if (state.reminderError) return fail('Unable to complete reminder')
        const target = url.searchParams.get('id')?.replace('eq.', '')
        const row = state.reminders.find(r => r.id === target)
        if (row) Object.assign(row, body)
        return reply([])
      }
      return reply(state.reminders.filter(r => r.status === 'pending'))
    }
    if (path.endsWith('/invoices')) return reply(state.invoices.slice(0, 10), 200, state.invoices.length)
    if (path.endsWith('/estimates')) return reply(state.estimates.slice(0, 10))
    if (path.endsWith('/change_orders')) return reply(state.changeOrders.slice(0, 10))
    if (path.endsWith('/messages') || path.endsWith('/bookkeeping_entries')) return reply([])
    return reply([])
  })
  return state
}
const count = (s, suffix, method) => s.requests.filter(r => r.path.endsWith(suffix) && (!method || r.method === method)).length
const openDashboard = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your office is caught up|need your attention/ })).toBeVisible()
  return state
}
const openSchedule = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/')
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  return state
}
const showForm = async page => {
  await page.getByRole('button', { name: '+ Schedule work' }).click()
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toBeVisible()
}
const completeForm = async (page, start = localDatetime(), end = localDatetime(1, 11)) => {
  await showForm(page)
  await page.locator('.modal form select').first().selectOption(CID)
  await page.getByLabel('Job title', { exact: true }).fill('Replace faucet')
  await page.getByLabel('Starts').fill(start)
  if (end) await page.getByLabel('Ends').fill(end)
}
const noRuntimeErrors = page => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return errors
}

// DASHBOARD: 12 critical cases

test('01 empty dashboard renders without uncaught exceptions', async ({ page }) => {
  const errors = noRuntimeErrors(page)
  await openDashboard(page)
  await expect(page.getByText('No overdue balances need attention.')).toBeVisible()
  await expect(page.locator('.metric-grid')).toContainText('$0')
  expect(errors).toEqual([])
})

test('02 Strict Mode concurrent initial loads share one invoice summary call', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 1, outstanding_balance: 30 } })
  await expect(page.locator('.metric-grid')).toContainText('$30')
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBe(1)
})

test('03 null aggregate values display zero safely', async ({ page }) => {
  await openDashboard(page, { aggregate: { open_invoices: null, outstanding_balance: null } })
  await expect(page.locator('.metric-grid')).toContainText('$0')
  await expect(page.locator('.metric-grid')).toContainText('0 unpaid invoices')
})

test('04 large financial summary stays server-side without an unbounded invoice scan', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 12001, outstanding_balance: '123456789.22' } })
  await expect(page.locator('.metric-grid')).toContainText('$123,456,789')
  await expect(page.locator('.metric-grid')).toContainText('12001 unpaid invoices')
  expect(state.requests.filter(r => r.path.endsWith('/invoices') && new URL(r.url).searchParams.get('select') === 'balance_due')).toHaveLength(0)
})

test('05 failed invoice-summary RPC displays recoverable error instead of crashing', async ({ page }) => {
  const state = await openDashboard(page, { aggregateFailures: 20 })
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toBeVisible().catch(async err => {
    console.log('Dashboard error diagnostic', JSON.stringify({
      requests: state?.requests?.filter?.(r => r.path.includes('dashboard_invoice_totals')),
      alerts: await page.locator('.form-message').allTextContents(),
      text: (await page.locator('.page-stack').first().innerText()).slice(0, 700),
    }))
    throw err
  })
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

test('06 dashboard manual refresh recovers after failed RPC', async ({ page }) => {
  const state = await openDashboard(page, { aggregateFailures: 20, aggregate: { open_invoices: 2, outstanding_balance: 42 } })
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toBeVisible()
  state.aggregateFailures = 0
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('.metric-grid')).toContainText('$42')
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toHaveCount(0)
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBeGreaterThanOrEqual(2)
})

test('07 navigation during a slow dashboard load does not resurrect the old screen', async ({ page }) => {
  const errors = noRuntimeErrors(page)
  await mockWorkspace(page, { aggregateDelay: 850 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  await page.waitForTimeout(950)
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('08 absent customer relations and injected invoice HTML do not crash or render executable markup', async ({ page }) => {
  const malicious = '<img src=x onerror=alert(1)>'
  await openDashboard(page, { invoices: [{ id: id(9), invoice_number: malicious, balance_due: 15, due_date: '2020-01-01', customers: null }] })
  await expect(page.getByRole('region', { name: 'Overdue invoices' })).toContainText('Customer')
  await expect(page.getByRole('region', { name: 'Overdue invoices' })).toContainText(malicious)
  expect(await page.getByRole('region', { name: 'Overdue invoices' }).locator('img').count()).toBe(0)
})

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`invoice tile counts all overdue invoices and keeps details together at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const invoices = Array.from({ length: 14 }, (_, n) => ({
      id: id(n + 300), invoice_number: `INV-${n + 1}`, balance_due: 15,
      due_date: '2020-01-01', issue_date: '2019-12-01', status: 'sent', total: 15, customers: customer,
    }))
    const state = await openDashboard(page, { invoices })
    const tile = page.getByRole('article', { name: 'Invoices overview' })
    await expect(tile.getByText('14 overdue', { exact: true })).toBeVisible()
    await expect(tile.getByRole('region', { name: 'Overdue invoices' }).getByRole('listitem')).toHaveCount(10)
    await expect(tile).toContainText('INV-1 · Jane Doe')
    await expect(tile).toContainText('$15.00')
    await expect(tile).toContainText('Showing the 10 oldest')
    await expect(page.locator('.overdue-panel')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    state.invoices = []
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(tile.getByText('No overdue balances need attention.')).toBeVisible()
    await expect(tile.locator('.invoice-overdue-badge')).toHaveCount(0)
    await tile.getByRole('button', { name: 'Invoices', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Know what’s owed and get paid faster.' })).toBeVisible()
  })
}

test('09 completing reminder persists its status and removes it from attention list', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Call customer 1')).toHaveCount(0)
  expect(count(state, '/reminders', 'PATCH')).toBe(1)
  expect(state.reminders[0].status).toBe('completed')
})

test('10 failing reminder update displays error and does not hide the reminder', async ({ page }) => {
  await openDashboard(page, { reminders: [reminder()], reminderError: true })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Unable to complete reminder')).toBeVisible()
  await expect(page.getByText('Call customer 1')).toBeVisible()
})

test('11 viewer cannot complete reminders', async ({ page }) => {
  const state = await openDashboard(page, { role: 'viewer', reminders: [reminder()] })
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0)
  expect(count(state, '/reminders', 'PATCH')).toBe(0)
})

test('12 dashboard tenant filters and bounded approval lists are preserved', async ({ page }) => {
  const estimates = Array.from({ length: 10 }, (_, n) => ({
    id: id(n + 100), estimate_number: 'EST-' + n, status: 'sent', total: 25,
    issue_date: '2026-10-01', customers: customer,
  }))
  const changeOrders = Array.from({ length: 10 }, (_, n) => ({
    id: id(n + 200), change_order_number: 'CO-' + n, title: 'Change ' + n,
    status: 'sent', total: 50, issue_date: '2026-10-02', customers: customer,
  }))
  const state = await openDashboard(page, { estimates, changeOrders })
  await expect(page.locator('.office-panel').filter({ hasText: 'Approvals' }).locator('.office-list-row')).toHaveCount(12)
  for (const request of state.requests.filter(r =>
    ['/invoices', '/jobs', '/reminders', '/appointments', '/estimates', '/change_orders'].some(p => r.path.endsWith(p)))) {
    expect(new URL(request.url).searchParams.get('business_id'), request.url).toBe('eq.' + BID)
  }
  expect(state.requests.filter(r => ['/estimates', '/change_orders', '/reminders'].some(p => r.path.endsWith(p)) && new URL(r.url).searchParams.get('limit') === null)).toEqual([])
})

// SCHEDULE: 13 critical cases

test('13 empty schedule shows its empty state', async ({ page }) => {
  await openSchedule(page)
  await expect(page.getByText('Nothing scheduled')).toBeVisible()
})

test('14 viewers cannot schedule work or update an existing appointment', async ({ page }) => {
  const state = await openSchedule(page, { role: 'viewer', appointments: [appointment()] })
  await expect(page.getByRole('button', { name: '+ Schedule work' })).toHaveCount(0)
  await expect(page.locator('.appointment-row select')).toBeDisabled()
  expect(count(state, '/appointments', 'PATCH')).toBe(0)
})

test('15 missing customer blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.getByLabel('Job title', { exact: true }).fill('No customer')
  await page.getByLabel('Starts').fill(localDatetime())
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.locator('.modal form select').first()).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
})

test('16 blank title blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.locator('.modal form select').first().selectOption(CID)
  await page.getByLabel('Starts').fill(localDatetime())
  await page.getByRole('button', { name: 'Schedule job' }).click()
  expect(count(state, '/jobs', 'POST')).toBe(0)
  await expect(page.getByLabel('Job title', { exact: true })).toBeVisible()
})

test('17 missing start time blocks job creation', async ({ page }) => {
  const state = await openSchedule(page)
  await showForm(page)
  await page.locator('.modal form select').first().selectOption(CID)
  await page.getByLabel('Job title', { exact: true }).fill('No time')
  await page.getByRole('button', { name: 'Schedule job' }).click()
  expect(count(state, '/jobs', 'POST')).toBe(0)
})

test('18 end time before start is rejected without a database write', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(1, 11), localDatetime(1, 10))
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('End time must be after the start time')).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
})

test('19 zero-minute appointment is rejected at the equality boundary', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(1, 11), localDatetime(1, 11))
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('End time must be after the start time')).toBeVisible()
  expect(count(state, '/jobs', 'POST')).toBe(0)
})

test('20 valid schedule submits local date values as UTC and does not duplicate job creation', async ({ page }) => {
  const state = await openSchedule(page)
  const start = localDatetime(1, 10)
  const end = localDatetime(1, 11)
  await completeForm(page, start, end)
  // Force both DOM events before React can paint the disabled state.
  await page.getByRole('button', { name: 'Schedule job' }).evaluate(button => {
    button.click()
    button.click()
  })
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toHaveCount(0)
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  const request = state.requests.find(r => r.path.endsWith('/rpc/create_scheduled_job'))
  expect(request.body.payload.scheduled_start).toBe(new Date(start).toISOString())
  expect(request.body.payload.scheduled_end).toBe(new Date(end).toISOString())
  expect(state.savedJobs.size).toBe(1)
  expect(state.appointments).toHaveLength(1)
  expect(count(state, '/appointments', 'POST')).toBe(0)
})

test('21 optional end date produces a null scheduled end', async ({ page }) => {
  const state = await openSchedule(page)
  await completeForm(page, localDatetime(), null)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByRole('heading', { name: 'Add a job to the calendar' })).toHaveCount(0)
  expect(state.requests.find(r => r.path.endsWith('/rpc/create_scheduled_job')).body.payload.scheduled_end).toBeNull()
})

test('22 failed job insert preserves the form and displays a recoverable error', async ({ page }) => {
  const state = await openSchedule(page, { jobError: true })
  await completeForm(page)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('Unable to create job')).toBeVisible()
  await expect(page.getByLabel('Job title', { exact: true })).toHaveValue('Replace faucet')
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  expect(state.savedJobs.size).toBe(0)
  expect(state.appointments).toHaveLength(0)
})

test('23 failed appointment insert rolls back the whole scheduled-job transaction', async ({ page }) => {
  const state = await openSchedule(page, { appointmentError: true })
  await completeForm(page)
  await page.getByRole('button', { name: 'Schedule job' }).click()
  await expect(page.getByText('Unable to create appointment')).toBeVisible()
  expect(count(state, '/rpc/create_scheduled_job', 'POST')).toBe(1)
  expect(state.savedJobs.size).toBe(0)
  expect(state.appointments).toHaveLength(0)
  expect(count(state, '/jobs', 'DELETE')).toBe(0)
})

test('24 successful status change updates the appointment exactly once', async ({ page }) => {
  const state = await openSchedule(page, { appointments: [appointment()] })
  await page.locator('.appointment-row select').selectOption('confirmed')
  await expect.poll(() => state.appointments[0].status).toBe('confirmed')
  expect(count(state, '/appointments', 'PATCH')).toBe(1)
})

test('25 failed status change reports an error and leaves stored status unchanged', async ({ page }) => {
  const state = await openSchedule(page, { appointments: [appointment()], appointmentPatchError: true })
  await page.locator('.appointment-row select').selectOption('completed')
  await expect(page.getByText('Unable to update schedule')).toBeVisible()
  expect(state.appointments[0].status).toBe('scheduled')
})
