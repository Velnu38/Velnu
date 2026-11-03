import { test, expect } from '@playwright/test'
import { DateTime } from 'luxon'

// Mock-only integration tests. No production login, email, billing, or database writes.
// The existing Playwright config supplies the fake Supabase URL.
const BID = '11111111-1111-4111-8111-111111111111'
const UID = '33333333-3333-4333-8333-333333333333'
const CID = '44444444-4444-4444-8444-444444444444'
const AID = '55555555-5555-4555-8555-555555555555'
const user = { id: UID, email: 'qa-owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const customer = { id: CID, first_name: 'Jane', last_name: 'Doe', company: null }
const business = { id: BID, name: 'Velnu QA', created_by_user_id: UID, legal_name: null, role: 'owner', profile_completed_at: '2026-10-01T00:00:00Z', document_accent: '#2563eb', logo_path: null }
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
    jobs: options.jobs || [],
    appointments: [...(options.appointments || [])],
    reminders: [...(options.reminders || [])],
    invoices: [...(options.invoices || [])],
    estimates: [...(options.estimates || [])],
    changeOrders: [...(options.changeOrders || [])],
    requests: [],
    photos: [], expenses: [], storageWrites: 0,
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
    const reply = (value, status = 200, total = Array.isArray(value) ? value.length : 0) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': total ? `0-${Math.min(10, total) - 1}/${total}` : '0-0/0' },
      body: JSON.stringify(value),
    })
    const fail = message => reply({ message, code: 'PGRST_TEST', details: '', hint: '' }, 400)
    if (method === 'OPTIONS') return route.fulfill({
      status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' }, body: '',
    })
    if (path.endsWith('/auth/v1/user')) return reply(user)
    if (path.endsWith('/rpc/get_membership_entry')) return reply(BID)
    if (path.endsWith('/rpc/get_schedule_team')) return reply(state.role==='viewer'?[]:[{id:UID,label:'QA Owner',role:state.role,is_you:true}])
    if (path.endsWith('/rpc/get_workflow_next_actions')) return reply({approved:[],completed:[]})
    if (path.endsWith('/business_settings')) return reply({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})
    if (path.endsWith('/user_plan_preferences')) return reply({ user_id: UID, selected_tier: 'free' })
    if (path.endsWith('/user_agreement_acceptances')) return reply({ id: id(91), agreement_version: '2026-10-26-v2' })
    if (path.endsWith('/business_members')) return reply({ role: state.role, access_modules: options.accessModules || ['calendar','jobs','billing','finances'], business_id: BID, businesses: business })
    if (path.endsWith('/rpc/get_plan_usage')) return reply({ plan: 'free', ai_limit: 0, voice_limit: 0, logo_bytes_limit: 0 })
    if (path.endsWith('/rpc/create_scheduled_job') || path.endsWith('/rpc/create_dispatched_job')) {
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
      if (req.headers().accept?.includes('vnd.pgrst.object')) return reply(state.jobs.find(job => job.id === url.searchParams.get('id')?.replace('eq.','')))
      if (method === 'POST') {
        if (state.jobError) return fail('Unable to create job')
        return reply({ id: id(80), ...body }, 201)
      }
      if (method === 'DELETE') return reply([])
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: '' })
      if (url.searchParams.has('status')) {
        const active = state.jobs.filter(job => ['lead','scheduled','in_progress'].includes(job.status))
        return reply(active.slice(0,Number(url.searchParams.get('limit') || active.length)), 200, active.length)
      }
      return reply(state.jobs.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||state.jobs.length)),200,state.jobs.length)
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
      if (method === 'POST') {
        state.reminders.push({ ...body, jobs: state.jobs.find(job => job.id === body.job_id) || null })
        return reply({ id: body.id }, 201)
      }
      if (method === 'PATCH') {
        if (state.reminderError) return fail('Unable to complete reminder')
        const target = url.searchParams.get('id')?.replace('eq.', '')
        const row = state.reminders.find(r => r.id === target)
        if (row) Object.assign(row, body)
        return reply({ id: row?.id })
      }
      const status = url.searchParams.get('status')?.replace('eq.', '')
      const due = url.searchParams.get('due_at')
      const matching = state.reminders.filter(r => r.status === status && (!due || (due.startsWith('lt.') ? Date.parse(r.due_at) < Date.parse(due.slice(3)) : Date.parse(r.due_at) <= Date.parse(due.slice(4)))))
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 50)
      return reply(matching.slice(offset, offset + limit), 200, matching.length)
    }
    if (path.endsWith('/record_photos')) {
      if (method === 'POST') { state.photos.push({ ...body, created_by: UID, storage_path: `${BID}/${body.id}.jpg`, created_at: new Date().toISOString() }); return reply(null, 201) }
      if (method === 'DELETE') { const target = url.searchParams.get('id')?.replace('eq.', ''); const deleted = state.photos.filter(p => p.id === target); state.photos = state.photos.filter(p => p.id !== target); return reply(deleted) }
      const column = ['job_id', 'estimate_id', 'invoice_id'].find(key => url.searchParams.has(key))
      const matching = column ? state.photos.filter(p => p[column] === url.searchParams.get(column).replace('eq.', '')) : state.photos
      return reply(matching, 200, matching.length)
    }
    if (path.includes('/storage/v1/object/sign/') && method === 'POST') return reply(body.paths.map(path => ({ path, signedURL: `/object/sign/finviant-record-photos/${path}?token=test`, error: null })))
    if (path.includes('/storage/v1/object/sign/') && method === 'GET') return route.fulfill({contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNkaGhgwAaYsIoOWgkAzIgBEFCQDcoAAAAASUVORK5CYII=', 'base64')})
    if (path.includes('/storage/v1/object/finviant-record-photos')) {
      if (method === 'POST') { state.storageWrites++; return reply({ Key: path.split('/object/')[1], Id: id(999) }, 200) }
      return reply([])
    }
    if (path.endsWith('/bookkeeping_entries')) {
      if (method === 'POST') { state.expenses.push(body); return reply(null, 201) }
      if (method === 'DELETE') { state.expenses = state.expenses.filter(p => p.id !== url.searchParams.get('id')?.replace('eq.', '')); return reply([]) }
      const column = ['job_id', 'estimate_id', 'invoice_id'].find(key => url.searchParams.has(key))
      const matching = column ? state.expenses.filter(p => p[column] === url.searchParams.get(column).replace('eq.', '')) : state.expenses
      return reply(matching, 200, matching.length)
    }
    if ((path.endsWith('/invoices') || path.endsWith('/estimates')) && url.searchParams.get('limit') === '5') {
      const rows = path.endsWith('/invoices') ? state.invoices : state.estimates
      return reply([...rows].map(row => ({ ...row, total: row.total ?? row.balance_due ?? 0, created_at: row.created_at || `${row.issue_date || '2026-11-01'}T12:00:00Z` }))
        .sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,5))
    }
    if (path.endsWith('/invoices')) {
      if (req.headers().accept?.includes('vnd.pgrst.object')) return reply(state.invoices.find(i => i.id === url.searchParams.get('id')?.replace('eq.', '')))
      const matches = url.searchParams.has('due_date') ? state.invoices.filter(i => i.due_date < url.searchParams.get('due_date').replace('lt.', '') && Number(i.balance_due) > 0 && !['draft','void'].includes(i.status)) : state.invoices
      return reply(matches.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 10)), 200, matches.length)
    }
    if (path.endsWith('/estimates')) {
      const matches = url.searchParams.has('status') ? state.estimates.filter(e => e.status === url.searchParams.get('status').replace('eq.', '')) : state.estimates
      return reply(matches.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 10)), 200, matches.length)
    }
    if (path.endsWith('/change_orders')) return reply(state.changeOrders.slice(0, 10), 200, state.changeOrders.length)
    if (path.endsWith('/messages')) return reply([])
    return reply([])
  })
  return state
}
const count = (s, suffix, method) => s.requests.filter(r => r.path.endsWith(suffix) && (!method || r.method === method)).length
const openDashboard = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your office is caught up|needs? your attention|Your day, organized/ })).toBeVisible()
  return state
}
const openSchedule = async (page, options) => {
  const state = await mockWorkspace(page, options)
  await page.goto('/')
  await page.goto('/?view=schedule')
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
  await expect(page.getByText('No overdue invoices or pending approvals.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('02 Strict Mode concurrent initial loads share one invoice summary call', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 1, outstanding_balance: 30 } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBe(1)
})

test('03 null aggregate values display zero safely', async ({ page }) => {
  await openDashboard(page, { aggregate: { open_invoices: null, outstanding_balance: null } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await expect(page.locator('.dashboard-work-grid')).not.toContainText('NaN')
})

test('04 large financial summary stays server-side without an unbounded invoice scan', async ({ page }) => {
  const state = await openDashboard(page, { aggregate: { open_invoices: 12001, outstanding_balance: '123456789.22' } })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBe(1)
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
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await expect(page.getByText('Dashboard summary temporarily unavailable')).toHaveCount(0)
  expect(count(state, '/rpc/get_dashboard_invoice_totals', 'POST')).toBeGreaterThanOrEqual(2)
})

test('07 navigation during a slow dashboard load does not resurrect the old screen', async ({ page }) => {
  const errors = noRuntimeErrors(page)
  await mockWorkspace(page, { aggregateDelay: 850 })
  await page.goto('/')
  await page.goto('/?view=schedule')
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  await page.waitForTimeout(950)
  await expect(page.getByRole('heading', { name: 'Know where you need to be next.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('08 absent customer relations and injected invoice HTML do not crash or render executable markup', async ({ page }) => {
  const malicious = '<img src=x onerror=alert(1)>'
  await openDashboard(page, { invoices: [{ id: id(9), invoice_number: malicious, balance_due: 15, due_date: '2020-01-01', customers: null }] })
  await expect(page.getByRole('region', { name: 'Needs Attention' })).toContainText('Customer')
  await expect(page.getByRole('region', { name: 'Needs Attention' })).toContainText(malicious)
  expect(await page.getByRole('region', { name: 'Needs Attention' }).locator('img').count()).toBe(0)
})

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`billing hub counts all overdue invoices and keeps details together at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const invoices = Array.from({ length: 14 }, (_, n) => ({
      id: id(n + 300), invoice_number: `INV-${n + 1}`, balance_due: 15,
      due_date: '2020-01-01', issue_date: '2019-12-01', status: 'sent', total: 15, customers: customer,
    }))
    const state = await openDashboard(page, { invoices })
    const tile = page.getByRole('article', { name: 'Estimates and invoices overview' })
    await tile.getByRole('button', { name: /Needs Attention 14 Review next steps/ }).click()
    await expect(tile.getByRole('region', { name: 'Needs Attention' }).getByRole('listitem')).toHaveCount(5)
    await expect(tile).toContainText('Jane Doe')
    await expect(tile).toContainText('INV-1')
    await expect(tile).toContainText('$15.00')
    await expect(tile).toContainText('Showing 5 of 14 items needing attention')
    await expect(page.locator('.overdue-panel')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    state.invoices = []
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(tile.getByText('No overdue invoices or pending approvals.')).toBeVisible()
    await expect(tile.locator('.invoice-overdue-badge')).toHaveCount(0)
    await tile.getByRole('button', { name: /^Invoices/ }).click()
    await expect(page.getByRole('heading', { name: 'Know what’s owed and get paid faster.' })).toBeVisible()
  })
}

test('09 completing reminder persists its status and removes it from attention list', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await page.getByRole('region', { name: 'Work calendar' }).getByRole('button', { name: '+ Reminder', exact: true }).click()
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await page.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText('Call customer 1')).toHaveCount(0)
  expect(count(state, '/reminders', 'PATCH')).toBe(1)
  expect(state.reminders[0].status).toBe('completed')
})

test('dashboard attention updates immediately when a calendar reminder is completed', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 item needs your attention.')
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  await page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('button', { name: 'Complete Call customer 1', exact: true }).click()
  await expect(calendar.getByText('Call customer 1', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your office is caught up.')
  expect(count(state, '/reminders', 'PATCH')).toBe(1)
})

test('a failed calendar reminder update keeps the attention count and retry action', async ({ page }) => {
  await openDashboard(page, { reminders: [reminder()], reminderError: true })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 item needs your attention.')
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  await page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('button', { name: 'Complete Call customer 1', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true }).getByRole('alert')).toContainText('Unable to complete this reminder')
  await expect(page.getByRole('region', { name: 'Needs Attention', exact: true }).getByText('Call customer 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 item needs your attention.')
})

test('returning to the dashboard refreshes attention after another worker resolves a reminder', async ({ page }) => {
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 item needs your attention.')
  state.reminders[0].status = 'completed'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your office is caught up.')
  await expect(page.getByRole('region', { name: 'Work calendar' }).getByText('Call customer 1', { exact: true })).toHaveCount(0)
})

test('the visible dashboard refreshes attention in the background without a reload', async ({ page }) => {
  await page.clock.install()
  const state = await openDashboard(page, { reminders: [reminder()] })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 item needs your attention.')
  state.reminders[0].status = 'completed'
  await page.clock.fastForward('00:31')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your office is caught up.')
})

test('10 failing reminder update displays error and does not hide the reminder', async ({ page }) => {
  await openDashboard(page, { reminders: [reminder()], reminderError: true })
  await page.getByRole('region', { name: 'Work calendar' }).getByRole('button', { name: '+ Reminder', exact: true }).click()
  await page.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText('Unable to complete reminder')).toBeVisible()
  await expect(page.getByText('Call customer 1')).toBeVisible()
})

test('11 viewer cannot complete reminders', async ({ page }) => {
  const state = await openDashboard(page, { role: 'viewer', reminders: [reminder()] })
  await page.getByRole('region', { name: 'Work calendar' }).getByRole('button', { name: '+ Reminder', exact: true }).click()
  await expect(page.getByText('Call customer 1')).toBeVisible()
  await expect(page.getByRole('button', { name: /Mark .* done/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ New reminder' })).toHaveCount(0)
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
  const tile = page.getByRole('article', { name: 'Estimates and invoices overview' })
  await tile.getByRole('button', { name: /Awaiting approval 20/ }).click()
  await expect(tile.getByRole('region', { name: 'Customer approvals' }).getByRole('listitem')).toHaveCount(5)
  await expect(tile).toContainText('EST-0')
  await expect(tile).toContainText('Jane Doe')
  await expect(tile).toContainText('Showing 5 of 20 pending approvals')
  await expect(page.getByRole('heading', { name: 'Approvals', exact: true })).toHaveCount(0)
  for (const request of state.requests.filter(r =>
    ['/invoices', '/jobs', '/reminders', '/appointments', '/estimates', '/change_orders'].some(p => r.path.endsWith(p)))) {
    expect(new URL(request.url).searchParams.get('business_id'), request.url).toBe('eq.' + BID)
  }
  expect(state.requests.filter(r => ['/estimates', '/change_orders', '/reminders'].some(p => r.path.endsWith(p)) && new URL(r.url).searchParams.get('limit') === null)).toEqual([])
  state.estimates = []
  state.changeOrders = []
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(tile).toContainText('No estimates or change orders are waiting for approval.')
  await expect(tile.locator('.estimate-approval-badge')).toHaveCount(0)
  await tile.getByRole('button', { name: /^Estimates/ }).click()
  await expect(page.getByRole('heading', { name: 'Quote the work without the paperwork.' })).toBeVisible()
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

test('jobs workspace separates current, upcoming, and historical jobs', async ({ page }) => {
  const jobs = [
    { id: id(501), title: 'Current repair', status: 'in_progress', scheduled_start: localDatetime(-1) },
    { id: id(502), title: 'Future repair', status: 'scheduled', scheduled_start: localDatetime(2) },
    { id: id(503), title: 'Completed repair', status: 'completed', scheduled_start: localDatetime(-2) },
  ].map(job => ({ ...job, customer_id: CID, customers: customer }))
  await openSchedule(page, { jobs, appointments: [appointment()] })
  await expect(page.locator('.appointment-row')).toContainText('Visit 1')
  await page.goto('/?view=work')
  await expect(page.getByRole('region', { name: 'current jobs' })).toContainText('Current repair')
  await expect(page.getByRole('region', { name: 'current jobs' })).not.toContainText('Future repair')
  await page.getByRole('button', { name: /Upcoming/ }).click()
  await expect(page.getByRole('region', { name: 'upcoming jobs' })).toContainText('Future repair')
  await page.getByRole('button', { name: /History/ }).click()
  await expect(page.getByRole('region', { name: 'history jobs' })).toContainText('Completed repair')
  await page.goto('/?view=schedule')
  await expect(page.locator('.appointment-row')).toContainText('Visit 1')
})

for (const width of [1280, 390]) test(`standalone reminder creation is accessible from the merged tile at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await openDashboard(page, { reminders: Array.from({ length: 18 }, (_, n) => reminder(n)) })
  await expect(page.locator('.dashboard-work-grid > article')).toHaveCount(2)
  const tile = page.getByRole('region', { name: 'Work calendar' })
  await expect(page.getByRole('heading', { name: 'Reminders due', exact: true })).toHaveCount(0)
  await tile.getByRole('button', { name: '+ Reminder', exact: true }).click()
  await page.getByRole('button', { name: '+ New reminder' }).click()
  await page.getByLabel('What needs to be done?').fill('Order replacement parts')
  await page.getByLabel('Remind me on').fill(localDatetime(2))
  await page.getByRole('button', { name: 'Save reminder' }).evaluate(button => { button.click(); button.click() })
  await expect(page.getByRole('status').filter({ hasText: 'Reminder created.' })).toBeVisible()
  expect(count(state, '/reminders', 'POST')).toBe(1)
  expect(state.reminders.at(-1).job_id).toBeNull()
  expect(state.reminders.at(-1).business_id).toBe(BID)
  await expect(page.getByRole('region', { name: 'Pending reminders' })).toContainText('Order replacement parts')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('calendar reminders can be linked to a job', async ({ page }) => {
  const job = { id: id(511), title: 'Kitchen repair', status: 'in_progress', scheduled_start: null, customer_id: CID, customers: customer }
  const state = await openSchedule(page, { jobs: [job] })
  await page.goto('/?view=reminders')
  await page.getByRole('button', { name: '+ New reminder' }).click()
  await page.getByLabel('Related job (optional)').selectOption(job.id)
  await expect(page.getByLabel('Related job (optional)')).toHaveValue(job.id)
  await expect(page.getByLabel('Related job (optional)')).toBeEnabled()
  await page.getByLabel('What needs to be done?').fill('Confirm customer access')
  await page.getByLabel('Remind me on').fill(localDatetime(1))
  await page.getByRole('button', { name: 'Save reminder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reminder created.' })).toBeVisible()
  expect(state.reminders[0].job_id).toBe(job.id)
  expect(state.reminders[0].customer_id).toBe(CID)
})

test('calendar dashboard shows daily work, overdue reminders, completion, and another date', async ({ page }) => {
  await mockWorkspace(page)
  let completed = false
  await page.route('**/rest/v1/calendar_work?**', route => route.fulfill({ contentType: 'application/json', headers:{'access-control-expose-headers':'content-range','content-range':'0-0/1'}, body: JSON.stringify([{source_key:'job:qa',title:'Roof inspection',description:'',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),status:'scheduled',document_kind:'work',document_id:id(1)}]) }))
  await page.route('**/rest/v1/reminders?**', route => {
    if (route.request().method() === 'PATCH') { completed = true; return route.fulfill({contentType:'application/json',body:JSON.stringify({id:id(2)})}) }
    return route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':completed?'*/0':'0-0/1'},body:JSON.stringify(completed?[]:[{id:id(2),note:'Confirm materials',due_at:new Date(Date.now()-3600000).toISOString(),job_id:null}])})
  })
  await page.goto('/')
  const calendar = page.getByRole('region', {name:'Work calendar'})
  await expect(calendar.getByRole('heading',{name:'Weekly schedule'})).toBeVisible()
  await expect(calendar.getByRole('link',{name:'Roof inspection'})).toBeVisible()
  await expect(page.getByRole('region',{name:'Needs Attention',exact:true}).getByText('Confirm materials',{exact:true})).toBeVisible()
  await page.getByRole('region',{name:'Needs Attention',exact:true}).getByRole('button',{name:'Complete Confirm materials'}).click()
  await expect(page.getByRole('region',{name:'Needs Attention',exact:true}).getByText('Confirm materials',{exact:true})).toHaveCount(0)
  await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
  await calendar.getByRole('button',{name:'Next week'}).click()
  await expect(calendar.getByRole('heading',{name:'Weekly schedule'})).toBeVisible()
})

test('calendar settings shows connected identity, calendar choices and persists toggle', async ({ page }) => {
  await mockWorkspace(page)
  let saved
  await page.route('**/api/calendar?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (route.request().method()==='PATCH') {saved=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:'{"ok":true}'})}
    const result=action==='calendars'?{calendars:[{id:'work',name:'Work Calendar'}]}:{integrations:[{id:id(3),provider:'google',email:'owner@example.test',calendar_id:'work',calendar_name:'Work Calendar',auto_sync:false,state:'connected',last_error:null,last_synced_at:null}]}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)})
  })
  await page.goto('/?view=settings')
  await page.getByRole('button',{name:/Calendar connections/}).click()
  await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible()
  await page.getByRole('switch').check()
  await page.getByRole('button',{name:'Save calendar settings'}).click()
  await expect.poll(()=>saved?.autoSync).toBe(true)
  await expect(page.getByRole('button',{name:'Connect Microsoft Outlook'})).toBeVisible()
})

