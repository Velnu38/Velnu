import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
const recovery = await readFile(new URL('../../public/startup-recovery.js', import.meta.url), 'utf8')
const originalUrl = 'https://finviant.com/?invite=private-invite&next=%2Fplans&access_token=private-auth#auth-fragment'

function workspace({ url = originalUrl, online = true, deployed = true, historyThrows = false } = {}) {
  const dom = new JSDOM(html, { url })
  const { document } = dom.window
  const entry = document.querySelector('script[type="module"][src]')
  if (deployed) entry.src = '/assets/index-current.js'
  const timers = new Map()
  const navigations = []
  const historyCalls = []
  const historyStates = []
  const storageAccess = []
  const requests = []
  let timerId = 0
  const window = {
    navigator: { onLine: online },
    location: { href: url, origin: new URL(url).origin, replace: value => navigations.push(value) },
    history: { replaceState(state, title, value) {
      historyCalls.push(value)
      historyStates.push(state)
      if (historyThrows) throw new Error('History unavailable')
      window.location.href = new URL(value, window.location.href).href
    } },
    addEventListener: dom.window.addEventListener.bind(dom.window),
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId },
    clearTimeout(id) { timers.delete(id) },
    fetch(...args) { requests.push(args); return Promise.reject(new Error('Unexpected automatic request')) },
  }
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
    get() { storageAccess.push(name); throw new Error('Storage unavailable') },
  })
  vm.runInNewContext(recovery, { window, document, URL, Date, AbortController })
  return {
    dom, window, document, entry, timers, navigations, historyCalls, historyStates, storageAccess, requests,
    count(delay) { return [...timers.values()].filter(timer => timer.delay === delay).length },
    fire(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) {
        timers.delete(id)
        timer.callback()
      }
    },
    ready() { dom.window.dispatchEvent(new dom.window.Event('finviant:app-mounted')) },
    fail(message) { dom.window.dispatchEvent(new dom.window.CustomEvent('finviant:startup-error', { detail: new Error(message) })) },
    preload(message) {
      const event = new dom.window.Event('vite:preloadError', { cancelable: true })
      event.payload = new Error(message)
      dom.window.dispatchEvent(event)
    },
    entryFails() { entry.dispatchEvent(new dom.window.Event('error')) },
  }
}

function assertPreserved(value) {
  const actual = new URL(value)
  const original = new URL(originalUrl)
  assert.equal(actual.origin, original.origin)
  assert.equal(actual.pathname, original.pathname)
  for (const key of ['invite', 'next', 'access_token']) assert.equal(actual.searchParams.get(key), original.searchParams.get(key))
  assert.equal(actual.hash, original.hash)
  return actual
}

test('a deployed entry failure queues one delayed refresh and preserves invitation/auth URLs', () => {
  const app = workspace()
  try {
    app.entryFails()
    app.entryFails()
    app.preload('Failed to fetch dynamically imported module: https://finviant.com/assets/App-old.js')
    assert.equal(app.count(500), 1)
    assert.equal(app.count(15000), 0)
    assert.deepEqual(app.navigations, [], 'recovery waits before navigating')
    app.fire(500)
    assert.equal(app.navigations.length, 1)
    const destination = assertPreserved(app.navigations[0])
    assert.equal(destination.searchParams.get('fv_boot_retry'), '1')
    assert.match(destination.searchParams.get('startup_retry'), /^\d+$/)
    app.entryFails()
    app.fire(500)
    assert.equal(app.navigations.length, 1, 'duplicate errors never queue another refresh')
    assert.deepEqual(app.storageAccess, [])
    assert.deepEqual(app.requests, [])
  } finally { app.dom.window.close() }
})

test('the URL marker prevents another automatic refresh even when storage is blocked', () => {
  for (const marker of ['1', '0', '']) {
    const app = workspace({ url: originalUrl.replace('#', '&fv_boot_retry=' + marker + '#') })
    try {
      app.entryFails()
      app.preload('Unable to preload CSS for https://finviant.com/assets/old.css')
      app.fire(15000)
      app.fire(500)
      assert.deepEqual(app.navigations, [])
      assert.deepEqual(app.storageAccess, [])
      assert.equal(app.document.getElementById('startup-recovery').hidden, false)
    } finally { app.dom.window.close() }
  }
})

test('recognized browser module/CSS download failures and startup timeout can recover', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://finviant.com/assets/App.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/App.css',
    null,
  ]) {
    const app = workspace()
    try {
      if (message) app.fail(message)
      else app.fire(15000)
      assert.equal(app.count(500), 1, String(message))
      app.fire(500)
      assert.equal(app.navigations.length, 1, String(message))
    } finally { app.dom.window.close() }
  }
})

