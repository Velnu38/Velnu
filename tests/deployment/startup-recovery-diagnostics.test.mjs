import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
const recovery = await readFile(new URL('../../public/startup-recovery.js', import.meta.url), 'utf8')

function workspace(respond = () => response()) {
  const navigationErrors = []
  const requests = []
  const storageAccess = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => navigationErrors.push(error))
  const dom = new JSDOM(html, {
    url: 'https://finviant.com/?invite=private-invite-token#private-auth-fragment',
    runScripts: 'outside-only', virtualConsole,
  })
  const { window } = dom
  const timers = new Map()
  let timerId = 0
  window.setTimeout = callback => { timers.set(++timerId, callback); return timerId }
  window.clearTimeout = id => timers.delete(id)
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, name, {
      get() { storageAccess.push(name); throw new Error('Recovery must not touch stored sessions') },
    })
  }
  window.fetch = async (url, options) => {
    requests.push({ url, options })
    return respond(url, options)
  }
  window.eval(recovery)
  return {
    dom, window, timers, requests, storageAccess, navigationErrors,
    diagnostic: window.document.getElementById('startup-diagnostic'),
    check: window.document.getElementById('startup-check'),
    fail(detail) { window.dispatchEvent(new window.CustomEvent('finviant:startup-error', { detail })) },
    resource(tag, attribute, url, rel) {
      const element = window.document.createElement(tag)
      element.setAttribute(attribute, url)
      if (rel) element.rel = rel
      window.document.head.appendChild(element)
      return element
    },
  }
}

function response(status = 200, contentType = 'application/javascript', type = 'basic') {
  return { status, ok: status >= 200 && status < 300, type, headers: { get: () => contentType } }
}

async function finishCheck(app) {
  app.check.click()
  await setImmediate()
  assert.equal(app.check.disabled, false, 'the loading check can be run again after completing')
}

test('captured browser errors redact URLs, emails, provider tokens, and long secrets', () => {
  const app = workspace()
  try {
    app.fail(new app.window.TypeError('Failed to fetch https://finviant.com/assets/App.js?token=private-token#auth user@example.com sb_secret_shortvalue sb_publishable_shortvalue sk-testvalue re_testvalue abcdefghijklmnopqrstuvwxyz0123456789'))
    const text = app.diagnostic.textContent
    assert.equal(app.diagnostic.hidden, false)
    assert.match(text, /TypeError: Failed to fetch \[resource\]/)
    assert.match(text, /\[email\]/)
    assert.match(text, /\[redacted\]/)
    assert.doesNotMatch(text, /https?:|private-token|user@example|sb_secret_|sb_publishable_|sk-testvalue|re_testvalue|abcdefghijklmnopqrstuvwxyz/)
    assert.doesNotMatch(text, /private-invite-token|private-auth-fragment/)
    assert.equal(app.requests.length, 0, 'displaying a diagnostic never uploads it')
    assert.deepEqual(app.storageAccess, [])
  } finally { app.dom.window.close() }
})

test('diagnostic messages are bounded text and do not render error HTML or stacks', () => {
  const app = workspace()
  try {
    const error = new app.window.Error('<img src=x onerror=alert(1)> ' + 'browser failure '.repeat(40))
    error.stack = 'private-stack-content'
    app.fail(error)
    assert.match(app.diagnostic.textContent, /<img src=x/)
    assert.equal(app.diagnostic.querySelector('img'), null)
    assert.ok(app.diagnostic.textContent.length <= 'Loading check: '.length + 280)
    assert.doesNotMatch(app.diagnostic.textContent, /private-stack-content/)
    app.fail('private-string-payload')
    assert.doesNotMatch(app.diagnostic.textContent, /private-string-payload/)
  } finally { app.dom.window.close() }
})

