import {test} from 'node:test'
import assert from 'node:assert/strict'
import {schedulingHandler,type SchedulingDependencies} from '../../supabase/functions/work-scheduling/handler.ts'
import {appointmentIcs} from '../../src/lib/calendarDownload.ts'
const actor='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222'
function setup(options:Partial<SchedulingDependencies>={}) {
 const calls:any[]=[],sent:string[]=[]
 const deps:SchedulingDependencies={origin:'https://finviant.com',allowedOrigins:['https://finviant.com'],emailEnabled:true,authorize:async h=>h==='Bearer valid'?{id:actor}:null,
 rpc:async(name,args)=>{calls.push({name,args});return {data:name==='complete_job_workflow'?{job_id:job,status:'completed',invoice_ready:true}: {id:job,status:'queued'},error:null}},
 dispatch:async id=>{sent.push(id);return {status:200,body:{status:'accepted'}}},...options}
 return {handler:schedulingHandler(deps),calls,sent}
}
const request=(body:unknown,auth='Bearer valid',origin='https://finviant.com')=>new Request('https://example.test/work-scheduling',{method:'POST',headers:{authorization:auth,origin,'content-type':'application/json'},body:JSON.stringify(body)})
test('completion authenticates the caller and ignores a forged actor in the request body',async()=>{
 const {handler,calls}=setup()
 const r=await handler(request({action:'complete',job_id:job,actor_id:job}))
 assert.equal(r.status,200);assert.equal(calls[0].args.p_actor,actor);assert.equal(calls[0].args.p_job,job)
})
test('unauthorized sessions, unrelated origins, invalid IDs and unknown actions never reach the database',async()=>{
 const {handler,calls}=setup()
 assert.equal((await handler(request({action:'complete',job_id:job},''))).status,401)
 assert.equal((await handler(request({action:'complete',job_id:job},'Bearer valid','https://unrelated.test'))).status,403)
 assert.equal((await handler(request({action:'complete',job_id:'bad'}))).status,400)
 assert.equal((await handler(request({action:'erase_job',job_id:job}))).status,400)
 assert.equal(calls.length,0)
})
test('customer email requires an explicit approval and enabled delivery before preparing any outbox operation',async()=>{
 const body={action:'send_availability',offer_id:job,send_id:actor,token:'a'.repeat(64)}
 const enabled=setup()
 assert.equal((await enabled.handler(request(body))).status,400)
 assert.equal(enabled.calls.length,0)
 const disabled=setup({emailEnabled:false})
 assert.equal((await disabled.handler(request({...body,approved:true}))).status,503)
 assert.equal(disabled.calls.length,0);assert.equal(disabled.sent.length,0)
})
test('reviewed availability uses the caller identity and persistent send ID through the shared dispatcher',async()=>{
 const {handler,calls,sent}=setup()
 assert.equal((await handler(request({action:'send_availability',offer_id:job,send_id:actor,token:'a'.repeat(64),approved:true}))).status,200)
 assert.equal(calls[0].name,'prepare_scheduling_email');assert.equal(calls[0].args.p_request,actor);assert.equal(calls[0].args.p_actor,actor);assert.deepEqual(sent,[job])
})
test('database denials and unexpected failures never report a successful completion',async()=>{
 const denied=setup({rpc:async()=>({data:null,error:{code:'42501',message:'Job access required'}})})
 assert.equal((await denied.handler(request({action:'complete',job_id:job}))).status,403)
 const failed=setup({rpc:async()=>{throw new Error('unavailable')}})
 assert.equal((await failed.handler(request({action:'complete',job_id:job}))).status,503)
})
test('calendar downloads use UTC, preserve the appointment and escape injected event fields',()=>{
 const text=appointmentIcs({id:'test',title:'Visit\nBEGIN:VEVENT;evil,entry',start:'2026-11-03T09:00:00-05:00',end:'2026-11-03T11:00:00-05:00',address:'1 Main; Unit 2',created:'2026-11-02T12:00:00Z'})
 assert.match(text,/DTSTART:20261103T140000Z/);assert.match(text,/DTEND:20261103T160000Z/)
 assert.equal(text.split('\r\nBEGIN:VEVENT').length,2)
 assert.ok(text.includes('Visit\\nBEGIN:VEVENT\\;evil\\,entry'))
 assert.throws(()=>appointmentIcs({id:'test',title:'Bad',start:'not-a-date',end:'not-a-date'}))
})
