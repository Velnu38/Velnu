import {openFinVoice} from './navigation.mjs'
import {test,expect} from '@playwright/test'
import {mock,U} from './audit-fixture.mjs'

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
const answer={answer:'Your saved service is landscaping.',sources:[],limits:['Saved records only.'],as_of:'2026-11-04T12:00:00Z'}
async function setup(page,{pending=false,denied=false,permissionPending=false}={}){
 await mock(page,{ai:true})
 await page.route('**/functions/v1/transcribe-voice',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  if(route.request().headers()['content-type']?.includes('application/json')){
   if(pending)return
   return route.fulfill({status:200,headers:cors,json:{configured:true}})
  }
  return route.fulfill({status:200,headers:cors,json:{transcript:'What services do I offer?',transcription_id:'test'}})
 })
 await page.addInitScript(({denied,permissionPending})=>{
  window.__mic={calls:0,gesture:false,stops:0}
  const stream={getTracks:()=>[{stop(){window.__mic.stops++}}]}
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){
   window.__mic.calls++;window.__mic.gesture=navigator.userActivation.isActive
   if(denied)return Promise.reject(new DOMException('Microphone access was blocked.','NotAllowedError'))
   if(permissionPending)return new Promise(resolve=>window.__allowMic=()=>resolve(stream))
   return Promise.resolve(stream)
  }}})
  window.MediaRecorder=class{
   static isTypeSupported(){return true}
   constructor(stream,options){this.stream=stream;this.mimeType=options?.mimeType||'audio/webm';this.state='inactive';window.__recorder=this}
   start(){this.state='recording'}
   stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(512)],{type:this.mimeType})});this.onstop?.()}
  }
 },{denied,permissionPending})
}
const input=page=>page.getByRole('textbox',{name:'Describe your invoice or request'})

test('the speaking control starts recording immediately despite stalled preflight; a spoken question and follow-up receive answers',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{pending:true});const requests=[]
 await page.route('**/functions/v1/fin-workflow',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  requests.push(route.request().postDataJSON());return route.fulfill({status:200,headers:cors,json:answer})
 })
 await page.goto('/');await openFinVoice(page)
 await expect(page.getByRole('button',{name:'Finish recording',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__mic)).toEqual({calls:1,gesture:true,stops:0})
 await page.getByRole('button',{name:'Finish recording',exact:true}).click()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 await expect(input(page)).toHaveValue('');expect(requests[0]).not.toHaveProperty('history')
 await page.getByRole('button',{name:'Speak a follow-up',exact:true}).click();await page.getByRole('button',{name:'Finish recording',exact:true}).click()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2)
 expect(requests[1].thread_id).toBe(requests[0].thread_id)
 expect(await page.evaluate(()=>window.__mic.calls)).toBe(2)
})

test('typing opens without microphone access and a pending answer has a visible status',async({page})=>{
 await setup(page);let reply
 await page.route('**/functions/v1/fin-workflow',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  reply=()=>route.fulfill({status:200,headers:cors,json:answer})
 })
 await page.goto('/');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 expect(await page.evaluate(()=>window.__mic.calls)).toBe(0)
 await input(page).fill('What services do I offer?');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Fin is checking your account'})).toBeVisible()
 await expect.poll(()=>Boolean(reply)).toBe(true);await reply()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
})

test('denied microphone permission leaves typing available',async({page})=>{
 await setup(page,{denied:true});await page.goto('/');await openFinVoice(page)
 await expect(page.getByRole('alert')).toContainText('Microphone access was blocked')
 await expect(input(page)).toBeEnabled();await input(page).fill('What services do I offer?')
 await expect(page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true})).toBeEnabled()
})

test('late microphone permission is cleaned up after the permission deadline',async({page})=>{
 await setup(page,{permissionPending:true});await page.clock.install();await page.goto('/');await openFinVoice(page)
 await expect.poll(()=>page.evaluate(()=>window.__mic.calls)).toBe(1)
 await page.clock.runFor(15010);await expect(page.getByRole('alert')).toContainText('Microphone permission is still pending')
 await expect(input(page)).toBeEnabled();await page.evaluate(()=>window.__allowMic())
 await expect.poll(()=>page.evaluate(()=>window.__mic.stops)).toBe(1)
 await expect(page.getByRole('button',{name:'Finish recording'})).toHaveCount(0)
})

test('recorder failure stops tracks and unlocks the panel',async({page})=>{
 await setup(page);await page.goto('/');await openFinVoice(page)
 await expect(page.getByRole('button',{name:'Finish recording'})).toBeVisible();await page.evaluate(()=>window.__recorder.onerror())
 await expect(page.getByRole('alert')).toContainText('could not record usable audio');await expect(input(page)).toBeEnabled()
 expect(await page.evaluate(()=>window.__mic.stops)).toBe(1)
})

test('a rejected session refreshes once and retries the question with the renewed token',async({page})=>{
 await setup(page);let calls=0,refreshes=0;const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:U,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.renewed'
 await page.route('**/auth/v1/token?grant_type=refresh_token',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  refreshes++;return route.fulfill({status:200,headers:cors,json:{access_token:token,refresh_token:'renewed-refresh',token_type:'bearer',expires_in:3600,user:{id:U,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}}})
 })
 await page.route('**/functions/v1/fin-workflow',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  calls++;if(calls===1)return route.fulfill({status:401,headers:cors,json:{message:'Invalid JWT'}})
  expect(route.request().headers().authorization).toBe('Bearer '+token)
  return route.fulfill({status:200,headers:cors,json:answer})
 })
 await page.goto('/');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click();await input(page).fill('What services do I offer?');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1);expect(refreshes).toBe(1);expect(calls).toBe(2)
})

test('a stalled answer releases the controls and preserves the question without replaying it',async({page})=>{
 await setup(page);let calls=0
 await page.route('**/functions/v1/fin-workflow',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});calls++})
 await page.clock.install();await page.goto('/');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click();await input(page).fill('What services do I offer?');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect.poll(()=>calls).toBe(1);await page.clock.runFor(150010)
 await expect(page.getByRole('alert')).toContainText('Fin took too long');await expect(input(page)).toHaveValue('What services do I offer?');await expect(input(page)).toBeEnabled();expect(calls).toBe(1)
})


test('browser dictation releases controls if its end event is missing',async({page})=>{
 await mock(page,{ai:true});await page.addInitScript(()=>{
  window.SpeechRecognition=window.webkitSpeechRecognition=class{start(){}stop(){}}
 })
 await page.clock.install();await page.goto('/');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 await page.getByRole('button',{name:'Speak instead'}).click();await page.getByRole('button',{name:'Finish recording'}).click()
 await page.clock.runFor(3010);await expect(input(page)).toBeEnabled();await expect(page.getByRole('alert')).toContainText('No text detected')
})

test('a malformed command response leaves the request editable without executing it',async({page})=>{
 await setup(page);let executions=0
 await page.route('**/functions/v1/fin-workflow',route=>route.fulfill({status:200,headers:cors,json:[]}))
 await page.route('**/functions/v1/execute-ai-action',route=>{executions++;return route.fulfill({status:200,headers:cors,json:{}})})
 await page.goto('/');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 await input(page).fill('Create a customer named Bob Smith');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('complete response')
 await expect(input(page)).toHaveValue('Create a customer named Bob Smith');await expect(input(page)).toBeEnabled();expect(executions).toBe(0)
})