test('offline startup and a connection lost during the delay never auto-navigate', () => {
  for (const initiallyOffline of [true, false]) {
    const app = workspace({ online: !initiallyOffline })
    try {
      app.entryFails()
      app.window.navigator.onLine = false
      app.fire(15000)
      app.fire(500)
      assert.deepEqual(app.navigations, [])
      assert.equal(app.document.getElementById('startup-recovery').hidden, false)
    } finally { app.dom.window.close() }
  }
})

test('mounted workspaces and forms rendered before the mounted event are preserved', () => {
  for (const timing of ['mounted', 'form-before-error', 'form-during-delay']) {
    const app = workspace()
    try {
      const renderForm = () => { app.document.getElementById('root').innerHTML = '<form><input value="Unsaved invoice"></form>' }
      if (timing === 'mounted') { renderForm(); app.ready() }
      if (timing === 'form-before-error') renderForm()
      app.fail('Failed to fetch dynamically imported module')
      if (timing === 'form-during-delay') renderForm()
      app.fire(15000)
      app.fire(500)
      assert.deepEqual(app.navigations, [], timing)
      assert.equal(app.document.querySelector('input').value, 'Unsaved invoice')
    } finally { app.dom.window.close() }
  }
})

test('late successful startup cancels queued refresh and only removes recovery parameters', () => {
  const app = workspace()
  try {
    app.entryFails()
    assert.equal(app.count(500), 1)
    app.window.location.href = originalUrl.replace('#', '&fv_boot_retry=1&startup_retry=123#')
    const navigationState = { view: 'invoices', position: 3 }
    app.window.history.state = navigationState
    app.ready()
    assert.equal(app.timers.size, 0)
    assert.equal(app.document.getElementById('startup-recovery').hidden, true)
    assert.equal(app.historyCalls.length, 1)
    assert.equal(app.historyStates[0], navigationState, 'URL cleanup preserves existing navigation state')
    const cleaned = assertPreserved(app.historyCalls[0])
    assert.equal(cleaned.searchParams.has('fv_boot_retry'), false)
    assert.equal(cleaned.searchParams.has('startup_retry'), false)
    app.fire(500)
    assert.deepEqual(app.navigations, [])
  } finally { app.dom.window.close() }
})

test('blocked history access does not interrupt successful startup or cancel protection', () => {
  const app = workspace({ url: originalUrl.replace('#', '&fv_boot_retry=1#'), historyThrows: true })
  try {
    assert.doesNotThrow(() => app.ready())
    app.fire(15000)
    app.fail('Failed to fetch dynamically imported module')
    app.fire(500)
    assert.deepEqual(app.navigations, [])
    assert.equal(app.timers.size, 0)
    assert.deepEqual(app.storageAccess, [])
  } finally { app.dom.window.close() }
})

test('non-download runtime errors suppress both startup-timeout and queued recovery', () => {
  for (const queued of [false, true]) {
    const app = workspace()
    try {
      if (queued) app.entryFails()
      app.fail('Cannot read properties of undefined')
      app.fire(15000)
      app.fire(500)
      assert.deepEqual(app.navigations, [])
      assert.equal(app.count(500), 0)
      assert.equal(app.document.getElementById('startup-recovery').hidden, false)
    } finally { app.dom.window.close() }
  }
})

test('source fixtures and cross-origin module entries do not trigger deployed-app retries', () => {
  for (const entry of ['/src/main.tsx', 'https://external.example/assets/main.js']) {
    const app = workspace({ deployed: false })
    try {
      app.entry.src = entry
      app.entryFails()
      app.fail('Failed to fetch dynamically imported module')
      app.fire(15000)
      app.fire(500)
      assert.deepEqual(app.navigations, [])
    } finally { app.dom.window.close() }
  }
})

test('manual reload resets the one-retry marker while preserving document/account links', () => {
  const app = workspace({ url: originalUrl.replace('#', '&fv_boot_retry=1&startup_retry=123#') })
  try {
    app.document.getElementById('startup-reload').click()
    assert.equal(app.navigations.length, 1)
    const destination = assertPreserved(app.navigations[0])
    assert.equal(destination.searchParams.has('fv_boot_retry'), false)
    assert.match(destination.searchParams.get('startup_retry'), /^\d+$/)
    assert.deepEqual(app.storageAccess, [])
  } finally { app.dom.window.close() }
})
