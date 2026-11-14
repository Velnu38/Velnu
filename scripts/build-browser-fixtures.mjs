import {build} from 'vite'
// Build isolated regression pages AFTER the real app has passed its production
// startup checks. A second Rollup entry in the app build changes CSS ownership
// and creates a bootstrap stylesheet dependency that production never has.
if(process.env.VERCEL||process.env.FINVIANT_BROWSER_TEST!=='true')throw Error('Browser regression fixtures are local/CI-only.')
await build({build:{emptyOutDir:false,rollupOptions:{input:{invoiceFixture:'tests/invoice.html',operationsPreview:'tests/operations/preview.html'}}}})
