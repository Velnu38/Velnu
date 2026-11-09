// Local/CI-only rendering fixture. Synthetic data; no real session or provider calls.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '../../src/styles.css'
import '../../src/modules.css'
import '../../src/workspace-consistency.css'
import '../../src/office-dashboard.css'
import '../../src/dashboard-redesign.css'
import '../../src/home-screen.css'
import '../../src/bookkeeping.css'
import '../../src/components/dashboard-interactive.css'
import '../../src/components/dashboard-tiles.css'
import '../../src/components/fin-action-button.css'
import '../../src/components/ask-fin.css'
import '../../src/components/document-review.css'
import '../../src/components/record-detail.css'
import {supabase} from '../../src/lib/supabase'
import FinancialPerformance from '../../src/components/FinancialPerformance'
import JobsPage from '../../src/pages/JobsPage'
import PaymentSettings from '../../src/components/settings/PaymentSettings'
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',J='44444444-4444-4444-8444-444444444444'
const business:any={id:B,name:'Harbor Home Services',legal_name:'Harbor Home Services',role:'owner',primary_owner:true,created_by_user_id:U,access_modules:['jobs','billing','finances','calendar'],timezone:'America/New_York',currency:'USD',email:'office@example.test',phone:'+17575550123',profile_completed_at:'2026-11-01T12:00:00Z'}
const customer={id:C,first_name:'Taylor',last_name:'Morgan',company:null,email:'customer@example.test',phone:'+17575550100'}
const team=[{id:U,label:'Mike · Owner',role:'owner',is_you:true,active:true},{id:'55555555-5555-4555-8555-555555555555',label:'Jordan Williams',role:'worker',is_you:false,active:true}]
const now=new Date(),day=now.toISOString().slice(0,10),job={id:J,business_id:B,customer_id:C,title:'Kitchen renovation',status:'in_progress',description:'Install cabinetry, finish trim and review the completed work with the customer.',created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',assigned_user_ids:[U,team[1].id],customers:[customer],properties:[],scheduled_start:day+'T14:00:00Z',scheduled_end:day+'T17:00:00Z'}
const jobs=[job,{...job,id:'66666666-6666-4666-8666-666666666666',title:'Exterior trim repair',status:'lead',assigned_user_ids:[],scheduled_start:null,scheduled_end:null},{...job,id:'77777777-7777-4777-8777-777777777777',title:'Bathroom finish work',status:'scheduled',scheduled_start:day+'T19:00:00Z',scheduled_end:day+'T21:00:00Z'}]
let work:any={tasks:[{id:'t1',title:'Confirm materials and site access',completed:true,version:1,worker_id:U,due_on:day},{id:'t2',title:'Install cabinet doors and hardware',completed:false,version:1,worker_id:team[1].id,due_on:day}],activity:[{id:1,event:'Job created',created_at:'2026-11-01T12:00:00Z'}],financial_access:true,budget:{revenue:12000,cost:6500,hours:40,version:1},time:[{id:'time1',worked_on:day,minutes:240,hourly_cost:30,worker_id:U,note:'Cabinet preparation'}],recorded_expenses:2450,invoiced:12000,collected:4000,invoices:[{id:J,number:'INV-1040',status:'partial',total:12000,balance_due:8000}]}
let settings:any={payment_links:[],payment_service_setups:null,default_tax_rate:0,pricing_adjustment_percent:0,payment_instructions:'Please include your invoice number.'}
let fee={connected:false,enabled:false,environment:null,location:null,fee_requested:false,fee_basis_points:0,fee_active:false,fee_reason:'No surcharge is being collected. Provider, card eligibility and location-specific legal validation are required.'}
const records=Array.from({length:9},(_,n)=>({id:'receipt'+n,invoice_id:J,invoice_number:'INV-'+(1030+n),amount:1200+n*125,direction:'income',occurred_at:new Date(now.getFullYear(),now.getMonth()-n%4,Math.max(1,now.getDate()-n%6)).toISOString(),currency:'USD',method:'card'}))
const expenses=[{id:'exp1',entry_date:day,direction:'expense',amount:2450,currency:'USD',category:'Materials',description:'Cabinetry and finish supplies',job_id:J,jobs:{title:job.title},record_photos:[]}]
function query(value:any,table=''){let single=false;let filters:any={};let from=0,to=999;const q:any={select:()=>q,insert:()=>q,update:()=>q,upsert:()=>q,delete:()=>q,order:()=>q,eq:(k:string,v:any)=>{filters[k]=v;return q},in:()=>q,gte:()=>q,lte:()=>q,lt:()=>q,range:(a:number,b:number)=>{from=a;to=b;return q},limit:()=>q,maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},then:(resolve:any,reject:any)=>{let data=value;if(table==='jobs'&&filters.id)data=jobs.find(j=>j.id===filters.id);if(Array.isArray(data)){data=data.slice(from,to+1);if(single)data=data[0]||null}return Promise.resolve({data,error:null,count:Array.isArray(value)?value.length:1}).then(resolve,reject)}};return q}
;(supabase as any).rpc=(name:string,p:any={})=>{
 const values:any={get_plan_usage:{plan:'pro',ai_limit:100,ai_used:0,voice_limit:90,voice_used:0},get_schedule_team:team,get_financial_overview:{currency_supported:true,as_of:day,receivables:{invoices:6,outstanding:18750,overdue:3450,overdue_count:2},aging:[{bucket:'current',amount:15300,count:4},{bucket:'1–30 days',amount:2450,count:1},{bucket:'31–60 days',amount:1000,count:1}],customers:[{customer_id:C,customer:'Taylor Morgan',balance:12000,invoices:2},{customer_id:C,customer:'Avery Building Co.',balance:6750,invoices:4}],oldest:[{id:J,invoice_number:'INV-1037',due_date:'2026-09-28',balance_due:1000},{id:J,invoice_number:'INV-1039',due_date:'2026-10-20',balance_due:2450}]},list_invoice_cash_activity:records,get_job_workspace:work,get_job_workflow_context:jobs.map(j=>({job_id:j.id,active_appointment:j.status==='lead'?null:{id:j.id,starts_at:j.scheduled_start,ends_at:j.scheduled_end,status:'confirmed'},invoice:{id:J,number:'INV-1040',status:'partial'}})),square_payment_settings:fee}
 if(name==='manage_job_workspace'){const a=p.p_action,x=p.p_payload;if(a==='add_task')work={...work,tasks:[...work.tasks,{...x,completed:false,version:1}]};if(a==='complete_task')work={...work,tasks:work.tasks.map((t:any)=>t.id===x.id?{...t,completed:x.completed,version:t.version+1}:t)};if(a==='remove_task')work={...work,tasks:work.tasks.filter((t:any)=>t.id!==x.id)};if(a==='save_budget')work={...work,budget:{...x,version:x.version+1}};if(a==='add_time')work={...work,time:[...work.time,{...x,id:crypto.randomUUID()}]};work={...work,activity:[{id:Date.now(),event:'Work plan updated',created_at:new Date().toISOString()},...work.activity]};return query(work)}
 if(name==='square_payment_settings'&&p.p_requested!==undefined){fee={...fee,fee_requested:p.p_requested,fee_basis_points:p.p_basis_points};return query(fee)}
 return query(values[name]??[])
}
;(supabase as any).from=(name:string)=>query(name==='jobs'?jobs:name==='customers'?[customer]:name==='bookkeeping_entries'?expenses:name==='business_settings'?settings:name==='business_activity'?{version:1}:[],name)
;(supabase as any).functions.invoke=async()=>({data:{configured:false,available:false,state:'disabled'},error:null})
;(supabase as any).channel=()=>({on(){return this},subscribe(){return this}})
;(supabase as any).removeChannel=async()=>{}
;(supabase as any).auth.getSession=async()=>({data:{session:null},error:null})
function Preview(){const[view,setView]=useState(new URLSearchParams(location.search).get('screen')||'finance');const mobile=new URLSearchParams(location.search).get('phone')==='1';return <div style={{maxWidth:1240,margin:'0 auto',padding:mobile?12:28}}><div style={{marginBottom:24,display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}><strong style={{color:'#257f73'}}>Finviant QA · synthetic data</strong>{['finance','jobs','payments'].map(v=><button type="button" key={v} className="secondary-button compact" onClick={()=>setView(v)}>{v==='finance'?'Financial dashboard':v==='jobs'?'Jobs dashboard':'Payment setup'}</button>)}<a href={'?screen='+view+'&phone=1'}>Phone layout</a></div>{view==='finance'?<FinancialPerformance business={business}/>:view==='jobs'?<JobsPage business={business}/>:<PaymentSettings business={business}/>}</div>}
const params=new URLSearchParams(location.search)
if(params.get('phone')==='1'&&self===top){const child=new URL(location.href);child.searchParams.set('embedded','1');createRoot(document.getElementById('root')!).render(<div style={{display:'grid',placeItems:'start center',padding:24,background:'#e8eef1',minHeight:'100vh'}}><iframe src={child.href} title="Finviant phone layout" style={{width:390,height:900,border:'1px solid #c7d3db',borderRadius:20,background:'white'}}/></div>)}else createRoot(document.getElementById('root')!).render(<Preview/>);
