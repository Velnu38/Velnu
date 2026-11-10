import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const source = readFileSync(new URL('../../.github/workflows/full-test-checks.yml', import.meta.url), 'utf8')
const suites = /needs: \[([^\]]+)\]/.exec(source)[1].split(',').map(name => name.trim())
const gate = /node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/.exec(source)[1].replace(/^          /gm, '')
const run = results => spawnSync(process.execPath, ['--input-type=module', '-e', gate], {
  encoding: 'utf8', env: { SUITE_RESULTS: JSON.stringify(results) },
})
const successes = () => Object.fromEntries(suites.map(name => [name, { result: 'success' }]))

test('the preinstalled WebKit image matches the locked Playwright version', () => {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).devDependencies['@playwright/test']
  const imageVersion = /container: mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble/.exec(source)?.[1]
  assert.equal(imageVersion, version, 'Browser image and test package must use identical revisions')
})

test('release gate accepts all declared suites only after success', () => {
  assert.ok(suites.includes('migrations') && suites.includes('desktop-and-scheduling'))
  assert.equal(run(successes()).status, 0)
  assert.notEqual(run({}).status, 0)
})

test('failed, canceled, skipped or missing results block the aggregate release check', () => {
  for (const suite of suites) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const results = successes()
      results[suite] = { result }
      const receipt = run(results)
      assert.notEqual(receipt.status, 0, `${suite}=${result} must block release`)
      assert.match(receipt.stderr, new RegExp(suite))
    }
  }
})
