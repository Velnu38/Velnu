import {openFinVoice} from './navigation.mjs'
import {test,expect} from '@playwright/test'
import {mock} from './audit-fixture.mjs'

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
const input=page=>page.getByRole('textbox',{name:'Describe your invoice or request'})
async function setup(page,options={}){
 await page.setViewportSize({width:390,height:844});await mock(page,{ai:true})
 const requests={uploads:[],questions:[],statusReply:null}
 await page.route('**/functions/v1/transcribe-voice',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  if(route.request().headers()['content-type']?.includes('application/json')){
   const reply=()=>route.fulfill({status:200,headers:cors,json:{configured:true}})
   if(options.pendingStatus){requests.statusReply=reply;return}return reply()
  }
  requests.uploads.push(route.request().postDataBuffer().toString())
  return route.fulfill({status:200,headers:cors,json:{transcript:'What services do I offer?',transcription_id:'compatibility-test'}})
 })
 await page.route('**/functions/v1/fin-workflow',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  requests.questions.push(route.request().postDataJSON())
  return route.fulfill({status:200,headers:cors,json:{answer:'Your saved service is landscaping.',sources:[],limits:[],as_of:'2026-11-04T12:00:00Z'}})
 })
 await page.addInitScript(options=>{
  window.__mic={calls:0,stops:0,attempts:[],speechStarts:0,gesture:false,speechGesture:false,constraints:null}
  window.__deviceError=options.deviceError
  if(options.ios)Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'})
  if(options.policyBlocked)Object.defineProperty(document,'permissionsPolicy',{configurable:true,value:{allowsFeature:()=>false}})
  const stream={getTracks:()=>[{stop(){window.__mic.stops++}}]}
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(constraints){
   window.__mic.calls++;window.__mic.gesture=navigator.userActivation.isActive;window.__mic.constraints=constraints;window.__mic.panelOpen=Boolean(document.querySelector('dialog[open]'));window.__mic.keyboardFocused=document.activeElement?.tagName==='TEXTAREA'
   if(window.__deviceError)return Promise.reject(new DOMException('Device reported '+window.__deviceError,window.__deviceError))
   return Promise.resolve(stream)
  }}})
  window.MediaRecorder=class{
   static isTypeSupported(){return true}
   constructor(stream,optionsValue){
    const format=optionsValue?.mimeType||'native';window.__mic.attempts.push(format)
    if(options.allFail||(options.defaultFails&&format==='native'))throw new DOMException('Encoder unavailable','NotSupportedError')
    this.stream=stream;this.mimeType=optionsValue?.mimeType||'audio/mp4';this.state='inactive'
   }
   start(){this.state='recording';if(options.webmStartFails&&this.mimeType==='audio/webm;codecs=opus')throw new DOMException('Cannot start this encoder','NotSupportedError')}
   stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(512)],{type:this.mimeType})});this.onstop?.()}
  }
  window.SpeechRecognition=window.webkitSpeechRecognition=class{
   start(){window.__speech=this;window.__mic.speechStarts++;window.__mic.speechGesture=navigator.userActivation.isActive}
   stop(){this.onresult?.({results:[[{transcript:'What services do I offer?'}]]});this.onend?.()}
  }
  if(options.badAudioContext)window.AudioContext=class{
   state='running';resume(){return Promise.resolve()};createMediaStreamSource(){throw Error('Audio analyser unavailable')};close(){throw Error('Audio context could not close')}
  }
 },options)
 await page.goto('/');return requests
}

test('native phone encoder is tried first and microphone constraints stay simple',async({page})=>{
 const requests=await setup(page);await openFinVoice(page)
 await expect(page.getByRole('button',{name:'Finish recording'})).toBeVisible()
 expect(await page.evaluate(()=>window.__mic.attempts)).toEqual(['native'])
 expect(await page.evaluate(()=>window.__mic.constraints)).toEqual({audio:true})
 expect(await page.evaluate(()=>window.__mic.gesture)).toBe(true)
 expect(await page.evaluate(()=>window.__mic.panelOpen)).toBe(true);expect(await page.evaluate(()=>window.__mic.keyboardFocused)).toBe(false)
 await page.getByRole('button',{name:'Finish recording'}).click()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(requests.uploads).toHaveLength(1);expect(requests.uploads[0]).toContain('audio/mp4');expect(requests.uploads[0]).toContain('finviant-command.m4a')
})

test('constructor and start failures try compatible formats without another microphone request',async({page})=>{
 const requests=await setup(page,{defaultFails:true,webmStartFails:true});await openFinVoice(page)
 await expect(page.getByRole('button',{name:'Finish recording'})).toBeVisible()
 expect(await page.evaluate(()=>window.__mic.attempts)).toEqual(['native','audio/webm;codecs=opus','audio/mp4'])
 expect(await page.evaluate(()=>window.__mic.calls)).toBe(1);expect(await page.evaluate(()=>window.__mic.stops)).toBe(0)
 await page.getByRole('button',{name:'Finish recording'}).click();await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(requests.uploads).toHaveLength(1);expect(await page.evaluate(()=>window.__mic.stops)).toBe(1)
})

