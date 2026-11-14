import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { createServer } from "vite";
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL = "true";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://finviant.test/?view=settings&section=documents",
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});
for (const k of [
  "window",
  "document",
  "HTMLElement",
  "HTMLDialogElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "history",
  "location",
  "localStorage",
  "sessionStorage",
])
  globalThis[k] = k === "window" ? dom.window : dom.window[k];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.confirm = () => true;
const React = await import("react"),
  { act } = React,
  { createRoot } = await import("react-dom/client"),
  root = createRoot(document.getElementById("root"));
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});

globalThis.FormData=dom.window.FormData;
const id="88888888-8888-4888-8888-888888888888",url="https://finviant.com/?business_card="+id;
let available=true,requests=[],supabase,downloads=0;
URL.createObjectURL=()=>"blob:test";URL.revokeObjectURL=()=>{};
dom.window.HTMLAnchorElement.prototype.click=function(){downloads++;};
const tick=()=>act(()=>new Promise(r=>setTimeout(r,30)));
const button=name=>[...document.querySelectorAll("button")].find(x=>x.textContent.trim()===name);
async function click(name){assert.ok(button(name),name);await act(async()=>button(name).click());await tick();}
try{
 ({supabase}=await server.ssrLoadModule("/src/lib/supabase.ts"));
 supabase.rpc=async(name,args)=>{
  if(name==="get_live_business_card"){assert.equal(args.p_public_id,id);return {data:available?{card:{name:"Renée Services",phone:"+17575550123",email:"hello@example.test",website:"https://example.test",include_address:false},branding:{accent:"#195246"},vcard:"BEGIN:VCARD\r\nVERSION:3.0\r\nURL:"+url+"\r\nEND:VCARD\r\n",url,filename:"E-Business-Card.vcf",expires_at:null}:null,error:null};}
  if(name==="request_business_card_estimate"){requests.push(args);return requests.length===1?{data:null,error:{message:"Synthetic uncertain result"}}:{data:{received:true},error:null};}
  throw Error(name);
 };
 const {default:Page}=await server.ssrLoadModule("/src/pages/BusinessCardPage.tsx");
 await act(async()=>root.render(React.createElement(Page,{token:id})));await tick();await tick();
 for(const href of ["tel:+17575550123","sms:+17575550123","mailto:hello@example.test"])assert.ok(document.querySelector('a[href="'+href+'"]'));
 assert.ok(button("Share Card"));await click("Save to Contacts");assert.equal(downloads,1);
 await click("Request an Estimate");const form=document.querySelector("form");form.elements.name.value="Customer";form.elements.email.value="customer@example.test";form.elements.details.value="Please quote repairs";
 await act(async()=>form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));await tick();assert.match(document.body.textContent,/Synthetic uncertain/);
 await act(async()=>form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));await tick();assert.deepEqual(requests[0],requests[1]);assert.match(document.body.textContent,/Request received for business review/);assert.equal(document.querySelector("form"),null);
 available=false;await click("Save to Contacts");assert.match(document.body.textContent,/This card link is unavailable/);assert.equal(button("Save to Contacts"),undefined);
 console.log("PASS public card call/text/email/contact/share, stable request retry, review-only confirmation and fresh unpublish denial");
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close();}
process.exit(0);