test('calendar widget fits a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844})
  await mockWorkspace(page)
  await page.route('**/rest/v1/calendar_work?**', route=>route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'*/0'},body:'[]'}))
  await page.goto('/')
  const calendar=page.getByRole('region',{name:'Work calendar'})
  await expect(calendar).toBeVisible()
  expect(await calendar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
})

test('dashboard layout uses the business name, puts calendar first, and opens only jobs from the tile', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByText('Velnu QA · Today', { exact: true })).toBeVisible()
  const calendar = page.getByRole('region', { name: 'Work calendar' })
  const workAreas = page.getByRole('region', { name: 'Work areas' })
  expect((await calendar.boundingBox()).y).toBeLessThan((await workAreas.boundingBox()).y)
  const jobs = page.getByRole('article', { name: 'Jobs overview' })
  await expect(jobs).not.toContainText('Reminders')
  await expect(jobs).not.toContainText('schedule')
  await jobs.getByRole('button', { name: 'Open jobs', exact: false }).click()
  await expect(page.getByRole('heading', { name: 'Keep every job moving.' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Jobs and schedule views' })).toHaveCount(0)
})

for (const kind of ['job', 'estimate', 'invoice']) {
  test(`record resources: ${kind} picture and expense persist, remove, and appear once in the workbook`, async ({ page }) => {
    const recordId = id(701)
    const record = { id: recordId, title: 'Kitchen repair', status: kind === 'job' ? 'in_progress' : 'draft', scheduled_start: null,
      customer_id: CID, customers: customer, invoice_number: 'INV-701', estimate_number: 'EST-701',
      issue_date: todayISO(), due_date: todayISO(), subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100 }
    const state = await mockWorkspace(page, { jobs: [record], estimates: [record], invoices: [record] })
    const openRecord = async () => {
      await page.goto(kind === 'invoice' ? `/?view=invoices&document=${recordId}` : `/?view=${kind === 'job' ? 'work' : 'estimates'}`)
      if (kind !== 'invoice') await page.getByRole('button', { name: `Photos and expenses for ${kind === 'job' ? 'Kitchen repair' : 'EST-701'}` }).click()
    }
    await openRecord()
    const panel = page.getByRole('region', { name: 'Photos and expenses' })
    await expect(panel.getByText('No pictures added yet.')).toBeVisible()
    await panel.getByLabel('Add pictures').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
    await expect(panel.getByRole('alert')).toContainText('This picture could not be opened')
    expect(state.storageWrites).toBe(0)
    await panel.getByLabel('Add pictures').setInputFiles({ name: 'job-photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGNkaGhgwAaYsIoOWgkAzIgBEFCQDcoAAAAASUVORK5CYII=', 'base64') })
    await expect(panel.getByRole('img', { name: 'job-photo.png' })).toBeVisible()
    expect(state.storageWrites).toBe(1)
    expect(state.photos[0][`${kind}_id`]).toBe(recordId)
    expect(state.photos[0].media_type).toBe('image/jpeg')
    await panel.getByRole('button', { name: 'Add expense', exact: true }).click()
    await panel.getByLabel('Amount ($)').fill('24.75')
    await panel.getByLabel('Description', { exact: true }).fill('Replacement fittings')
    await panel.getByRole('button', { name: 'Save expense', exact: true }).evaluate(button => { button.click(); button.click() })
    await expect(panel.getByRole('heading', { name: 'Expenses · $24.75', exact: true })).toBeVisible()
    expect(state.expenses).toHaveLength(1)
    expect(state.expenses[0][`${kind}_id`]).toBe(recordId)
    expect(state.expenses[0].business_id).toBe(BID)
    expect(state.expenses[0].direction).toBe('expense')
    await openRecord()
    await expect(panel.getByRole('img', { name: 'job-photo.png' })).toBeVisible()
    await expect(panel.getByText('Replacement fittings', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/${kind}-resources-phone.png`, fullPage: true })
    page.on('dialog', dialog => dialog.accept())
    await panel.getByRole('button', { name: 'Remove picture job-photo.png' }).click()
    await expect(panel.getByRole('img')).toHaveCount(0)
    await page.goto('/')
    await page.locator('.performance-metric.expense').click()
    await expect(page.locator('.transaction-list > li').filter({ hasText: 'Replacement fittings' })).toHaveCount(1)
    expect(state.invoices[0].total).toBe(100)
  })
}

test('record resources: viewer cannot upload photos or add expenses', async ({ page }) => {
  await mockWorkspace(page, { role: 'viewer', jobs: [{ id: id(702), title: 'Read only job', status: 'in_progress', scheduled_start: null, customer_id: CID, customers: customer }] })
  await page.goto('/?view=work')
  await page.getByRole('button', { name: 'Photos and expenses for Read only job' }).click()
  const panel = page.getByRole('region', { name: 'Photos and expenses' })
  await expect(panel.getByLabel('Add pictures')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Add expense', exact: true })).toHaveCount(0)
  await expect(panel.getByText('Expense records are available to owners, administrators, and office staff.')).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`billing hub combines billing without hiding actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const invoices = Array.from({ length: 6 }, (_, n) => ({ id:id(800+n), invoice_number:`INV-${800+n}`, status:n === 5 ? 'paid' : 'sent',
      issue_date:'2026-10-01', created_at:`2026-11-01T1${n}:00:00Z`, due_date:'2020-01-01', total:450, balance_due:n === 5 ? 0 : 450, amount_paid:n === 5 ? 450 : 0, customer_id:CID,
      customers:{...customer,company:null}, jobs:{title:'Electrical wiring service'} }))
    const estimates = Array.from({ length: 3 }, (_, n) => ({ id:id(820+n), estimate_number:`EST-${820+n}`, status:n === 2 ? 'draft' : 'sent',
      issue_date:'2026-10-02', created_at:`2026-11-01T1${n}:30:00Z`, total:1250, customer_id:CID,
      customers:{first_name:null,last_name:null,company:'Acme Corp'}, jobs:{title:'HVAC installation'} }))
    const jobs = [{id:id(850),title:'Kitchen renovation',status:'in_progress',customers:customer},{id:id(851),title:'Water heater replacement',status:'scheduled',customers:customer},{id:id(852),title:'Plumbing maintenance',status:'lead',customers:customer}]
    await openDashboard(page, { invoices, estimates, jobs, aggregate:{open_invoices:5,outstanding_balance:2250} })
    const hub = page.getByRole('article', {name:'Estimates and invoices overview'})
    await expect(hub.getByText('$2,250.00',{exact:true})).toBeVisible()
    expect(await hub.getByText('$2,250.00',{exact:true}).evaluate(el => el.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(el).fontSize)*1.5)).toBe(true)
    await expect(page.locator('.dashboard-work-grid>article')).toHaveCount(2)
    const attention = hub.getByRole('region',{name:'Needs Attention'})
    await expect(attention.getByRole('listitem')).toHaveCount(5)
    await expect(attention).toContainText('Overdue')
    await expect(attention).toContainText('Awaiting approval')
    await expect(hub).toContainText('Showing 5 of 7 items needing attention')
    await expect(hub.getByRole('button',{name:'Estimates',exact:true})).toBeVisible()
    await expect(hub.getByRole('button',{name:'Invoices',exact:true})).toBeVisible()
    await expect(page.getByRole('article',{name:'Jobs overview'})).toContainText('3active')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await expect(page.locator('.financial-transactions')).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Tell Finviant Office what needs to get done.'})).toHaveCount(0)
    await page.screenshot({path:`test-results/dashboard-billing-${width}.png`,fullPage:true})
    await hub.getByRole('button',{name:'Recent',exact:true}).click()
    const recent=hub.getByRole('region',{name:'Recent documents'})
    await expect(recent.getByRole('listitem')).toHaveCount(5)
    await expect(recent.getByRole('listitem').first()).toContainText('INV-805')
    await expect(recent.getByRole('listitem').first()).toContainText('Paid')
    await expect(recent).toContainText('Draft')
    await expect(recent).toContainText('HVAC installation')
    await expect(recent.getByRole('link',{name:'Open estimate EST-822 for Acme Corp'})).toHaveAttribute('href',`/?view=estimates&document=${id(822)}`)
    await recent.getByRole('link',{name:'Open invoice INV-805 for Jane Doe'}).click()
    await expect(page.getByRole('heading',{name:'INV-805',exact:true}).first()).toBeVisible()
    expect(new URL(page.url()).searchParams.get('document')).toBe(id(805))
  })
}

test('billing hub empty state and finance restrictions stay honest', async ({page})=>{
  const state=await openDashboard(page)
  const hub=page.getByRole('article',{name:'Estimates and invoices overview'})
  await expect(hub.getByText('No overdue invoices or pending approvals.')).toBeVisible()
  await page.screenshot({path:'test-results/dashboard-billing-empty.png',fullPage:true})
  await hub.getByRole('button',{name:'Recent',exact:true}).click()
  await expect(hub).toContainText('No estimates or invoices yet.')
  state.role='technician';state.aggregate={open_invoices:5,outstanding_balance:98765}
  await page.reload()
  await expect(hub).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Financial performance',exact:true})).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('$98,765')
})

test('billing hub leaves calendar and financial detail available without long default lists', async ({page})=>{
  await mockWorkspace(page)
  const items=Array.from({length:7},(_,n)=>({source_key:`job:${n}`,title:`Calendar repair ${n}`,starts_at:new Date().toISOString(),ends_at:null,status:'scheduled',document_kind:'work',document_id:id(n)}))
  await page.route('**/rest/v1/calendar_work?**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'0-6/7'},body:JSON.stringify(items)}))
  await page.goto('/')
  const calendar=page.getByRole('region',{name:'Work calendar'})
  await expect(calendar.getByRole('link')).toHaveCount(3)
  await calendar.getByRole('button',{name:'Show all 7 scheduled items'}).click()
  await expect(calendar.getByRole('link')).toHaveCount(7)
  await calendar.getByRole('button',{name:'Show fewer scheduled items'}).click()
  await expect(calendar.getByRole('link')).toHaveCount(3)
  const details=page.locator('.financial-transactions')
  await expect(details).toHaveCount(0)
  await page.locator('.trend-point').first().click()
  await expect(details).toBeVisible()
})


for (const width of [1440,390]) test(`owner settings navigation is clear at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mockWorkspace(page)
 const writes=[]
 await page.route('**/rest/v1/business_settings?**',r=>{if(r.request().method()==='POST')writes.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:JSON.stringify({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})})})
 await page.route('**/rest/v1/businesses?**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...business,...r.request().postDataJSON()})}))
 await page.goto('/?view=settings')
 for(const label of ['Company profile','Team & access','Invoice & estimate setup','Calendar connections','Cancel subscription'])await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-expanded','false')
 await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Invoice & estimate setup',exact:true}).click()
 await page.getByLabel('Default tax rate (%)').fill('5.3')
 await page.getByRole('button',{name:'Save document setup'}).click()
 await expect(page.getByRole('status').filter({hasText:'Document setup saved'})).toBeVisible()
 expect(writes[0].default_tax_rate).toBe(5.3)
 for(const field of ['payment_links','payment_instructions','pricing_adjustment_percent'])expect(writes[0]).not.toHaveProperty(field)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/owner-settings-${width}.png`,fullPage:true})
})

