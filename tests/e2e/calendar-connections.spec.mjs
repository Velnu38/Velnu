import { test, expect } from '@playwright/test'
import { mock, B } from './audit-fixture.mjs'

const integration = {
  id: '77777777-7777-4777-8777-777777777777',
  provider: 'google', email: 'owner@example.test', state: 'connected',
  calendar_id: 'primary', calendar_name: 'Primary calendar', auto_sync: false,
  last_synced_at: null, last_error: null,
}

for (const width of [390, 1440]) test(`Calendar Connections opens from More and recovers after server setup at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await mock(page, { ai: true })
  let configured = false
  const saves = []
  await page.route('**/api/calendar?**', route => {
    const request = route.request()
    const action = new URL(request.url()).searchParams.get('action')
    if (!configured) return route.fulfill({ status: 503, json: { error: 'calendar_setup_required' } })
    if (action === 'list') return route.fulfill({ json: { integrations: [integration] } })
    if (action === 'calendars') return route.fulfill({ json: { calendars: [{ id: 'primary', name: 'Primary calendar' }] } })
    if (action === 'settings') {
      saves.push(request.postDataJSON())
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: { events: [], issues: [], connections: 0 } })
  })
  await page.goto('/')
  await page.locator(width > 900 ? '.sidebar' : '.mobile-nav').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('link', { name: /^Calendar Connections/ }).click()
  const settings = page.getByRole('region', { name: 'Calendar integrations' })
  await expect(settings).toBeVisible({ timeout: 15000 })
  await expect(settings.getByRole('alert')).toContainText('need administrator setup in Finviant')
  await expect(settings.getByRole('button', { name: 'Connect Google Calendar' })).toHaveCount(0)
  configured = true
  await settings.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(settings.getByText('owner@example.test', { exact: true })).toBeVisible()
  await settings.getByRole('switch').check()
  await settings.getByRole('button', { name: 'Save calendar settings' }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]).toEqual({ businessId: B, integrationId: integration.id, calendarId: 'primary', autoSync: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const result of ['connected', 'declined']) test(`legacy OAuth ${result} callback returns to Calendar Connections`, async ({ page }) => {
  await mock(page, { ai: true })
  await page.route('**/api/calendar?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    return route.fulfill({ json: action === 'list'
      ? { integrations: result === 'connected' ? [integration] : [] }
      : { calendars: [{ id: 'primary', name: 'Primary calendar' }] } })
  })
  await page.goto('/?view=settings&calendar=' + result)
  await expect(page.getByRole('heading', { name: 'Calendar Connections', exact: true })).toBeVisible()
  const settings = page.getByRole('region', { name: 'Calendar integrations' })
  await expect(settings).toContainText(result === 'connected' ? 'Calendar connected.' : 'Calendar access wasn’t granted.')
  await expect(settings.getByRole('button', { name: result === 'connected' ? 'Save calendar settings' : 'Connect Google Calendar' })).toBeVisible()
})

test('a callback URL alone does not claim an account is connected', async ({ page }) => {
  await mock(page, { ai: true })
  await page.route('**/api/calendar?**', route => route.fulfill({ json: { integrations: [] } }))
  await page.goto('/?view=settings&section=calendar&calendar=connected')
  const settings = page.getByRole('region', { name: 'Calendar integrations' })
  await expect(settings.getByRole('button', { name: 'Connect Google Calendar' })).toBeVisible()
  await expect(settings).not.toContainText('Calendar connected.')
})

for (const width of [390, 1440]) test(`Outlook remains usable when Google setup is unavailable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await mock(page, { ai: true })
  const connects = []
  await page.route('**/api/calendar?**', route => {
    const request = route.request()
    const action = new URL(request.url()).searchParams.get('action')
    if (action === 'connect') {
      connects.push(request.postDataJSON())
      return route.fulfill({ json: { url: '/?view=settings&section=calendar&calendar=declined' } })
    }
    return route.fulfill({ json: { integrations: [], providers: { google: false, outlook: true } } })
  })
  await page.goto('/?view=settings&section=calendar')
  const settings = page.getByRole('region', { name: 'Calendar integrations' })
  const google = settings.getByRole('article', { name: 'Google Calendar', exact: true })
  const outlook = settings.getByRole('article', { name: 'Microsoft Outlook', exact: true })
  await expect(google.getByRole('status')).toContainText('Google Calendar needs administrator setup')
  await expect(google.getByRole('button', { name: 'Connect Google Calendar' })).toBeDisabled()
  await expect(outlook.getByRole('button', { name: 'Connect Microsoft Outlook' })).toBeEnabled()
  await expect(outlook).not.toContainText('administrator setup')
  await outlook.getByRole('button', { name: 'Connect Microsoft Outlook' }).click()
  await expect.poll(() => connects.length).toBe(1)
  expect(connects[0]).toEqual({ businessId: B, provider: 'outlook' })
  await expect(page).toHaveURL(/calendar=declined/)
  await expect(settings).toContainText('Calendar access wasn’t granted.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a stale provider setup error names only that provider', async ({ page }) => {
  await mock(page, { ai: true })
  await page.route('**/api/calendar?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    return action === 'connect'
      ? route.fulfill({ status: 503, json: { error: 'google_calendar_setup_required' } })
      : route.fulfill({ json: { integrations: [] } })
  })
  await page.goto('/?view=settings&section=calendar')
  const settings = page.getByRole('region', { name: 'Calendar integrations' })
  await settings.getByRole('button', { name: 'Connect Google Calendar' }).click()
  await expect(settings.getByRole('alert')).toHaveText('Google Calendar needs administrator setup in Finviant before you can connect your account.')
  await expect(settings.getByRole('button', { name: 'Connect Microsoft Outlook' })).toBeEnabled()
})

test('an unavailable provider still permits cleanup of an existing connection', async ({ page }) => {
  await mock(page, { ai: true })
  const actions = []
  await page.route('**/api/calendar?**', route => {
    const request = route.request()
    const action = new URL(request.url()).searchParams.get('action')
    actions.push(action)
    return route.fulfill({ json: { integrations: [integration], providers: { google: false, outlook: true } } })
  })
  await page.goto('/?view=settings&section=calendar')
  const google = page.getByRole('article', { name: 'Google Calendar', exact: true })
  await expect(google.getByRole('status')).toContainText('administrator setup')
  await expect(google.getByRole('button', { name: 'Save calendar settings' })).toBeDisabled()
  await expect(google.getByRole('button', { name: 'Retry sync' })).toBeDisabled()
  await expect(google.getByRole('button', { name: 'Disconnect & remove published events' })).toBeEnabled()
  expect(actions).not.toContain('calendars')
})
