import { test, expect } from '@playwright/test'

test('the homepage opens without an authentication response', async ({ page }) => {
  const workspaceRequests = []
  await page.route('https://example.supabase.co/**', route => {
    workspaceRequests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your work. Less paperwork.' })).toBeVisible()
  await expect(page.locator('.marketing-topbar').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('.marketing-topbar').getByRole('link', { name: 'Get started', exact: true })).toHaveAttribute('href', '/auth?mode=signup')
  await expect(page.getByRole('link', { name: 'Open workspace', exact: true })).toHaveAttribute('href', '/?view=dashboard')
  expect(workspaceRequests.filter(url => url.includes('/rest/v1/'))).toEqual([])
})

test('a remembered account still lands on the website before entering the app', async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: '33333333-3333-4333-8333-333333333333', exp: Math.floor(Date.now() / 1000) + 3600 }))
    localStorage.setItem('sb-example-auth-token', JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.test', refresh_token: 'test',
      expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test' },
    }))
  })
  await page.route('https://example.supabase.co/**', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your work. Less paperwork.' })).toBeVisible()
  await expect(page.getByText('Checking private beta access…')).toHaveCount(0)
})

test('Sign in opens the existing authentication screen and its home link returns to the landing page', async ({ page }) => {
  await page.goto('/')
  await page.locator('.marketing-topbar').getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\?mode=signin$/)
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Return to Finviant Office homepage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your work. Less paperwork.' })).toBeVisible()
})

test('a signed-out workspace bookmark prompts sign-in while the homepage stays public', async ({ page }) => {
  await page.goto('/?view=dashboard')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('.marketing-page')).toHaveCount(0)
})

for (const width of [337, 390, 1366]) test(`landing navigation works at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')
  await expect(page.locator('.marketing-topbar').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('.marketing-topbar').getByRole('link', { name: 'Get started', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.locator('.marketing-topbar').getByRole('link', { name: 'Get started', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible()
})