test('owner settings invites reserve a seat and permissions are editable only through team controls',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 const state=await mockWorkspace(page)
 const team={seat_limit:5,pro:true,members:[{user_id:UID,email:'owner@example.test',role:'owner',primary_owner:true,access_modules:['calendar','jobs','billing','finances']},{user_id:id(902),email:'office@example.test',role:'office',primary_owner:false,access_modules:['calendar','billing']}],invitations:[]}
 const changes=[]
 await page.route('**/rest/v1/rpc/get_team_settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(team)}))
 await page.route('**/rest/v1/rpc/manage_team_member',r=>{changes.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:'null'})})
 await page.route('**/functions/v1/team-management',r=>{const b=r.request().postDataJSON();changes.push(b);team.invitations.push({id:id(903),email:b.email,role:b.role,access_modules:b.modules,expires_at:'2026-11-09T12:00:00Z'});return r.fulfill({contentType:'application/json',body:JSON.stringify({url:'https://finviant.com/auth?invite='+'a'.repeat(64),email_status:'unconfirmed',expires_at:'2026-11-09'})})})
 await page.goto('/?view=settings');await page.getByRole('button',{name:/Team & access/}).click()
 await expect(page.getByText('2 of 5 seats')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:'test-results/team-settings-phone.png',fullPage:true})
 await page.getByLabel('Email address',{exact:true}).fill('field@example.test')
 await page.getByRole('button',{name:'Send invitation'}).click()
 await expect(page.getByText('3 of 5 seats')).toBeVisible();await expect(page.getByLabel('Private invitation link')).toHaveValue(/invite=/)
 expect(changes[0].modules).toEqual(['calendar','jobs'])
 await page.getByRole('button',{name:'Edit access'}).click()
 const editor=page.getByRole('region',{name:'Edit member access'})
 await editor.getByRole('checkbox',{name:'Estimates & invoices'}).uncheck()
 await editor.getByRole('button',{name:'Save access'}).click()
 await expect.poll(()=>changes.some(c=>c.p_action==='update'&&!c.p_modules.includes('billing'))).toBe(true)
 expect(state.requests.some(r=>r.method==='PATCH'&&r.path.endsWith('/business_members'))).toBe(false)
})

