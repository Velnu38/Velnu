import { chromium } from '@playwright/test'

// Public, unauthenticated smoke checks only. Never sign in or send real data.
const browser = await chromium.launch({ headless: true })
const urls = ['https://finviant.com/', 'https://www.finviant.com/', 'https://finviant.com/legal']
let failures = 0
try {
  for (const url of urls) {
    const page = await browser.newPage({ serviceWorkers: 'block' })
    const jsErrors = []
    const requestFailures = []
    page.on('pageerror', error => jsErrors.push(error.message.slice(0, 300)))
    page.on('requestfailed', req => {
      const u = new URL(req.url())
      // Only record destination host and request path, never query strings or headers.
      requestFailures.push(u.hostname + u.pathname + ': ' + (req.failure()?.errorText || 'unknown'))
    })
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(3500)
      const info = await page.evaluate(() => ({
        title: document.title,
        headline: document.querySelector('h1')?.textContent || '',
        visibleTextLength: document.body.innerText.trim().length,
        snippet: document.body.innerText.trim().slice(0, 140),
        scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
      }))
      console.log('LIVE CHECK', JSON.stringify({ url, status: resp?.status(), finalUrl: page.url(), ...info, jsErrors, requestFailures: requestFailures.slice(0, 6) }))
      if (!resp || resp.status() >= 400 || info.visibleTextLength < 30 || jsErrors.length) failures++
    } catch (err) {
      console.error('LIVE CHECK FAILED', url, String(err))
      failures++
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
if (failures) {
  console.error('Public-site smoke checks reported', failures, 'problems')
  process.exitCode = 1
}
