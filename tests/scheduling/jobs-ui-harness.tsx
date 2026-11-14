import {jobDirectoryPage} from '../e2e/job-directory-fixture.mjs'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from '../../src/lib/supabase'
import JobDetailsDialog from '../../src/components/JobDetailsDialog'
import JobsPage from '../../src/pages/JobsPage'

const businessId='11111111-1111-4111-8111-111111111111', jobId='22222222-2222-4222-8222-222222222222', ownerId='33333333-3333-4333-8333-333333333333'
const start='2026-11-15T15:00:00Z', end='2026-11-15T16:00:00Z'
const customer={id:'44444444-4444-4444-8444-444444444444',first_name:'Alex',last_name:'Customer',company:null,email:'alex@example.test',phone:null}
let state:any, revision=0
const root=createRoot(document.getElementById('root')!)
const canBill=()=>['owner','admin','office'].includes(state.business.role)&&state.business.access_modules.includes('billing')
function rawJob(){const {active_appointment,invoice,...job}=state.job;return structuredClone(job)}
;(supabase as any).channel=()=>{const channel:any={on:()=>channel,subscribe:()=>channel};return channel}
;(supabase as any).removeChannel=async()=>{}
;(supabase as any).from=(table:string)=>{
 let single=false,patch:any,expected:any,filterDescription=false
 const chain:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>{
  let data:any=[],count=0
  if(table==='jobs'){
   if(patch){
    const valid=!filterDescription||state.job.description===expected
    if(valid){Object.assign(state.job,patch);state.job.updated_at='2026-11-08T20:00:00Z'}
    data=valid?{id:jobId}:null
   }else {data=single?rawJob():[rawJob()];count=1}
  }else if(table==='customers'){data=[customer];count=1}
  else if(table==='reminders'&&patch){data={id:patch.id};state.calls.push({name:'insert_reminder',input:patch})}
  resolve({data,error:null,count})
 }:(...args:any[])=>{
  if(key==='single'||key==='maybeSingle')single=true
  if(key==='update'||key==='insert')patch=args[0]
  if((key==='eq'||key==='is')&&args[0]==='description'){filterDescription=true;expected=args[1]}
  return chain
 }})
 return chain
}
;(supabase as any).rpc=async(name:string,input:any)=>{
 state.calls.push({name,input})
 if(name==='get_job_directory_page')return {data:jobDirectoryPage([{...state.job,invoice:canBill()?state.job.invoice:null}],input),error:null}
 if(name==='get_job_workflow_context')return {data:[{job_id:jobId,active_appointment:state.job.active_appointment,invoice:canBill()?state.job.invoice:null}],error:null}
 if(name==='get_plan_usage')return {data:{plan:state.plan,jobs_used:0,jobs_limit:state.plan==='free'?5:null},error:null}
 if(name==='get_schedule_team')return {data:[{id:ownerId,label:'Office owner',role:'owner',is_you:true}],error:null}
 if(name==='get_scheduling_context')return {data:{preferences:{duration_minutes:60,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,buffer_minutes:0,notice_hours:0},team:[{id:ownerId,label:'Office owner',role:'owner',is_you:true}],time_off:[]},error:null}
 if(name==='set_job_status_atomic'){state.job.status=input.p_status;return {data:{id:jobId,status:input.p_status},error:null}}
 if(name==='reopen_job'){state.job.status='lead';state.job.scheduled_start=null;state.job.scheduled_end=null;state.job.active_appointment=null;return {data:{job_id:jobId,status:'lead'},error:null}}
 if(name==='save_job_appointment'){state.job.scheduled_start=input.p_start;state.job.scheduled_end=input.p_end;state.job.active_appointment={id:'appointment',status:'confirmed',starts_at:input.p_start,ends_at:input.p_end};return {data:null,error:null}}
 return {data:[],error:null}
}
;(supabase.functions as any).invoke=async(name:string,{body}:any)=>{
 state.calls.push({name,body});state.job.status='completed';state.job.completed_at='2026-11-08T20:00:00Z'
 return {data:{job_id:jobId,status:'completed',invoice_ready:!!state.job.invoice,invoice_id:canBill()?state.job.invoice?.id:null,needs_pricing:!state.job.invoice,needs_review:!state.job.invoice},error:null}
}
;(window as any).jobsHarness={
 render(options:any={}){
  const {role='owner',status='scheduled',booked=true,plan='pro',invoice=null,view='details'}=options
  const business={id:businessId,name:'Finviant test business',role,primary_owner:role==='owner',timezone:'America/New_York',access_modules:options.modules||['jobs','calendar','billing','finances']}
  state={business,plan,calls:[],job:{id:jobId,title:'Replace water heater',description:'Original scope',status,scheduled_start:booked||options.retainedTime?start:null,scheduled_end:booked||options.retainedTime?end:null,active_appointment:booked?{id:'appointment',status:'confirmed',starts_at:start,ends_at:end}:null,invoice,assigned_user_ids:[],customer_id:customer.id,source_estimate_id:null,customers:[customer],properties:[],created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-08T12:00:00Z',completed_at:status==='completed'?'2026-11-08T11:00:00Z':null}}
  root.render(view==='list'?<JobsPage key={++revision} business={business as any}/>:<JobDetailsDialog key={++revision} business={business as any} jobId={jobId} onClose={()=>{}}/>)
 },
 state:()=>state,
 remoteNotes(value:string){state.job.description=value},
 changeRole(role:string){state.business={...state.business,role,primary_owner:role==='owner'};root.render(<JobDetailsDialog key={revision} business={state.business} jobId={jobId} onClose={()=>{}}/>)},
 unmount(){root.unmount()},
}
