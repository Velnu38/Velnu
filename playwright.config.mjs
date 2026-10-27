import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
    // CI may use its existing stable Chrome instead of downloading another browser.
    channel: process.env.FINVIANT_TEST_CHANNEL === 'chrome' ? 'chrome' : undefined,
    screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'trial-test-key', VITE_ENABLE_CUSTOMER_ACTIONS: 'true' },
  },
})