test('owner settings five-seat capacity blocks a sixth invitation',async({page})=>{
 await mockWorkspace(page)
 await page.route('**/rest/v1/rpc/get_team_settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({seat_limit:5,pro:true,members:Array.from({length:5},(_,n)=>({user_id:id(n),email:`member${n}@example.test`,role:n?'office':'owner',primary_owner:n===0,access_modules:[]})),invitations:[]})}))
 await page.goto('/?view=settings');await page.getByRole('button',{name:/Team & access/}).click()
 await expect(page.getByText('5 of 5 seats')).toBeVisible();await expect(page.getByRole('button',{name:'Send invitation'})).toHaveCount(0)
})

test('owner settings restricted staff cannot open hidden modules or owner controls',async({page})=>{
 const state=await mockWorkspace(page,{role:'office',accessModules:['jobs']});await page.goto('/')
 await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Work calendar'})).toHaveCount(0)
 await expect(page.getByRole('article',{name:'Estimates and invoices overview'})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Financial performance',exact:true})).toHaveCount(0)
 expect(state.requests.some(r=>r.path.endsWith('/rpc/get_dashboard_invoice_totals'))).toBe(false)
 await page.goto('/?view=invoices');await expect(page.getByRole('alert')).toContainText('not included in your access')
 await page.goto('/?view=settings');await expect(page.getByRole('button',{name:/Team & access/})).toHaveCount(0);await expect(page.locator('#settings-subscription-trigger')).toHaveCount(0);await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
})

test('owner settings invoice tax defaults and optional cost pricing affect preview and saved lines',async({page})=>{
 await mockWorkspace(page);let payload
 await page.route('**/rest/v1/business_settings?**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({default_tax_rate:5.3,pricing_adjustment_percent:3,payment_links:[],payment_instructions:''})}))
 await page.route('**/rest/v1/rpc/create_document',r=>{payload=r.request().postDataJSON();return r.fulfill({contentType:'application/json',body:JSON.stringify({id:id(910)})})})
 await page.goto('/?view=invoices');await page.getByRole('button',{name:'+ New invoice'}).click()
 await page.getByText('Choose from saved customers',{exact:true}).click()
 await page.getByLabel('Customer',{exact:true}).selectOption(CID)
 await page.getByPlaceholder('Description',{exact:true}).fill('Service work');await page.getByPlaceholder('Unit price',{exact:true}).fill('100')
 await expect(page.getByLabel('Tax rate (%)')).toHaveValue('5.3')
 await expect(page.locator('.estimate-total strong')).toHaveText('$105.30')
 await page.getByRole('checkbox',{name:/Include payment costs/}).check();await expect(page.locator('.estimate-total strong')).toHaveText('$108.46')
 await page.getByRole('button',{name:'Create invoice',exact:true}).click();await expect.poll(()=>payload?.payload.items[0].unit_price).toBe(103);expect(payload.payload.items[0].tax_rate).toBe(5.3)
 await page.goto('/?view=estimates');await page.getByRole('button',{name:'+ New estimate'}).click();await expect(page.getByLabel('Tax rate (%)')).toHaveValue('5.3');await expect(page.getByRole('checkbox',{name:/Include payment costs/})).toHaveCount(0)
})

test('owner settings invoice payment buttons use saved links and do not record payments',async({page})=>{
 const invoice={id:id(920),invoice_number:'INV-920',status:'sent',issue_date:'2026-11-02',total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100,customer_id:CID,customers:customer,payment_links:[{provider:'venmo',url:'https://venmo.com/business'},{provider:'paypal',url:'https://paypal.me/business'},{provider:'stripe',url:'https://buy.stripe.com/example'},{provider:'cashapp',url:'https://cash.app/$Business'}],payment_instructions:'Use invoice number INV-920.'}
 const state=await mockWorkspace(page,{invoices:[invoice]});await page.goto('/?view=invoices&document='+invoice.id)
 for(const name of ['Venmo','PayPal','Stripe','Cash App'])await expect(page.getByRole('link',{name:'Pay with '+name,exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'Pay with PayPal',exact:true})).toHaveAttribute('href','https://paypal.me/business')
 expect(state.requests.some(r=>r.path.endsWith('/payments')&&r.method==='POST')).toBe(false)
})

test('owner settings cancellation uses explicit confirmation and preserves no-subscription truth',async({page})=>{
 await mockWorkspace(page);const actions=[];let active=true,canceled=false
 await page.route('**/functions/v1/subscription-management',r=>{const b=r.request().postDataJSON();actions.push(b.action);if(b.action==='cancel')canceled=true;return r.fulfill({contentType:'application/json',body:JSON.stringify(active?{active:true,status:'active',can_cancel:true,cancel_at_period_end:canceled,ends_at:'2026-12-02T12:00:00Z'}:{active:false,status:'none',can_cancel:false})})})
 await page.goto('/?view=settings');await page.locator('#settings-subscription-trigger').click();await page.getByRole('region',{name:'Cancel subscription',exact:true}).getByRole('button',{name:'Cancel subscription',exact:true}).click();expect(actions.every(a=>a==='status')).toBe(true);await page.getByRole('button',{name:'Confirm cancellation'}).click();await expect(page.getByRole('status').filter({hasText:'Cancellation scheduled'})).toContainText('Cancellation scheduled');expect(actions.filter(a=>a==='cancel')).toHaveLength(1);await expect(page.getByRole('region',{name:'Cancel subscription',exact:true}).getByRole('button',{name:'Cancel subscription',exact:true})).toBeDisabled()
 active=false;await page.reload();await page.locator('#settings-subscription-trigger').click();await expect(page.getByText(/No paid subscription is active/)).toBeVisible();await expect(page.getByRole('region',{name:'Cancel subscription',exact:true}).getByRole('button',{name:'Cancel subscription',exact:true})).toBeDisabled()
})

test('owner settings invitation acceptance bypasses company creation and separate plan selection',async({page})=>{
 await mockWorkspace(page);let accepted=false
 await page.route('**/rest/v1/rpc/accept_team_invitation',r=>{expect(r.request().postDataJSON().p_hash).toMatch(/^[a-f0-9]{64}$/);accepted=true;return r.fulfill({contentType:'application/json',body:JSON.stringify(BID)})})
 await page.goto('/auth?invite='+'a'.repeat(64));await page.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect.poll(()=>accepted).toBe(true);await expect(page.getByRole('region',{name:'Work calendar'})).toBeVisible();expect(await page.evaluate(uid=>localStorage.getItem('finviant-active-business:'+uid),UID)).toBe(BID)
})


for (const width of [1440,390]) test(`interactive dashboard week and month calendar selects work at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mockWorkspace(page)
 const day=DateTime.now().setZone('America/New_York').startOf('day')
 const items=[0,1,2].map((offset)=>({source_key:`job:interactive-${offset}`,title:['Kitchen installation','Oak Street repair','HVAC maintenance'][offset],description:'',starts_at:day.plus({days:offset,hours:9}).toISO(),ends_at:day.plus({days:offset,hours:11}).toISO(),status:'scheduled',document_kind:'work',document_id:id(980+offset)}))
 const calls=[]
 await page.route('**/rest/v1/calendar_work?**',r=>{calls.push(r.request().url());return r.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':'0-2/3'},body:JSON.stringify(items)})})
 await page.goto('/')
 const calendar=page.getByRole('region',{name:'Work calendar'})
 await expect(calendar.getByRole('heading',{name:'Weekly schedule'})).toBeVisible()
 await expect(calendar.getByRole('link',{name:/Kitchen installation/})).toBeVisible()
 await expect(calendar.getByRole('button',{name:'Today',exact:true})).toHaveCount(0)
 await expect(calendar.getByRole('button',{name:/Open (calendar|schedule)/})).toHaveCount(0)
 await calendar.getByRole('button',{name:'Month',exact:true}).click()
 await expect(calendar.getByLabel('Calendar month')).toHaveCount(0)
 await expect(calendar.getByRole('heading',{name:'Monthly calendar'})).toBeVisible()
 await calendar.getByRole('button',{name:new RegExp(day.plus({days:1}).toLocaleString(DateTime.DATE_FULL))}).click()
 await page.getByRole('button',{name:'Close calendar entry',exact:true}).click()
 await expect(calendar.getByRole('link',{name:/Oak Street repair/})).toBeVisible()
 const before=calls.length
 await calendar.getByRole('button',{name:new RegExp(day.plus({days:2}).toLocaleString(DateTime.DATE_FULL))}).click()
 await page.getByRole('button',{name:'Close calendar entry',exact:true}).click()
 await expect(calendar.getByRole('link',{name:/HVAC maintenance/})).toBeVisible()
 expect(calls.length).toBe(before)
 const months=Math.round(DateTime.fromISO('2028-02-01').diff(day.startOf('month'),'months').months)
 for(let i=0;i<Math.abs(months);i++)await calendar.getByRole('button',{name:months>0?'Next month':'Previous month'}).click()
 await expect(calendar.getByRole('button',{name:/February 29, 2028/})).toBeVisible()
 await expect(calendar.getByText('February 2028',{exact:true})).toBeVisible()
 await calendar.getByRole('button',{name:'Next month'}).click();await expect(calendar.getByText('March 2028',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/interactive-calendar-month-${width}.png`,fullPage:true})
 await calendar.getByRole('button',{name:'Week',exact:true}).click();await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
})

