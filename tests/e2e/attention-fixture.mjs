import {DateTime} from 'luxon'
// Browser transport fixture only. Database pagination/authorization has separate PGlite tests.
export function attentionPage(args,{workflow={approved:[],completed:[]},invoices=[],estimates=[],changeOrders=[],reminders=[]}={}) {
 const today=DateTime.now().setZone('America/New_York').toISODate()
 const customers=data=>({...data,customers:Array.isArray(data.customers)?data.customers:[data.customers].filter(Boolean)})
 const groups=[
  workflow.approved.map(data=>({kind:'approved',data})),workflow.completed.map(data=>({kind:'completed',data})),
  reminders.filter(r=>r.status==='pending'&&Date.parse(r.due_at)<=Date.now()).sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.id.localeCompare(b.id)).map(data=>({kind:'reminder',data})),
  invoices.filter(i=>['sent','viewed','partial','overdue'].includes(i.status)&&Number(i.balance_due)>0&&i.due_date<today).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id.localeCompare(b.id)).map(data=>({kind:'invoice',data:customers(data)})),
  [...estimates.filter(e=>e.status==='sent').map(e=>({kind:'estimate',data:{...customers(e),document_type:'estimate',number:e.estimate_number,title:'Estimate awaiting approval'}})),
   ...changeOrders.filter(c=>c.status==='sent').map(c=>({kind:'change_order',data:{...customers(c),document_type:'change_order',number:c.change_order_number}}))].sort((a,b)=>a.data.issue_date.localeCompare(b.data.issue_date)||a.kind.localeCompare(b.kind)||a.data.id.localeCompare(b.data.id))
 ]
 const all=[];for(let n=0;n<Math.max(0,...groups.map(g=>g.length));n++)for(const group of groups)if(group[n])all.push(group[n])
 const items=args.p_filter==='approvals'?groups[4]:all
 const size=args.p_page_size||5,page=Math.max(1,Math.min(args.p_page||1,Math.ceil(items.length/size)))
 return {page,page_size:size,total:items.length,attention_count:all.length,approval_count:groups[4].length,items:items.slice((page-1)*size,page*size)}
}
