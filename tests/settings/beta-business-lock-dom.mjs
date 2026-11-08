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
 const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts')
 let locked=true
 supabase.rpc=async name=>name==='get_plan_usage'?{data:{plan:'pro',actual_plan:'pro',beta_locked:locked,can_test:!locked,testing:false,period_end:'2026-12-01',customers_used:0,jobs_used:0,seats_used:1,seats_limit:5},error:null}:{data:null,error:{message:'Provider fixture not configured'}}
 const {default:Plans}=await server.ssrLoadModule('/src/components/settings/PlansAndUsage.tsx')
 await render(Plans,{businessId:'tester'});await tick()
 assert.equal(document.querySelectorAll('.tier-card').length,1)
 assert.match(document.body.textContent,/Your Business Pro beta/)
 assert.equal(button('Test Free'),undefined);assert.equal(button('Test Individual'),undefined)
 assert.equal(document.querySelector('.tier-comparison'),null)
 assert.match(document.body.textContent,/Usage and limits/)
 locked=false;await render(Plans,{businessId:'admin'});await tick()
 assert.equal(document.querySelectorAll('.tier-card').length,3)
 assert.ok(button('Test Free'));assert.ok(button('Test Individual'));assert.ok(document.querySelector('.tier-comparison'))
 const {default:Picker}=await server.ssrLoadModule('/src/components/ServicePicker.tsx')
 await render(Picker,{value:{plan:'free',services:[]},onChange:()=>{},businessBetaOnly:true})
 assert.equal(document.querySelectorAll('input[type=radio]').length,1)
 assert.equal(document.querySelector('input').checked,true);assert.equal(document.querySelector('input').disabled,true)
 console.log('PASS: external beta sees only Business Pro and no switches; designated administrator retains all three tiers; service preferences cannot select lower plans')
} finally {await act(async()=>root.unmount());const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
