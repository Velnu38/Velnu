import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://finviant.test/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'history', 'location', 'localStorage', 'sessionStorage']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { act } = React, { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
let root, supabase, sequence = 0, authReads = 0, rpcCalls = [], rememberedAccount = false
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 30)))
try {
  ;({ supabase } = await server.ssrLoadModule('/src/lib/supabase.ts'))
  const account = { access_token: 'fixture', user: { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.test' } }
  supabase.auth.getSession = async () => { authReads++; return { data: { session: rememberedAccount ? account : null }, error: null } }
  supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } })
  supabase.rpc = async name => { rpcCalls.push(name); assert.equal(name, 'get_private_beta_access'); return { data: { allowed: false }, error: null } }
  async function open(url, remembered = false) {
    if (root) await act(async () => root.unmount())
    history.replaceState({}, '', url)
    authReads = 0; rpcCalls = []; rememberedAccount = remembered
    const { default: App } = await server.ssrLoadModule('/src/App.tsx?entry=' + sequence++)
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(React.createElement(App)))
    await tick(); await tick()
  }
  for (const url of ['/', '/?startup_retry=1#features', '/services']) {
    for (const remembered of [false, true]) {
      await open(url, remembered)
      assert.match(document.querySelector('h1').textContent, /Your business\.Connected fromstart to finish/)
      assert.equal(authReads, 0, 'public landing must not wait for session resolution')
      assert.deepEqual(rpcCalls, [], 'public landing never queries private account access')
      assert.equal(document.querySelector('.marketing-signin').getAttribute('href'), '/auth?mode=signin')
      assert.equal(document.querySelector('.fp-entry .fp-action').getAttribute('href'), '/auth?mode=signup')
      assert.ok([...document.querySelectorAll('a')].some(a => a.textContent === 'Open workspace' && a.getAttribute('href') === '/?view=dashboard'))
    }
  }
  await open('/')
  await act(async()=>document.querySelector('[data-stage="5"]').click())
  assert.match(document.getElementById('fp-stagecopy').textContent,/owner records/)
  assert.equal(document.getElementById('fp-play').getAttribute('aria-pressed'),'false')
  await act(async()=>document.querySelector('[data-outcome="1"]').click())
  assert.match(document.getElementById('fp-outcome-title').textContent,/whole office/)
  await act(async()=>document.querySelector('[data-worker="Sam"]').click())
  assert.equal(document.getElementById('fp-crew-summary').textContent,'Assigned: Jordan + Sam')
  assert.ok(document.querySelector('input[disabled]').disabled)
  assert.equal(authReads,0);assert.deepEqual(rpcCalls,[])
  // Even an indefinitely pending session cannot hide the public homepage.
  supabase.auth.getSession = () => { authReads++; return new Promise(() => {}) }
  await open('/')
  assert.ok(document.querySelector('.marketing-page')); assert.equal(authReads, 0)
  supabase.auth.getSession = async () => { authReads++; return { data: { session: rememberedAccount ? account : null }, error: null } }
  await open('/auth?mode=signin')
  assert.equal(document.querySelector('.auth-card h2').textContent, 'Sign in')
  await open('/auth?mode=signup')
  assert.equal(document.querySelector('.auth-card h2').textContent, 'Create your account')
  await open('/?view=dashboard')
  assert.equal(document.querySelector('.auth-card h2').textContent, 'Sign in')
  await open('/?view=dashboard', true)
  assert.match(document.querySelector('h1').textContent, /Private beta access required/)
  assert.deepEqual(rpcCalls, ['get_private_beta_access'], 'workspace remains behind its existing beta gate')
  console.log('PASS public homepage with/without saved session, stalled auth, signin/signup destinations, workspace sign-in and beta access gate.')
} finally {
  if (root) await act(async () => root.unmount())
  await supabase?.auth.stopAutoRefresh(); await supabase?.removeAllChannels()
  await server.close(); dom.window.close()
}
process.exit(0)
