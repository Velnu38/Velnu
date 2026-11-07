import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getStartupTeamInvitation } from '../../src/lib/teamInvitationStartup.ts'

const invitation = 'a'.repeat(64)
const previousInvitation = 'b'.repeat(64)
const storageKey = 'finviant-team-invitation'

function browser(href: string, stored: string | null = null) {
  let currentUrl = new URL(href)
  let currentStored = stored
  const writes: [string, string][] = []
  const environment = {
    getStorage: () => ({
      getItem: (key: string) => { assert.equal(key, storageKey); return currentStored },
      setItem: (key: string, value: string) => { writes.push([key, value]); currentStored = value },
    }),
    replaceUrl: (url: string) => { currentUrl = new URL(url, currentUrl) },
  }
  return { environment, writes, query: () => currentUrl.searchParams, href: () => currentUrl.href }
}

test('a valid URL invitation is persisted before its URL is cleaned up', () => {
  const page = browser(`https://finviant.com/?invite=${invitation}`, previousInvitation)
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation)
  assert.deepEqual(page.writes, [[storageKey, invitation]])
  assert.equal(page.href(), 'https://finviant.com/auth')
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation, 'reload retains the persisted invitation')
})

test('blocked storage access cannot stop a normal visit from starting', () => {
  const page = browser('https://finviant.com/')
  page.environment.getStorage = () => { throw new DOMException('Storage is blocked', 'SecurityError') }
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), null)
  assert.equal(page.href(), 'https://finviant.com/')
})

test('a denied invitation read cannot stop a normal visit from starting', () => {
  const page = browser('https://finviant.com/auth')
  page.environment.getStorage = () => ({
    getItem: () => { throw new DOMException('Storage is blocked', 'SecurityError') },
    setItem: () => { assert.fail('A normal visit must not write invitation storage') },
  })
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), null)
})

test('a valid URL invitation survives unavailable storage and stays reloadable', () => {
  const href = `https://finviant.com/?invite=${invitation}`
  const page = browser(href)
  page.environment.getStorage = () => { throw new DOMException('Storage is blocked', 'SecurityError') }
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation)
  assert.equal(page.href(), href)
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation, 'reload can still read the URL')
})

test('a denied invitation write preserves the valid URL and in-memory token', () => {
  const href = `https://finviant.com/auth?invite=${invitation}`
  const page = browser(href)
  page.environment.getStorage = () => ({
    getItem: () => previousInvitation,
    setItem: () => { throw new DOMException('Storage is full', 'QuotaExceededError') },
  })
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation)
  assert.equal(page.href(), href)
})

test('invalid URL and stored tokens never force the invitation screen', () => {
  for (const invalid of ['', 'invalid', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) {
    const page = browser(`https://finviant.com/?invite=${invalid}`, invalid)
    assert.equal(getStartupTeamInvitation(page.query(), page.environment), null)
    assert.deepEqual(page.writes, [])
    assert.equal(new URL(page.href()).searchParams.get('invite'), invalid)
  }
})

test('a valid stored token is accepted when the URL contains no valid invitation', () => {
  for (const query of ['', '?invite=invalid']) {
    const page = browser(`https://finviant.com/auth${query}`, previousInvitation)
    assert.equal(getStartupTeamInvitation(page.query(), page.environment), previousInvitation)
    assert.deepEqual(page.writes, [])
  }
})

test('a history error after persistence leaves the valid invitation available', () => {
  const page = browser(`https://finviant.com/?invite=${invitation}`)
  page.environment.replaceUrl = () => { throw new DOMException('History unavailable', 'SecurityError') }
  assert.equal(getStartupTeamInvitation(page.query(), page.environment), invitation)
  assert.deepEqual(page.writes, [[storageKey, invitation]])
  assert.equal(page.query().get('invite'), invitation)
})
