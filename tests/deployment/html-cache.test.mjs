import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
const documentPaths = new Set(['/', '/index.html', ...config.rewrites.filter(route => route.destination === '/index.html').map(route => route.source)])

test('Square payment returns reach the application while unknown asset routes keep their normal 404', () => {
  assert.ok(config.rewrites.some(route => route.source === '/square-return' && route.destination === '/index.html'))
  assert.ok(!config.rewrites.some(route => ['/:path*', '/(.*)'].includes(route.source)), 'do not hide missing build assets behind SPA HTML')
})

test('every application document and the stable recovery script must load a fresh release', () => {
  for (const path of [...documentPaths, '/startup-recovery.js']) {
    const headers = Object.fromEntries(config.headers.filter(rule => rule.source === path).flatMap(rule => rule.headers).map(header => [header.key.toLowerCase(), header.value]))
    assert.match(headers['cache-control'] || '', /\bprivate\b/, `${path} is private`)
    assert.match(headers['cache-control'] || '', /\bno-store\b/, `${path} cannot reuse old HTML or recovery code`)
    assert.equal(headers['cdn-cache-control'], 'no-store', `${path} is not cached by an intermediary CDN`)
    assert.equal(headers['vercel-cdn-cache-control'], 'no-store', `${path} is not cached at Vercel`)
  }
})

test('document cache policy leaves content-hashed asset caching and security headers intact', () => {
  const general = config.headers.find(rule => rule.source === '/(.*)')
  assert.equal(general.headers.find(header => header.key === 'X-Frame-Options').value, 'DENY')
  assert.equal(general.headers.find(header => header.key === 'X-Content-Type-Options').value, 'nosniff')
  assert.ok(!general.headers.some(header => /cache-control/i.test(header.key)), 'do not force every app file to download on each visit')
})
