import { defineConfig } from '@playwright/test'
import { readReleaseQaTarget } from './scripts/qa/release-target.mjs'

const target = readReleaseQaTarget()
export default defineConfig({
  testDir: './tests/hosted-qa',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/hosted-qa-results.json' }]],
  use: {
    baseURL: target.preview,
    browserName: 'chromium',
    channel: process.env.FINVIANT_TEST_CHANNEL === 'chrome' ? 'chrome' : undefined,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
