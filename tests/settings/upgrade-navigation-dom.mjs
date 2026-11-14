import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-fixture'
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://finviant.test/?view=settings', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'HTMLDialogElement', 'history', 'location', 'localStorage', 'sessionStorage']) globalThis[key] = key === 'window' ? dom.window : dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
document.addEventListener('click', event => { if (event.target.closest?.('a')) event.preventDefault() }, true)
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
const root = createRoot(document.getElementById('root'))
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)))
const render = async (component, props = {}) => {
  await act(async () => root.render(React.createElement('div', { className: 'finviant-workspace' },
    React.createElement('div', { className: 'workspace' }, React.createElement('div', { className: 'workspace-inner' }, React.createElement(component, props))))))
  await tick()
}
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label)
const click = async label => { const element = button(label); assert.ok(element, label); assert.equal(element.disabled, false, label); await act(async () => element.click()); await tick() }
function plainLink(link, href) {
  assert.ok(link, `Navigation to ${href} is present`)
  assert.equal(link.tagName, 'A')
  assert.equal(link.getAttribute('href'), href)
  assert.equal(link.tabIndex, 0, 'A real anchor remains keyboard focusable')
  assert.notEqual(link.getAttribute('role'), 'button')
  assert.equal(link.classList.contains('primary-button'), false)
  assert.equal(link.classList.contains('secondary-button'), false)
  const style = window.getComputedStyle(link)
  assert.equal(style.textDecoration, 'underline')
  assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)')
  assert.equal(style.padding, '0px')
  assert.equal(style.minHeight, '0')
  assert.equal(style.borderRadius, '0')
}
try {
  const parentCss = await readFile('src/components/document-review.css', 'utf8')
  const parentRules = [...parentCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].includes('.document-action-grid>:is(button,a)')).map(match => match[0]).join('\n')
  assert.ok(parentRules, 'The actual document action-grid rules are included in the regression')
  const style = document.createElement('style')
  style.textContent = '.primary-button{background:#245f98;color:white;padding:8px 12px;border-radius:9px;min-height:48px}' + parentRules + await readFile('src/components/upgrade-link.css', 'utf8')
  document.head.appendChild(style)
  const { default: UpgradeLink, PlanNavigationLink, isPlanNavigationHref } = await server.ssrLoadModule('/src/components/UpgradeLink.tsx')
  const { default: PlanRestriction } = await server.ssrLoadModule('/src/components/PlanRestriction.tsx')
  for (const [plan, required] of [['free', 'basic'], ['free', 'pro'], ['basic', 'pro']]) {
    await render(UpgradeLink, { plan, required, canUpgrade: true })
    plainLink(document.querySelector('a'), '/?view=settings&section=plans&tier=' + required)
  }
  await render(UpgradeLink, { plan: 'free', required: 'basic', canUpgrade: false })
  assert.equal(document.querySelector('a'), null)
  assert.match(document.body.textContent, /Ask your workspace owner about Individual/)
  for (const [plan, required] of [['basic', 'basic'], ['pro', 'pro'], ['pro', 'basic']]) {
    await render(UpgradeLink, { plan, required, canUpgrade: true })
    assert.equal(document.querySelector('a'), null, 'Current or lower tiers do not become upgrade destinations')
  }
  await render(PlanRestriction, { plan: 'free', required: 'basic', canUpgrade: true, feature: 'active customers', limit: true })
  plainLink(document.querySelector('a'), '/?view=settings&section=plans&tier=basic')
  await render(() => React.createElement('div', { className: 'document-action-grid' },
    React.createElement(PlanNavigationLink, { href: '/?view=settings&section=plans' }, 'Compare plans'),
    React.createElement('button', { className: 'primary-button' }, 'Save document')))
  plainLink(document.querySelector('a'), '/?view=settings&section=plans')
  assert.equal(window.getComputedStyle(button('Save document')).backgroundColor, 'rgb(36, 95, 152)', 'Actual action buttons retain their existing treatment')
  for (const href of ['/?view=settings&section=plans', '/?view=settings&section=subscription', '/plans', 'https://checkout.stripe.com/c/pay_test', 'https://billing.stripe.com/p/session_test']) assert.equal(isPlanNavigationHref(href), true, href)
  for (const href of ['/?view=customers', '/?view=settings&section=delivery', '/?view=work']) assert.equal(isPlanNavigationHref(href), false, href)

  const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts')
  const requests = []
  const status = { configuration: { stripe: true, stripe_webhook: true, connect_webhook: true, sms: false }, state: { stripe_customer: 'cus_test', stripe_account: 'acct_test' }, operations: [], invoices: [] }
  Object.defineProperty(supabase, 'functions', { configurable: true, value: { invoke: async (name, input) => {
    requests.push({ name, body: input.body })
    if (name === 'subscription-management') return { data: { active: true, status: 'active', can_cancel: true }, error: null }
    return { data: input.body.action === 'status' ? status : { url: input.body.action === 'portal' ? 'https://billing.stripe.com/p/session_test' : 'https://checkout.stripe.com/c/pay_test' }, error: null }
  } } })
  const { default: SubscriptionSettings } = await server.ssrLoadModule('/src/components/settings/SubscriptionSettings.tsx')
  await render(SubscriptionSettings, { businessId: 'business' })
  plainLink(document.querySelector('a'), '/?view=settings&section=plans')
  await click('Cancel subscription')
  assert.equal(button('Confirm cancellation').tagName, 'BUTTON')
  assert.equal(button('Keep subscription').tagName, 'BUTTON')
  assert.equal(requests.filter(request => request.body.action === 'cancel').length, 0, 'Navigation styling does not execute subscription cancellation')

  const { FinResponse } = await server.ssrLoadModule('/src/components/VoiceAssistant.tsx')
  let navigations = 0
  await render(FinResponse, { result: { answer: 'Choose where to go.', sources: [], navigation: ['subscription', 'customers'], limits: [], as_of: '2026-11-08T00:00:00Z' }, onNavigate: () => { navigations++ } })
  const subscription = document.querySelector('a[href="/?view=settings&section=subscription"]')
  plainLink(subscription, '/?view=settings&section=subscription')
  await act(async () => subscription.click())
  assert.equal(navigations, 1)
  assert.equal(document.querySelector('a[href="/?view=customers"]').classList.contains('secondary-button'), true, 'Ordinary assistant feature navigation is unchanged')

  const { default: IntegrationTesting } = await server.ssrLoadModule('/src/components/settings/IntegrationTesting.tsx')
  await render(IntegrationTesting, { businessId: 'business' })
  await click('Prepare test subscription')
  plainLink(document.querySelector('a[href="https://checkout.stripe.com/c/pay_test"]'), 'https://checkout.stripe.com/c/pay_test')
  assert.equal(button('Prepare test subscription').tagName, 'BUTTON')
  await click('Manage test subscription')
  const portal = document.querySelector('a[href="https://billing.stripe.com/p/session_test"]')
  plainLink(portal, 'https://billing.stripe.com/p/session_test')
  assert.equal(portal.target, '_blank')
  assert.equal(portal.rel, 'noopener noreferrer')
  console.log('Upgrade and billing links: tier/owner rules, action-grid styles, keyboard anchors, subscription, assistant and checkout navigation passed')
} finally {
  await act(async () => root.unmount())
  await server.close()
  dom.window.close()
}
// Supabase's browser BroadcastChannel outlives the isolated DOM fixture.
process.exit(0)
