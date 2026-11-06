import assert from 'node:assert/strict'
import test from 'node:test'
import { readReleaseQaTarget } from '../../scripts/qa/release-target.mjs'

const env = {
  FINVIANT_QA_PREVIEW_URL: 'https://finviant-qa-fixture.vercel.app/',
  FINVIANT_QA_SUPABASE_URL: 'https://qaqaqaqaqaqaqaqaqaqa.supabase.co',
  FINVIANT_QA_PREVIEW_COMMIT: 'a'.repeat(40),
  FINVIANT_QA_BUSINESS: 'Finviant QA Primary',
  FINVIANT_QA_OUTSIDER_BUSINESS: 'Finviant QA Independent',
  FINVIANT_QA_VERCEL_BYPASS_SECRET: 'bypass-test-fixture',
}
for (const role of ['OWNER', 'OFFICE', 'TECHNICIAN', 'OUTSIDER']) {
  env['FINVIANT_QA_' + role + '_EMAIL'] = role.toLowerCase() + '@example.test'
  env['FINVIANT_QA_' + role + '_PASSWORD'] = 'qa-password-fixture'
}

test('hosted QA accepts separate workspaces and four distinct test identities', () => {
  const target = readReleaseQaTarget(env)
  assert.equal(target.preview, 'https://finviant-qa-fixture.vercel.app')
  assert.equal(target.database, env.FINVIANT_QA_SUPABASE_URL)
  assert.equal(target.commit, env.FINVIANT_QA_PREVIEW_COMMIT)
  assert.deepEqual(Object.keys(target.accounts), ['owner', 'office', 'technician', 'outsider'])
})

for (const [name, overrides] of [
  ['the live domain', { FINVIANT_QA_PREVIEW_URL: 'https://finviant.com' }],
  ['a preview path', { FINVIANT_QA_PREVIEW_URL: 'https://finviant-qa-fixture.vercel.app/auth' }],
  ['URL credentials', { FINVIANT_QA_PREVIEW_URL: 'https://user:secret@finviant-qa-fixture.vercel.app' }],
  ['an insecure database origin', { FINVIANT_QA_SUPABASE_URL: 'http://qaqaqaqaqaqaqaqaqaqa.supabase.co' }],
  ['the shared staging database', { FINVIANT_QA_SUPABASE_URL: 'https://xvybcmyoblfgzokaifsx.supabase.co' }],
  ['the production database', { FINVIANT_QA_SUPABASE_URL: 'https://qusmeexjbwphoezlcmie.supabase.co' }],
  ['an abbreviated CI revision', { GITHUB_SHA: 'abc123' }],
  ['a missing bypass credential', { FINVIANT_QA_VERCEL_BYPASS_SECRET: '' }],
  ['a missing staff credential', { FINVIANT_QA_OFFICE_PASSWORD: '' }],
  ['the same tenant for the outsider', { FINVIANT_QA_OUTSIDER_BUSINESS: env.FINVIANT_QA_BUSINESS }],
  ['duplicate logins with different casing', { FINVIANT_QA_OUTSIDER_EMAIL: 'Owner@example.test' }],
]) {
  test('hosted QA rejects ' + name, () => assert.throws(() => readReleaseQaTarget({ ...env, ...overrides })))
}
