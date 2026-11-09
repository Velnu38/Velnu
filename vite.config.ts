import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ['terminal.local'] },
  build: {
    rollupOptions: {
      // Local browser fixtures are built separately after startup validation;
      // hosted builds always contain just the application entry point.
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
