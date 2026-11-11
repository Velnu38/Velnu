import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { INTEGRATION_REVIEW_GIT_REF, MIGRATION_REVIEW_GIT_REF, PRIVATE_BETA_GIT_REF, STAGING_PROJECT_REF, validateDeploymentEnvironment } from '../../scripts/check-deployment.mjs'

const productionRef = 'abcdefghijklmnopqrst'
const staging = {
  VERCEL: '1', VERCEL_ENV: 'preview', FINVIANT_DEPLOYMENT_ENV: 'staging',
  FINVIANT_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  VITE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture',
}
const production = {
  ...staging, VERCEL_ENV: 'production', FINVIANT_DEPLOYMENT_ENV: 'production',
  FINVIANT_SUPABASE_PROJECT_REF: productionRef,
  VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`,
  FINVIANT_PRODUCTION_GIT_REF: 'release/production', VERCEL_GIT_COMMIT_REF: 'release/production',
}

test('local mocked builds remain available without hosted configuration', () => {
  assert.equal(validateDeploymentEnvironment({}).checked, false)
})
test('preview and development can use the registered staging project', () => {
  for (const target of ['preview', 'development']) {
    assert.equal(validateDeploymentEnvironment({ ...staging, VERCEL_ENV: target }).projectRef, STAGING_PROJECT_REF)
  }
})
test('production accepts its separate project and release branch', () => {
  assert.equal(validateDeploymentEnvironment(production).projectRef, productionRef)
})
test('private beta email can be enabled on its registered staging preview branch', () => {
  assert.equal(validateDeploymentEnvironment({
    ...staging, VERCEL_GIT_COMMIT_REF: PRIVATE_BETA_GIT_REF,
    VITE_ENABLE_CUSTOMER_ACTIONS: 'false', VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true',
  }).projectRef, STAGING_PROJECT_REF)
})

const cases = [
  ['payment recovery integration review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/payment-recovery-integration-20261111' }],
  ['payment recovery review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/payment-recovery-20261110' }],
  ['calendar resilience review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/calendar-resilience-20261110' }],
  ['integration review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: INTEGRATION_REVIEW_GIT_REF }],
  ['next steps review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/next-steps-20261110' }],
  ['reminders review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/reminders-release-20261110' }],
  ['identity policy review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/rls-initplans-20261110' }],
  ['reminder scan review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/reminder-scan-20261110' }],
  ['queue catch-up review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/queue-catchup-20261110' }],
  ['job customer search review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/job-customer-search-20261110' }],
  ['management queue review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/management-queue-20261110' }],
  ['isolated capacity review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/capacity-soak-20261110' }],
  ['jobs overview review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/jobs-management-pagination-20261110' }],
  ['owner archive review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/owner-archive-20261110' }],
  ['jobs directory review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/jobs-directory-20261110' }],
  ['recurring review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/recurring-owner-controls-20261110' }],
  ['recovery review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/recovery-operations-20261110' }],
  ['provider burst review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/provider-burst-20261110' }],
  ['authenticated acceptance review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/auth-storage-acceptance-20261110' }],
  ['document convenience review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/document-conveniences-20261110' }],
  ['worker health review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: 'review/worker-health-20261110' }],
  ['migration review deployment', { ...staging, VERCEL_GIT_COMMIT_REF: MIGRATION_REVIEW_GIT_REF }],
  ['missing hosted target', { ...staging, VERCEL_ENV: undefined }],
  ['unknown hosted target', { ...staging, VERCEL_ENV: 'custom' }],
  ['missing environment label', { ...staging, FINVIANT_DEPLOYMENT_ENV: undefined }],
  ['incorrect environment label', { ...production, FINVIANT_DEPLOYMENT_ENV: 'staging' }],
  ['missing reference', { ...production, FINVIANT_SUPABASE_PROJECT_REF: undefined }],
  ['production points to staging', { ...production, FINVIANT_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF, VITE_SUPABASE_URL: staging.VITE_SUPABASE_URL }],
  ['preview points to production', { ...staging, FINVIANT_SUPABASE_PROJECT_REF: productionRef, VITE_SUPABASE_URL: production.VITE_SUPABASE_URL }],
  ['URL and project disagree', { ...production, VITE_SUPABASE_URL: staging.VITE_SUPABASE_URL }],
  ['insecure URL', { ...production, VITE_SUPABASE_URL: `http://${productionRef}.supabase.co` }],
  ['missing browser key', { ...production, VITE_SUPABASE_PUBLISHABLE_KEY: '' }],
  ['secret browser key', { ...production, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_use' }],
  ['legacy key is not a publishable key', { ...production, VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.legacy.signature' }],
  ['another privileged public variable', { ...production, VITE_SUPABASE_SERVICE_ROLE_KEY: 'redacted-fixture' }],
  ['secret value under innocent public name', { ...production, VITE_OTHER: 'sk_live_fixture' }],
  ['customer delivery enabled on staging', { ...staging, VITE_ENABLE_CUSTOMER_ACTIONS: 'true' }],
  ['general customer actions with private beta email', { ...staging, VERCEL_GIT_COMMIT_REF: PRIVATE_BETA_GIT_REF, VITE_ENABLE_CUSTOMER_ACTIONS: 'true', VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true' }],
  ['private beta email on another preview branch', { ...staging, VERCEL_GIT_COMMIT_REF: 'feature/other-preview', VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true' }],
  ['private beta email without an explicit branch', { ...staging, VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true' }],
  ['private beta email in hosted development', { ...staging, VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: PRIVATE_BETA_GIT_REF, VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true' }],
  ['private beta email in production', { ...production, VITE_ENABLE_PRIVATE_BETA_EMAIL: 'true' }],
  ['production release branch missing', { ...production, FINVIANT_PRODUCTION_GIT_REF: undefined }],
  ['production built from feature branch', { ...production, VERCEL_GIT_COMMIT_REF: 'feature/velnu-stage1' }],
]
for (const [name, env] of cases) test(`rejects ${name}`, () => assert.throws(() => validateDeploymentEnvironment(env)))

test('CLI fails closed and does not print a rejected credential', () => {
  const secret = 'sb_secret_sensitive_test_fixture'
  const result = spawnSync(process.execPath, ['scripts/check-deployment.mjs'], {
    encoding: 'utf8', env: { ...production, VITE_SUPABASE_PUBLISHABLE_KEY: secret },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Deployment blocked/)
  assert.ok(!(result.stdout + result.stderr).includes(secret))
})

test('all deployed routes opt out of search indexing and cached archives', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  const catchAll = config.headers.find(({ source }) => source === '/(.*)')
  const robots = catchAll?.headers.find(({ key }) => key.toLowerCase() === 'x-robots-tag')
  assert.equal(robots?.value, 'noindex, nofollow, noarchive')
})

test('integration review disables automatic deployment without changing the beta branch', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  assert.equal(config.git.deploymentEnabled['review/calendar-resilience-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/payment-recovery-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/payment-recovery-integration-20261111'], false)
  assert.equal(config.git.deploymentEnabled[INTEGRATION_REVIEW_GIT_REF], false)
  assert.equal(config.git.deploymentEnabled[MIGRATION_REVIEW_GIT_REF], false)
  assert.equal(config.git.deploymentEnabled['review/next-steps-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/reminders-release-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/rls-initplans-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/worker-health-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/document-conveniences-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/auth-storage-acceptance-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/provider-burst-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/recovery-operations-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/recurring-owner-controls-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/jobs-directory-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/owner-archive-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/jobs-management-pagination-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/capacity-soak-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/management-queue-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/job-customer-search-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/queue-catchup-20261110'], false)
  assert.equal(config.git.deploymentEnabled['review/reminder-scan-20261110'], false)
  assert.notEqual(config.git.deploymentEnabled[PRIVATE_BETA_GIT_REF], false)
  assert.equal(validateDeploymentEnvironment({ VERCEL_GIT_COMMIT_REF: INTEGRATION_REVIEW_GIT_REF }).checked, false)
})
