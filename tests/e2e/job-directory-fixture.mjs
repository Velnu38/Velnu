import {DateTime} from 'luxon'

// Synthetic API response for existing browser journeys. SQL/real-session tests
// independently exercise the actual pagination, permissions and filter function.
export function jobDirectoryPage(jobs,params,zone='America/New_York',now=Date.now()){
 const day=DateTime.fromMillis(now,{zone}).startOf('day'),next=day.plus({days:1})
 const keys=['all','active','today','unscheduled','in_progress','billing','attention','unassigned','scheduled','completed','current','upcoming','history']
 const counts=Object.fromEntries(keys.map(k=>[k,0]))
 const rows=jobs.filter(j=>(!params.p_customer||j.customer_id===params.p_customer)&&(!params.p_worker||j.assigned_user_ids?.includes(params.p_worker))).map(j=>{
  const a=j.active_appointment,start=Date.parse(j.scheduled_start),booked=!!a&&['scheduled','confirmed','in_progress'].includes(a.status)&&start===Date.parse(a.starts_at)&&(!j.scheduled_end||!a.ends_at||Date.parse(j.scheduled_end)===Date.parse(a.ends_at))
  const active=['lead','scheduled','in_progress'].includes(j.status),history=['completed','canceled'].includes(j.status)
  const attention=['scheduled','in_progress'].includes(j.status)&&booked&&start<=now&&(j.scheduled_end?Date.parse(j.scheduled_end)<=now:start<day.toMillis())
  const flags={all:true,active,today:booked&&!history&&start>=day.toMillis()&&start<next.toMillis(),unscheduled:['lead','scheduled'].includes(j.status)&&!booked,in_progress:j.status==='in_progress',billing:j.status==='completed'&&(!j.invoice||j.invoice.status==='draft'),attention,unassigned:active&&!j.assigned_user_ids?.length,scheduled:['lead','scheduled'].includes(j.status)&&booked,completed:j.status==='completed',history,upcoming:!history&&j.status!=='in_progress'&&booked&&start>=next.toMillis(),current:!history&&(j.status==='in_progress'||!booked||start<next.toMillis())}
  for(const k of keys)if(flags[k])counts[k]++
  const customers=Array.isArray(j.customers)?j.customers:j.customers?[j.customers]:[]
  const labels={lead:'Needs scheduling',in_progress:'In progress'}
  const search=[j.title,j.status,labels[j.status]||j.status,...customers.map(c=>[c.first_name,c.last_name,c.company].join(' '))].join(' ').toLowerCase()
  return {item:{...j,customers,properties:Array.isArray(j.properties)?j.properties:j.properties?[j.properties]:[],active_appointment:a||null,invoice:j.invoice||null},flags,search,start}
 }).filter(r=>r.flags[params.p_filter||'active']&&r.search.includes((params.p_search||'').trim().toLowerCase()))
 rows.sort((a,b)=>(params.p_filter==='active'?Number(b.flags.attention)-Number(a.flags.attention):0)||((Number.isFinite(a.start)?a.start:Infinity)-(Number.isFinite(b.start)?b.start:Infinity))||a.item.id.localeCompare(b.item.id))
 const page=Math.min(params.p_page||0,Math.max(0,Math.ceil(rows.length/25)-1))
 return {items:rows.slice(page*25,(page+1)*25).map(r=>r.item),total:rows.length,page,page_size:25,counts,checked_at:new Date(now).toISOString()}
}

// Reuse each journey's existing mocked jobs/workflow sources, including its
// mutations and explicit failures. Every request is fixed to the fake API host.
export async function mockJobDirectory(page){
 await page.route('https://example.supabase.co/rest/v1/rpc/get_job_directory_page',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'},body:''})
  const params=route.request().postDataJSON()
  const result=await page.evaluate(async params=>{
   const url=new URL('https://example.supabase.co/rest/v1/jobs')
   url.searchParams.set('select','*,customers(*),properties(*)');url.searchParams.set('business_id','eq.'+params.p_business)
   if(params.p_customer)url.searchParams.set('customer_id','eq.'+params.p_customer)
   const response=await fetch(url)
   const rows=await response.json()
   if(!response.ok)return {error:rows,status:response.status}
   if(!Array.isArray(rows))throw Error('Directory fixture requires an array of jobs')
   const contexts=[]
   for(let i=0;i<rows.length;i+=200){
    const r=await fetch('https://example.supabase.co/rest/v1/rpc/get_job_workflow_context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_business:params.p_business,p_jobs:rows.slice(i,i+200).map(j=>j.id)})})
    const data=await r.json();if(!r.ok)return {error:data,status:r.status};contexts.push(...data)
   }
   return {rows:rows.map(j=>({...j,...contexts.find(c=>c.job_id===j.id)})),now:Date.now()}
  },params)
  await route.fulfill({headers:{'access-control-allow-origin':'*'},...(result.error?{status:result.status,json:result.error}:{json:jobDirectoryPage(result.rows,params,'America/New_York',result.now)})})
 })
}
