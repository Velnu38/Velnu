import {test,expect} from '@playwright/test'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mock} from './audit-fixture.mjs'
import {workflow,start,review} from './fin-workflow-fixture.mjs'

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
let browser,fixtureDir
// Exercise the browser's real MediaStream, MediaRecorder and Web Audio APIs.
// Only the audio device, authentication and server responses are synthetic.
test.beforeAll(async({playwright},info)=>{
 fixtureDir=await mkdtemp(join(tmpdir(),'fin-audio-'))
 const rate=16000,count=rate*10,wav=Buffer.alloc(44+count*2)
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40)
 for(let i=0;i<count;i++){const t=i/rate;wav.writeInt16LE(t>=.5&&t<2?Math.round(Math.sin(2*Math.PI*440*t)*9000):0,44+i*2)}
 const audio=join(fixtureDir,'speech-and-pause.wav');await writeFile(audio,wav)
 const options=info.project.use.launchOptions||{}
 browser=await playwright.chromium.launch({channel:info.project.use.channel,...options,args:[...(options.args||[]),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${audio}`]})
})
test.afterAll(async()=>{await browser?.close();if(fixtureDir)await rm(fixtureDir,{recursive:true,force:true})})

for(const width of [320,390])test(`one mobile tap records real audio and submits after a pause at ${width}px`,async()=>{
 const context=await browser.newContext({viewport:{width,height:844},permissions:['microphone']})
 try{
  const page=await context.newPage();await mock(page,{ai:true});let uploads=0,bytes=0,questions=0
  await page.addInitScript(()=>{
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
   navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__capturedStream=stream;return stream}
  })
  await page.route('**/functions/v1/transcribe-voice',route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
   if(route.request().headers()['content-type']?.includes('application/json'))return route.fulfill({status:200,headers:cors,json:{configured:true}})
   uploads++;bytes=route.request().postDataBuffer().length
   return route.fulfill({status:200,headers:cors,json:{transcript:'What services do I offer?',transcription_id:'synthetic-device'}})
  })
  await page.route('**/functions/v1/fin-workflow',route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
   questions++;return route.fulfill({status:200,headers:cors,json:{answer:'Your saved service is landscaping.',sources:[],limits:[],as_of:new Date().toISOString()}})
  })
  await page.goto('http://127.0.0.1:4173/')
  const dock=page.getByRole('navigation',{name:'Workspace navigation'}),launcher=dock.getByRole('button',{name:'Talk to Fin'})
  await expect(launcher).toBeVisible()
  const bounds=await dock.boundingBox(),button=await launcher.boundingBox()
  expect(bounds.y+bounds.height).toBe(844);expect(button.y).toBeGreaterThanOrEqual(bounds.y);expect(button.y+button.height).toBeLessThanOrEqual(844)
  await expect(dock.getByRole('button',{name:'Dashboard',exact:true})).toHaveAttribute('aria-current','page')
  await page.screenshot({path:`test-results/mobile-fin-dock-${width}.png`,fullPage:true})
  await launcher.click()
  const panel=page.getByRole('dialog',{name:'Fin — your office assistant'})
  await expect(panel.getByText('Listening…',{exact:true})).toBeVisible()
  await expect(panel.getByRole('button',{name:/Tap.*speak|Speak instead|Try microphone/})).toHaveCount(0)
  await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1,{timeout:20000})
  expect(uploads).toBe(1);expect(bytes).toBeGreaterThan(1000);expect(questions).toBe(1)
  expect(await page.evaluate(()=>window.__capturedStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true)
  expect(await page.evaluate(()=>MediaRecorder.toString().includes('[native code]'))).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await panel.getByRole('button',{name:'Close',exact:true}).click()
  await dock.getByRole('button',{name:'Customers',exact:true}).click()
  await expect(dock.getByRole('button',{name:'Customers',exact:true})).toHaveAttribute('aria-current','page')
  const after=await launcher.boundingBox();expect(after).toEqual(button)
  await dock.getByRole('button',{name:'More',exact:true}).click();await expect(page.getByRole('dialog',{name:'More navigation'})).toBeVisible()
  await page.getByRole('button',{name:'Type to Fin',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Describe your invoice or request'})).toBeEnabled();expect(uploads).toBe(1);await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 }finally{await context.close()}
})

test('cancel releases native audio tracks without uploading',async()=>{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:['microphone']})
 try{
  const page=await context.newPage();const state=await mock(page,{ai:true});let uploads=0
  await page.route('**/functions/v1/transcribe-voice',route=>{if(route.request().method()==='POST'&&!route.request().headers()['content-type']?.includes('application/json'))uploads++;return route.fulfill({status:200,headers:cors,json:{configured:true}})})
  await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__capturedStream=stream;return stream}})
  await page.goto('http://127.0.0.1:4173/');await page.getByRole('button',{name:'Talk to Fin'}).click()
  await page.getByRole('button',{name:'Cancel recording',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Describe your invoice or request'})).toBeEnabled()
  expect(await page.evaluate(()=>window.__capturedStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true)
  expect(state.calls.some(c=>c.path.endsWith('fin-workflow'))).toBe(false);expect(uploads).toBe(0)
 }finally{await context.close()}
})

for(const word of ['yes','no'])test(`spoken ${word} applies only to the displayed review`,async()=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},permissions:['microphone']})
 try{const page=await context.newPage();const f=await workflow(page);let uploads=0;
 await page.route('**/functions/v1/transcribe-voice',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});if(route.request().headers()['content-type']?.includes('application/json'))return route.fulfill({status:200,headers:cors,json:{configured:true}});uploads++;return route.fulfill({status:200,headers:cors,json:{transcript:word,transcription_id:'synthetic-approval'}})});
 await start(page);await expect(review(page)).toBeVisible();await page.getByRole('button',{name:'Speak a follow-up',exact:true}).click();await expect(review(page)).toHaveCount(0,{timeout:25000});expect(uploads).toBe(1);expect(f.requests).toHaveLength(1);expect(f.executions).toHaveLength(word==='yes'?1:0);
 if(word==='yes')await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toBeVisible();else await expect(page.getByText('Plan cancelled. No changes were saved.')).toBeVisible();
 }finally{await context.close()}
})
