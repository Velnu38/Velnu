import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
const recovery = await readFile(new URL('../../public/startup-recovery.js', import.meta.url), 'utf8')

function workspace() {
  const navigationErrors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => navigationErrors.push(error))
  const dom = new JSDOM(html, { url: 'https://finviant.com/?next=plans#test', runScripts: 'outside-only', virtualConsole })
  const timers = new Map()
  let timerId = 0
  dom.window.setTimeout = callback => { timers.set(++timerId, callback); return timerId }
  dom.window.clearTimeout = id => timers.delete(id)
  dom.window.eval(recovery)
  const { window } = dom
  return {
    dom, window, timers, navigationErrors,
    panel: window.document.getElementById('startup-recovery'),
    ready() { window.dispatchEvent(new window.Event('finviant:app-mounted')) },
  }
}

test('HTML provides readable loading and reload guidance before app JavaScript', () => {
  const app = workspace()
  assert.match(app.window.document.getElementById('root').textContent, /Opening your workspace/)
  assert.match(app.window.document.getElementById('root').textContent, /reload this browser tab/)
  assert.equal(app.panel.hidden, true)
  app.dom.window.close()
})

test('a missing entry script offers recovery without navigating automatically', () => {
  const app = workspace()
  const script = app.window.document.querySelector('script[type="module"]')
  script.dispatchEvent(new app.window.Event('error'))
  assert.equal(app.panel.hidden, false)
  assert.equal(app.window.document.getElementById('startup-loading').hidden, true)
  assert.equal(app.window.document.getElementById('startup-dismiss').hidden, true)
  assert.equal(app.navigationErrors.length, 0)
  app.window.document.getElementById('startup-reload').click()
  assert.equal(app.navigationErrors.length, 1, 'reload only occurs after the user chooses it')
  app.dom.window.close()
})

test('a rejected app bootstrap offers recovery without displaying raw error details', () => {
  const app = workspace()
  app.window.dispatchEvent(new app.window.CustomEvent('finviant:startup-error', { detail: 'private-token-value' }))
  assert.equal(app.panel.hidden, false)
  assert.doesNotMatch(app.panel.textContent, /private-token-value/)
  assert.equal(app.navigationErrors.length, 0)
  app.dom.window.close()
})

test('a stalled startup exposes recovery and a successful mount clears its timer', () => {
  const app = workspace()
  for (const callback of app.timers.values()) callback()
  assert.equal(app.panel.hidden, false)
  app.ready()
  assert.equal(app.panel.hidden, true)
  assert.equal(app.timers.size, 0)
  assert.equal(app.navigationErrors.length, 0)
  app.dom.window.close()
})

test('a failed lazy page preserves open edits and lets the user keep working', () => {
  const app = workspace()
  app.window.document.getElementById('root').innerHTML = '<label>Invoice description<input value="Unsaved work"></label>'
  app.ready()
  const event = new app.window.Event('vite:preloadError', { cancelable: true })
  app.window.dispatchEvent(event)
  assert.equal(app.panel.hidden, false)
  assert.match(app.panel.textContent, /Save any open edits/)
  assert.equal(app.window.document.getElementById('startup-dismiss').hidden, false)
  assert.equal(app.window.document.querySelector('input').value, 'Unsaved work')
  assert.equal(event.defaultPrevented, false, 'keep the lazy import rejection available to the React boundary')
  app.window.document.getElementById('startup-dismiss').click()
  assert.equal(app.panel.hidden, true)
  assert.equal(app.window.document.querySelector('input').value, 'Unsaved work')
  assert.equal(app.navigationErrors.length, 0)
  app.dom.window.close()
})

test('unrelated extension errors do not interrupt startup', () => {
  const app = workspace()
  app.window.dispatchEvent(new app.window.ErrorEvent('error', { filename: 'chrome-extension://example/content.js', message: 'extension failed' }))
  assert.equal(app.panel.hidden, true)
  app.dom.window.close()
})
