import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import React from 'react'
import {renderToString} from 'react-dom/server'
import {createServer} from 'vite'
import {chromium} from 'playwright'
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let browser
try{
 const {default:Calendar}=await server.ssrLoadModule('/src/components/scheduling/WorkerAvailabilityCalendar.tsx')
 const worker={id:'worker',name:'Alex Example',trade:'Technician',active:true,is_owner:true,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,updated_at:'2030-01-01T00:00:00Z'}
 const context={preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:60,buffer_minutes:15,notice_hours:24},team:[{id:worker.id,label:worker.name,role:'owner',is_you:true}],time_off:[{id:'leave',user_id:worker.id,starts_at:'2030-03-05T17:00:00Z',ends_at:'2030-03-05T22:00:00Z',note:'Personal time'}]}
 const markup=renderToString(React.createElement(Calendar,{worker,workers:[worker],context,zone:'America/New_York',today:'2030-03-04',asOf:'2030-03-04T12:00:00Z',onChoose:()=>{},disabled:false}))
 const css=await readFile('src/components/scheduling/scheduling.css','utf8')
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
 await mkdir('/tmp/finviant-availability-preview',{recursive:true})
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;padding:16px;font:16px system-ui}button{font:inherit;padding:8px}button:disabled{opacity:.6}${css}</style></head><body><main>${markup}</main></body></html>`)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${width}px`)
  const buttons=page.locator('.availability-days button');assert.equal(await buttons.count(),7)
  if(width===390){for(const button of await buttons.all()){const box=await button.boundingBox();assert.ok(box&&box.height>=44&&box.width>=44)}}
  await page.screenshot({path:`/tmp/finviant-availability-preview/calendar-${width}.png`,fullPage:true})
  await page.close()
 }
 console.log('PASS: synthetic calendar renders without horizontal overflow at390/1280px; mobile day targets >=44px. Static SSR only, not interactive/device acceptance.')
}finally{await browser?.close();await server.close()}
