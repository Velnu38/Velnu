import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLandingRoute } from '../../src/lib/landingRoute.ts'

test('the public homepage is independent of session and allows marketing anchors and reload parameters', () => {
  for (const url of ['/', '/#features', '/#ai-assistant', '/?utm_source=email', '/?startup_retry=1', '/index.html', '/services']) {
    const parsed = new URL(url, 'https://finviant.com')
    assert.equal(isLandingRoute(parsed.pathname, parsed.search, parsed.hash), true, url)
  }
})

test('app, customer, invitation, recovery and OAuth returns never become a landing page', () => {
  for (const url of [
    '/auth?mode=signin', '/auth?mode=signup', '/plans', '/admin', '/legal', '/install',
    '/?view=dashboard', '/?view=settings&section=calendar&calendar=connected',
    '/?business_card=demo', '/?business_card=', '/?business_card=private-token',
    '/?approval=private-token', '/?document_share=private-token', '/?booking=private-token',
    '/?invite=invitation', '/?recovery=1', '/?code=auth-code', '/?error=access_denied',
    '/#access_token=test-token', '/#refresh_token=test-token', '/#type=recovery',
    '/#error=access_denied', '/#error_code=otp_expired', '/services?booking=private-token',
    '/?next=plans', '/?mode=signup',
  ]) {
    const parsed = new URL(url, 'https://finviant.com')
    assert.equal(isLandingRoute(parsed.pathname, parsed.search, parsed.hash), false, url)
  }
})
