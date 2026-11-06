import { defineConfig, devices } from '@playwright/test'
import chromium from './playwright.config.mjs'

// Browser-engine simulation of iPhone Safari, not a physical iPhone.
// All Supabase requests are intercepted by the browser tests.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/mobile-results.json' }]],
  projects: [{
    name: 'iphone-webkit',
    use: {
      ...devices['iPhone 13'],
      baseURL: 'http://127.0.0.1:4173',
      serviceWorkers: 'block',
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
    },
  }],
  webServer: chromium.webServer,
})
