import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Stable vendor caches; analytics remains a consent-gated dynamic import.
        manualChunks(id) {
          if (id.includes('/node_modules/posthog-js/')) return 'analytics'
          if (id.includes('/node_modules/@supabase/')) return 'supabase'
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