test('recording failure offers explicit browser dictation and keeps that choice after preflight',async({page})=>{
 const requests=await setup(page,{allFail:true,pendingStatus:true});await openFinVoice(page)
 const help=page.getByRole('region',{name:'Microphone help'})
 await expect(help.getByRole('alert')).toContainText('Microphone access was granted')
 await expect(page.getByRole('button',{name:'Retry microphone',exact:true})).toHaveCount(1)
 expect(await page.evaluate(()=>window.__mic.stops)).toBe(1)
 await help.getByRole('button',{name:'Use browser dictation'}).click()
 expect(await page.evaluate(()=>window.__mic.speechGesture)).toBe(true)
 await expect.poll(()=>Boolean(requests.statusReply)).toBe(true);await requests.statusReply()
 await page.getByRole('button',{name:'Finish recording'}).click();await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 await page.getByRole('button',{name:'Speak a follow-up'}).click();expect(await page.evaluate(()=>window.__mic.speechStarts)).toBe(2)
 await page.getByRole('button',{name:'Finish recording'}).click();await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2)
 expect(await page.evaluate(()=>window.__mic.calls)).toBe(1);expect(requests.uploads).toHaveLength(0)
})

test('iPhone denial shows actionable site permission steps and can recover in place',async({page})=>{
 const requests=await setup(page,{deviceError:'NotAllowedError',ios:true});await openFinVoice(page)
 const help=page.getByRole('region',{name:'Microphone help'});await expect(help).toContainText('Website Settings → Microphone → Allow')
 await expect(help.getByRole('button',{name:'Use browser dictation'})).toHaveCount(0)
 await help.getByText('Microphone error details',{exact:true}).click();await expect(help).toContainText('Microphone access · NotAllowedError')
 await page.screenshot({path:'test-results/fin-iphone-permission-help.png',fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.evaluate(()=>window.__deviceError=null);await help.getByRole('button',{name:'Retry microphone'}).click()
 await expect(page.getByRole('button',{name:'Finish recording'})).toBeVisible();await expect(help).toHaveCount(0)
 await page.getByRole('button',{name:'Finish recording'}).click();await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1);expect(requests.uploads).toHaveLength(1)
})

test('blocked microphone offers focused typing and never bypasses permission with dictation',async({page})=>{
 const requests=await setup(page,{deviceError:'NotAllowedError'});await openFinVoice(page)
 await page.getByRole('button',{name:'Type instead'}).click();await expect(input(page)).toBeFocused()
 await input(page).fill('What services do I offer?');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(await page.evaluate(()=>window.__mic.speechStarts)).toBe(0);expect(requests.uploads).toHaveLength(0)
})

test('a busy device has different guidance from a blocked permission or encoder error',async({page})=>{
 await setup(page,{deviceError:'NotReadableError'});await openFinVoice(page)
 await expect(page.getByRole('alert')).toContainText('Finish any call or recording in another app')
 await expect(page.getByRole('button',{name:'Use browser dictation'})).toHaveCount(0);await expect(input(page)).toBeEnabled()
})

test('blocked embedding policy offers the direct secure app without requesting microphone access',async({page})=>{
 await setup(page,{policyBlocked:true});await openFinVoice(page)
 await expect(page.getByRole('link',{name:'Open Finviant directly'})).toHaveAttribute('href','https://finviant.com/')
 expect(await page.evaluate(()=>window.__mic.calls)).toBe(0);await expect(input(page)).toBeEnabled()
})

test('an optional audio monitor failure cannot prevent recording or cleanup',async({page})=>{
 const requests=await setup(page,{badAudioContext:true});await openFinVoice(page)
 await expect(page.getByRole('button',{name:'Finish recording'})).toBeVisible()
 await page.getByRole('button',{name:'Finish recording'}).click();await expect(page.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(requests.uploads).toHaveLength(1);expect(await page.evaluate(()=>window.__mic.stops)).toBe(1)
})

test('interrupted browser dictation preserves partial words instead of submitting incomplete intent',async({page})=>{
 const requests=await setup(page,{allFail:true});await openFinVoice(page);await page.getByRole('button',{name:'Use browser dictation'}).click()
 await page.evaluate(()=>{const speech=window.__speech;speech.onresult({results:[[{transcript:'Create an invoice for'}]]});speech.stop=()=>speech.onend?.();speech.onerror({error:'network'})})
 await expect(input(page)).toHaveValue('Create an invoice for');await expect(page.getByRole('alert')).toContainText('Check the captured words')
 expect(requests.questions).toHaveLength(0);expect(requests.uploads).toHaveLength(0)
})
