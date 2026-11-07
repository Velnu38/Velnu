import {defineConfig} from '@playwright/test'
import base from './playwright.config.mjs'

export default defineConfig({
  ...base,
  testMatch: '**/private-beta-email.spec.mjs',
  testIgnore: [],
  reporter: [['list']],
  use: {
    ...base.use,
    ...(process.env.FINVIANT_TEST_EXECUTABLE_PATH ? {launchOptions: {executablePath: process.env.FINVIANT_TEST_EXECUTABLE_PATH}} : {}),
  },
  webServer: {
    ...base.webServer,
    env: {
      ...base.webServer.env,
      VITE_ENABLE_CUSTOMER_ACTIONS: 'false',
      VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true',
    },
  },
})
