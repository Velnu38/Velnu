import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { STAGING_PROJECT_REF, validateDeploymentEnvironment } from '../../scripts/check-deployment.mjs'

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

const cases = [
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
