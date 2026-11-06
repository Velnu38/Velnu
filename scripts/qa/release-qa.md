# Finviant release QA

The Finviant Release QA workflow runs the full mocked Chromium regression, a WebKit mobile pass for dashboard, document and customer workflows, and a separate mocked integration check. Playwright exercises the built client in Chromium. These jobs use synthetic fixtures and publish counts and failure artifacts. A push to `qa/finviant-release` or a pull request targeting `ux/private-testing-20261029` triggers regression. Manual runs become available after the workflow reaches GitHub’s default branch.

## Configure an isolated signed-in run

1. Provision a dedicated Supabase QA branch or project. Apply the release’s migrations and deploy the Edge Functions used by the tested workflows. Keep the database limited to synthetic records. Leave email, SMS, live billing and paid AI integrations disconnected for this test.
2. Use a dedicated Vercel QA project with Deployment Protection and Protection Bypass for Automation. Create a **Preview** deployment of the commit under test. Configure these variables for that project’s Preview target.

   | Vercel variable | Value |
   | --- | --- |
   | `FINVIANT_DEPLOYMENT_ENV` | `qa` |
   | `FINVIANT_QA_SUPABASE_PROJECT_REF` and `FINVIANT_SUPABASE_PROJECT_REF` | The isolated QA project reference |
   | `VITE_SUPABASE_URL` | The isolated QA Supabase HTTPS origin |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The QA project’s publishable key |
   | `VITE_ENABLE_CUSTOMER_ACTIONS` | `false` |

3. Set up two test businesses whose names begin with `Finviant QA `. Create confirmed email/password accounts, complete onboarding and accept the current workspace terms. The primary business needs an owner with invoices, estimates, jobs, calendar and bookkeeping, office staff with billing, and a technician with jobs and without billing. Give the owner working hours and an available appointment slot. The fourth account is an owner of the independent business with customer access and no membership in the primary business.
4. Create the GitHub environment `QA`. Restrict it to the trusted QA and private testing branches. Set the environment variables and secrets below. Use the immutable `*.vercel.app` deployment origin, verified against the intended Git commit, without a path or bypass query string.

   | GitHub QA environment entry | Value |
   | --- | --- |
   | Variables | `FINVIANT_QA_PREVIEW_URL`, `FINVIANT_QA_SUPABASE_URL`, `FINVIANT_QA_BUSINESS`, `FINVIANT_QA_OUTSIDER_BUSINESS` |
   | Secrets | `FINVIANT_QA_VERCEL_BYPASS_SECRET` and both `FINVIANT_QA_<ROLE>_EMAIL` and `FINVIANT_QA_<ROLE>_PASSWORD` for `OWNER`, `OFFICE`, `TECHNICIAN` and `OUTSIDER` |

5. Enable the repository variable `FINVIANT_RUN_HOSTED_QA=true` and push to the QA branch. Where manual dispatch is available, select the QA branch and enable `hosted_qa`. Record the application deployment ID and workflow commit alongside the counts.

The signed-in job uses normal app login and verifies the expected Supabase Auth endpoint, workspace and role before it creates records. The owner test covers customer → estimate → recorded acceptance → job → invoice → recorded payment → bookkeeping. Other cases verify office, technician and second-business access. The workflow uses a QA-only browser network allowlist and publishes counts for hosted tests. Rotate the automation credential when access changes and reset the synthetic QA data as needed.

Run separate provider delivery and signed webhook tests when test credentials are available. Use the isolated QA environment for concurrent write and capacity measurements before deciding whether to promote a release.
