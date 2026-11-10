import {test,expect} from '@playwright/test'
import {createHash} from 'node:crypto'
import {mock,B,U,business} from './audit-fixture.mjs'
import {storedZip} from '../../shared/archiveZip.ts'
const id='99999999-9999-4999-8999-999999999999'
const bytes=Buffer.from(storedZip([{name:'records/test.jsonl',bytes:new TextEncoder().encode('{"name":"Archive test"}\n')}]))
const sha=createHash('sha256').update(bytes).digest('hex')
for(const width of [390,1440])test(`owner archive resumes preparation and verifies downloads at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});await mock(page,{ai:true})
 let created=false,attempts=0,ready=0,hold=null,corrupt=true;const ids=[]
 const state=()=>created?{id,business_id:B,status:ready===2?'ready':'building',created_at:'2026-11-10T12:00:00Z',expires_at:'2099-01-01T00:00:00Z',counts:{'public.customers':50001},record_count:50001,file_count:1,part_count:2,ready_count:ready,page:0,parts:[1,2].map(part_no=>({part_no,kind:part_no===1?'records':'file',state:ready>=part_no?'ready':'pending',sha256:sha,byte_size:bytes.length,entries:[]}))}:null
 await page.route('**/rest/v1/rpc/get_owner_archive',r=>r.fulfill({json:state()}))
 await page.route('**/rest/v1/rpc/begin_owner_archive',r=>{
  const args=r.request().postDataJSON();expect(args.p_business).toBe(B);ids.push(args.p_request);attempts++
  if(attempts===1)return r.fulfill({status:503,json:{message:'Archive request interrupted. Retry to confirm it.'}})
  created=true;return r.fulfill({json:id})
 })
 await page.route('**/functions/v1/owner-archive',async r=>{
  const body=r.request().postDataJSON();expect(body.business_id).toBe(B);expect(body.archive_id).toBe(id)
  if(body.action==='download')return r.fulfill({contentType:'application/zip',body:corrupt?Buffer.from('broken'):bytes})
  if(ready===0){hold=r;return}
  ready=2;return r.fulfill({json:{prepared_part:2}})
 })
 await page.goto('/?view=settings&section=archive')
 await page.getByRole('button',{name:'Create new archive',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Archive request interrupted')
 await page.getByRole('button',{name:'Create new archive',exact:true}).click();await expect.poll(()=>!!hold).toBe(true)
 expect(ids[0]).toBe(ids[1]);await page.getByRole('button',{name:'Pause preparation',exact:true}).click()
 ready=1;await hold.fulfill({json:{prepared_part:1}});hold=null
 await expect(page.getByRole('status')).toContainText('Preparation paused');await expect(page.getByRole('region',{name:'Business archive'})).toContainText('50,001 records')
 await page.getByRole('button',{name:'Resume preparation',exact:true}).click();await expect(page.getByRole('status')).toContainText('Archive ready')
 await page.getByRole('button',{name:'Download part 1',exact:true}).click();await expect(page.getByRole('alert')).toContainText('integrity check')
 corrupt=false;const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download part 1',exact:true}).click();expect((await download).suggestedFilename()).toBe('Finviant-'+id+'-part-1.zip')
 await expect(page.getByRole('status')).toContainText('verified and handed to your browser');await expect(page.getByRole('button',{name:'Download again',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('non-primary owners cannot open the complete archive controls',async({page})=>{
 await mock(page);await page.route('**/rest/v1/business_members?**',r=>r.fulfill({json:{business_id:B,role:'office',access_modules:['billing','jobs'],businesses:{...business,created_by_user_id:U}}}))
 await page.goto('/?view=settings&section=archive');await expect(page.getByRole('alert')).toContainText('not included in your access');await expect(page.getByRole('button',{name:'Create new archive'})).toHaveCount(0)
})
