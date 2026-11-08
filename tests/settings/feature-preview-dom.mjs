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
 const style=document.createElement('style');style.textContent=await readFile('src/components/upgrade-link.css','utf8');document.head.appendChild(style)
 const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts')
 let plan='free';supabase.rpc=async()=>({data:{plan},error:null})
 const {default:Restriction}=await server.ssrLoadModule('/src/components/PlanRestriction.tsx')
 const {default:More}=await server.ssrLoadModule('/src/components/MoreNavigation.tsx')
 for(const [current,required,label] of [['free','basic','Individual and Business Plans'],['free','pro','Business Pro'],['basic','pro','Business Pro']]){
  await render(Restriction,{plan:current,required,feature:'Example',canUpgrade:true})
  assert.equal(document.querySelector('.plan-availability-label').textContent,label)
  plainLink(document.querySelector('a'),'/?view=settings&section=plans&tier='+required)
 }
 await render(Restriction,{plan:'basic',required:'basic',feature:'Included',canUpgrade:true});assert.equal(document.querySelector('.plan-restriction'),null)
 const business={id:'preview',name:'Demo',role:'owner',primary_owner:true,access_modules:['billing','jobs','calendar','finances']}
 for(const [tier,count] of [['free',3],['basic',1],['pro',0]]){
  plan=tier;await render(More,{business:{...business,id:tier}});await tick()
  assert.equal(document.querySelectorAll('.plan-feature-preview').length,count)
  for(const a of document.querySelectorAll('.plan-feature-preview a')) plainLink(a,a.getAttribute('href'))
  assert.ok(document.querySelector('a[href="/?view=settings&section=team"]'),'Existing team navigation remains')
 }
 plan='free';await render(More,{business:{...business,id:'office',role:'office',primary_owner:false}});await tick()
 assert.equal(document.querySelectorAll('.plan-feature-preview a').length,0)
 assert.match(document.body.textContent,/Ask your workspace owner/)
 console.log('PASS: exact availability labels, Free/Individual/Pro discovery, included features unshaded, text-only upgrade destinations and owner permissions')
} finally {await act(async()=>root.unmount());const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
