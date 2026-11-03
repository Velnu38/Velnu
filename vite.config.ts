import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle lazy-route dependencies before concurrent browser sessions start.
  // Late dependency discovery otherwise reloads active forms in the dev server.
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@supabase/supabase-js', 'luxon', 'posthog-js'],
  },
  build: {
    rollupOptions: {
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
