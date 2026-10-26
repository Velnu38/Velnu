# Velnu QuickBooks Online integration and workbook

## What is implemented
Velnu now has a Bookkeeping page with two separate sources: Velnu income/expenses and QuickBooks Online. Customer payments actually recorded on Velnu invoices flow automatically into the Velnu workbook. Users can enter additional manual income and expenses and export the displayed records as a CSV.

QuickBooks uses optional, read-only integration and a separate tab to avoid double counting the same payment entered in both systems. The initial manual import covers up to 100 transactions in each of three categories from roughly the past 90 days: Payment, SalesReceipt, and Purchase. Bills, refunds, payroll, and complete bank reconciliation are not included. Imported data is not an official profit-and-loss report.

The QuickBooks integration requires business owner or admin access. Business users must explicitly acknowledge that Intuit subscriptions, merchant processing, additional features and third-party integrations can carry separate fees depending on their plans. No Intuit payment or fee is automatically charged by using Velnu.

## Intuit sandbox setup required to activate Connect

1. Create a QuickBooks Online Accounting API app in Intuit Developer: https://developer.intuit.com/app/developer/qbo/docs/get-started
2. Register this exact HTTPS sandbox OAuth callback URI under Redirect URIs:
   https://xvybcmyoblfgzokaifsx.supabase.co/functions/v1/quickbooks
3. In Supabase Owedly-Test Edge Function Secrets, configure the following only on the server:
   INTUIT_CLIENT_ID = the sandbox app client ID.
   INTUIT_CLIENT_SECRET = the sandbox app secret.
   INTUIT_TOKEN_ENCRYPTION_KEY = securely generated 64-character hexadecimal encryption key (32 random bytes, for example generated with openssl rand -hex 32). Keep it unchanged or users must reconnect.
   INTUIT_ENVIRONMENT = sandbox
   VELNU_APP_URL = https://velnu-git-feature-velnu-stage1-mbarone5-1747.vercel.app
4. Do not paste credentials or the encryption key in ChatGPT, GitHub, Vercel VITE_ settings or browser code. Set them directly in https://supabase.com/dashboard/project/xvybcmyoblfgzokaifsx/functions/secrets
5. Open the Velnu development preview, sign in as the company owner, open Bookkeeping, acknowledge the fee notice and connect a sandbox company through Intuit. After redirecting back, choose Sync transactions and compare imported transactions to the Intuit sandbox.

The Supabase QuickBooks Edge Function uses the Intuit OAuth2 Accounting scope. Intuit's authorization may grant broad Accounting API capability; the current Velnu connector is implemented to make read-only Intuit queries only. Client and refresh tokens are encrypted using AES-GCM before database storage. Credential and OAuth state tables have no frontend-readable grants. Management requests require valid Supabase user auth and owner/admin business membership. The OAuth state is hashed, one-time, and expires after ten minutes.

## Launch limitations
The backend is deployed and will report missing configuration until the Intuit app credentials and encryption key are installed. Live OAuth and data accuracy cannot be verified yet; sandbox testing is required. Connect is intentionally unavailable before this setup. Do not switch to production without a separate production app, live OAuth settings, security review, billing decision and customer notice.

Intuit may impose partner platform and API fees, particularly for reading account data. Rate limits and per-business sync throttling are included as initial protections, but full pagination, webhook reconciliation, matching transactions across the two workbooks, refunds/credits, audit logging, and ongoing provider-cost monitoring must be developed before broad launch.

Business records are not tax or legal advice. Exporting to CSV does not replace an accountant, the customer's QuickBooks accounting records, or the legal retention of financial documents.
