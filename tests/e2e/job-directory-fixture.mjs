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

// Fixtures supply current in-memory rows directly. Avoid nested page.evaluate/fetch
// inside an intercepted route: an unrelated refresh can outlive a finished test.
export async function mockJobDirectory(page,readRows,zone='America/New_York'){
 await page.route('https://example.supabase.co/rest/v1/rpc/get_job_directory_page',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'},body:''})
  const params=route.request().postDataJSON()
  return route.fulfill({headers:{'access-control-allow-origin':'*'},json:jobDirectoryPage(readRows(params),params,zone)})
 })
}
