import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ['terminal.local'] },
  build: {
    rollupOptions: {
      // The isolated invoice regression page is included only in local browser-test builds.
      // Hosted deployments must never publish test fixtures.
      input: !process.env.VERCEL && process.env.FINVIANT_BROWSER_TEST === 'true'
        ? { app: 'index.html', invoiceFixture: 'tests/invoice.html' }
        : undefined,
      output: {
        // Stable vendor caches; analytics remains a consent-gated dynamic import.
        manualChunks(id) {
          if (id.indexOf('/node_modules/posthog-js/') !== -1) return 'analytics'
          if (id.indexOf('/node_modules/@supabase/') !== -1) return 'supabase'
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