async function mockInteractiveFinances(page) {
 const now=DateTime.now().setZone('America/New_York').startOf('month')
 const invoice={id:id(990),invoice_number:'INV-990',status:'sent',issue_date:now.toISODate(),total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100,customer_id:CID,customers:customer}
 const job={id:id(991),title:'Kitchen installation',status:'in_progress',scheduled_start:null,customer_id:CID,customers:customer}
 await mockWorkspace(page,{invoices:[invoice],jobs:[job],estimates:[{id:id(992),estimate_number:'EST-992',status:'sent',total:650,issue_date:now.toISODate(),customer_id:CID,customers:customer}]})
 const payments=[{id:id(993),invoice_id:invoice.id,amount:100,paid_at:now.plus({hours:12}).toISO(),status:'succeeded',method:'cash',invoices:{invoice_number:'INV-990'}},{id:id(994),invoice_id:invoice.id,amount:50,paid_at:now.minus({months:2}).plus({hours:12}).toISO(),status:'succeeded',method:'paypal',invoices:{invoice_number:'INV-990'}}]
 const manual=Array.from({length:32},(_,index)=>({id:id(1000+index),amount:1,entry_date:now.toISODate(),direction:'expense',description:index===0?'Copper fittings':`Materials ${index+1}`,category:'Materials',currency:'USD',job_id:index===0?job.id:null,jobs:index===0?{title:job.title}:null,notes:index===0?'Receipt from local hardware store':null}))
 manual.push({id:id(1100),amount:25,entry_date:now.minus({months:5}).toISODate(),direction:'income',description:'Consultation',category:'Service',currency:'USD'},{id:id(1101),amount:10,entry_date:now.minus({months:11}).toISODate(),direction:'expense',description:'Older tools',category:'Tools',currency:'USD'})
 for(const [table,rows,dateField] of [['payments',payments,'paid_at'],['bookkeeping_entries',manual,'entry_date']])await page.route(`**/rest/v1/${table}?**`,r=>{
  const q=new URL(r.request().url()).searchParams
  expect(q.get('business_id')).toBe('eq.'+BID)
  const filtered=rows.filter(row=>q.getAll(dateField).every(filter=>filter.startsWith('gte.')?Date.parse(row[dateField])>=Date.parse(filter.slice(4)):filter.startsWith('lt.')?Date.parse(row[dateField])<Date.parse(filter.slice(3)):true))
  const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||1000)
  return r.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':`${offset}-${offset+filtered.slice(offset,offset+limit).length-1}/${filtered.length}`},body:JSON.stringify(filtered.slice(offset,offset+limit))})
 })
 return {now,invoice,job}
}
for (const width of [1440,390]) test(`interactive dashboard financial periods expand complete transactions and sources at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const {now,invoice,job}=await mockInteractiveFinances(page)
 await page.goto('/')
 const finance=page.getByRole('region',{name:'Financial performance',exact:true})
 await expect(finance.getByRole('button',{name:'6 months',exact:true})).toHaveAttribute('aria-pressed','true')
 const income=finance.locator('.performance-metric.income'),expenses=finance.locator('.performance-metric.expense'),net=finance.locator('.performance-metric.all')
 await expect(income).toContainText('$175.00');await expect(expenses).toContainText('$32.00');await expect(net).toContainText('$143.00')
 await page.screenshot({path:`test-results/interactive-dashboard-${width}.png`,fullPage:true})
 await income.click();let details=finance.getByRole('region',{name:'Income transactions',exact:true})
 await expect(details.locator('.transaction-list > li')).toHaveCount(3)
 await expect(details.getByText(/Invoice payment · paypal/)).toBeVisible()
 await expect(details.getByRole('link',{name:/View invoice/}).first()).toHaveAttribute('href','/?view=invoices&document='+invoice.id)
 await expenses.click();details=finance.getByRole('region',{name:'Expense transactions',exact:true})
 await expect(details.locator('.transaction-list > li')).toHaveCount(25)
 await expect(details.getByText('1–25 of 32',{exact:true})).toBeVisible()
 await details.getByRole('button',{name:'Next',exact:true}).click();await expect(details.locator('.transaction-list > li')).toHaveCount(7)
 await expect(details.getByText('Materials 32',{exact:true})).toBeVisible()
 await details.getByLabel('Search transactions').fill('Copper')
 await expect(details.locator('.transaction-list > li')).toHaveCount(1)
 await expect(details.getByText('Job expense · Kitchen installation',{exact:true})).toBeVisible()
 await expect(details.getByRole('link',{name:/View job/})).toHaveAttribute('href','/?view=work&document='+job.id)
 await page.screenshot({path:`test-results/interactive-financial-details-${width}.png`,fullPage:true})
 await net.click();await expect(finance.getByRole('region',{name:'All transactions',exact:true})).toContainText('1–25 of 35')
 for(const [period,expected] of [[1,'$68.00'],[3,'$118.00'],[12,'$133.00']]){
  await finance.getByRole('button',{name:period+' '+(period===1?'month':'months'),exact:true}).click()
  await expect(net).toContainText(expected)
  await expect(finance.locator('.trend-point')).toHaveCount(period===1?now.daysInMonth:period)
 }
 await finance.locator('.trend-point').first().focus();await page.keyboard.press('Enter')
 await expect(finance.getByRole('region',{name:'All transactions',exact:true})).toContainText('Older tools')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.goto('/?view=work&document='+job.id)
 await expect(page.getByRole('dialog')).toContainText('Kitchen installation')
})
test('interactive dashboard financial failure does not show invented zero totals',async({page})=>{
 await mockWorkspace(page)
 await page.route('**/rest/v1/payments?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Payments unavailable'})}))
 await page.goto('/')
 const finance=page.getByRole('region',{name:'Financial performance',exact:true})
 await expect(finance.getByRole('alert')).toContainText('Payments unavailable', {timeout:15000})
 await expect(finance.locator('.performance-metric.income')).toBeDisabled()
 await expect(finance.locator('.performance-metrics')).not.toContainText('$0.00')
 await expect(finance.getByRole('button',{name:'Retry financial data'})).toBeVisible()
})


test('interactive dashboard navigation does not treat an invoice link as a job link',async({page})=>{
 const {invoice}=await mockInteractiveFinances(page)
 await page.goto('/?view=invoices&document='+invoice.id)
 await expect(page.getByRole('link',{name:'Pay with PayPal',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Dashboard',exact:true}).click()
 await page.getByRole('button',{name:'Open jobs',exact:false}).click()
 await expect(page.getByRole('heading',{name:'Keep every job moving.'})).toBeVisible()
 await expect(page.getByRole('article').filter({hasText:'Kitchen installation'})).toBeVisible()
 await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('volume lists reach historical invoices beyond 1000 and keep 25 rows per page',async({page})=>{
 const invoices=Array.from({length:1100},(_,i)=>({id:id(10000+i),invoice_number:`QA-${String(i).padStart(4,'0')}`,status:'draft',issue_date:'2026-01-01',due_date:'2026-01-31',subtotal:100,tax_amount:0,total:100,amount_paid:0,balance_due:100,customer_id:CID,customers:customer}))
 await mockWorkspace(page,{invoices})
 await page.goto('/?view=invoices')
 await expect(page.getByText('1100 records · Page 1 of 44')).toBeVisible()
 await expect(page.locator('.invoice-list-row')).toHaveCount(25)
 await page.getByRole('searchbox',{name:'Search invoices'}).fill('QA-0000')
 await expect(page.getByText('1 records · Page 1 of 1')).toBeVisible()
 await expect(page.getByRole('button',{name:/QA-0000/})).toBeVisible()
 await page.getByRole('button',{name:'+ New invoice'}).click()
 await page.getByLabel('Issue date',{exact:true}).fill('2026-01-01')
 await page.getByLabel('Due date',{exact:true}).fill('2026-01-31')
 await expect(page.getByLabel('Issue date',{exact:true})).toHaveValue('2026-01-01')
})