test('loading check distinguishes protected, missing, wrong-type, HTTP, and network failures', async () => {
  const cases = [
    ['healthy.js', response(200, 'application/javascript; charset=utf-8'), 'OK'],
    ['healthy.css', response(200, 'text/css; charset=utf-8'), 'OK'],
    ['opaque.js', response(0, '', 'opaqueredirect'), 'ACCESS_REQUIRED'],
    ['redirected.js', response(302, 'text/html'), 'ACCESS_REQUIRED'],
    ['unauthorized.js', response(401), 'ACCESS_DENIED'],
    ['forbidden.css', response(403), 'ACCESS_DENIED'],
    ['missing.js', response(404), 'MISSING_FILE'],
    ['html.js', response(200, 'text/html'), 'WRONG_FILE_TYPE'],
    ['unavailable.js', response(503), 'HTTP_503'],
    ['offline.js', null, 'NETWORK_ERROR'],
  ]
  const app = workspace(url => {
    const name = new URL(url, 'https://finviant.com').pathname.split('/').pop()
    const result = cases.find(([file]) => file === name)[1]
    if (!result) throw new Error('network unavailable')
    return result
  })
  try {
    for (const [name] of cases) app.resource('script', 'src', '/assets/' + name)
    await finishCheck(app)
    assert.equal(app.requests.length, cases.length)
    for (const [name, , code] of cases) assert.ok(app.diagnostic.textContent.includes(name + ': ' + code))
    for (const { url, options } of app.requests) {
      assert.match(url, /^\/assets\/[\w.-]+\.(js|css)\?fv_load_check=\d+$/)
      assert.equal(options.method, 'HEAD')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.redirect, 'manual')
      assert.equal(options.credentials, 'same-origin')
    }
    assert.equal(app.timers.size, 1, 'all probe abort timers are cleared; only startup timer remains')
    assert.deepEqual(app.storageAccess, [])
    assert.equal(app.navigationErrors.length, 0)
  } finally { app.dom.window.close() }
})

test('loading check ignores external and unsafe paths and strips private query/hash data', async () => {
  const app = workspace()
  try {
    app.resource('script', 'src', '/assets/entry-ab.cd.js?token=short-private-token#private-hash')
    app.resource('link', 'href', '/assets/entry-ab.cd.js?duplicate=private-value', 'modulepreload')
    app.resource('link', 'href', '/assets/vendor.js?access_token=secret', 'modulepreload')
    app.resource('link', 'href', '/assets/site.css?private=secret#fragment', 'stylesheet')
    app.resource('script', 'src', 'https://external.example/assets/tracker.js?private=secret')
    app.resource('script', 'src', '//external.example/assets/tracker.js')
    app.resource('script', 'src', '/api/private.js?token=secret')
    app.resource('script', 'src', '/assets/nested/private.js')
    app.resource('script', 'src', '/assets/source.ts')
    app.resource('script', 'src', '/assets/unsafe%2Fprivate.js')
    app.resource('link', 'href', '/assets/not-a-style.js', 'icon')
    await finishCheck(app)
    assert.deepEqual(app.requests.map(({ url }) => new URL(url, 'https://finviant.com').pathname), [
      '/assets/entry-ab.cd.js', '/assets/vendor.js', '/assets/site.css',
    ])
    const output = JSON.stringify(app.requests) + app.diagnostic.textContent
    assert.doesNotMatch(output, /short-private-token|private-hash|private-value|access_token|external\.example|\/api\/|nested|source\.ts|unsafe|private-invite-token|private-auth-fragment/)
    assert.equal(app.navigationErrors.length, 0)
  } finally { app.dom.window.close() }
})

test('failure events and timeout perform no automatic network, navigation, or session changes', () => {
  const app = workspace()
  try {
    app.window.document.getElementById('root').innerHTML += '<input value="Unsaved invoice">'
    app.fail(new app.window.Error('A module could not load'))
    const preload = new app.window.Event('vite:preloadError', { cancelable: true })
    preload.payload = new app.window.Error('A lazy page could not load')
    app.window.dispatchEvent(preload)
    for (const callback of app.timers.values()) callback()
    assert.equal(app.window.document.getElementById('startup-loading').hidden, false)
    assert.equal(app.window.document.querySelector('input').value, 'Unsaved invoice')
    assert.equal(preload.defaultPrevented, false)
    assert.deepEqual(app.requests, [])
    assert.deepEqual(app.storageAccess, [])
    assert.deepEqual(app.navigationErrors, [])
    assert.equal(app.window.location.href, 'https://finviant.com/?invite=private-invite-token#private-auth-fragment')
  } finally { app.dom.window.close() }
})

test('a source page without built assets reports that there are no safe files to probe', async () => {
  const app = workspace()
  try {
    await finishCheck(app)
    assert.match(app.diagnostic.textContent, /No app files were found in this page/)
    assert.deepEqual(app.requests, [])
    assert.equal(app.navigationErrors.length, 0)
  } finally { app.dom.window.close() }
})
