import {expect} from '@playwright/test'
import {mock,B,C,E} from './audit-fixture.mjs'
import {openFinTyping} from './navigation.mjs'
export const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
export const item=(description,price,quantity='1',tax='0')=>({description,unit_price:String(price),quantity:String(quantity),tax_rate:String(tax)})
export const step=(operation,fields={},target=null,customer=null)=>({operation,fields,target,customer,request_id:crypto.randomUUID(),label:operation.replaceAll('_',' '),...(fields.items?{total:fields.items.reduce((s,i)=>s+Math.round(Number(i.quantity)*Number(i.unit_price)*100)/100+Math.round(Number(i.quantity)*Number(i.unit_price)*Number(i.tax_rate))/100,0).toFixed(2)}:{})})
export const docStep=(kind='invoice',items=[item('Landscaping',200),item('Painting',100)])=>({...step('create_'+kind,{items},null,'customers:'+C),customer_record:{id:C,first_name:'Test',last_name:'Customer'}})
export function reply(steps=[],extra={}){return {answer:steps.length?'Ready for your review.':'Here is the saved information.',sources:[],limits:[],as_of:new Date().toISOString(),navigation:[],clarification:null,...extra,...(steps.length?{plan:{id:crypto.randomUUID(),version:1,expires_at:new Date(Date.now()+900000).toISOString(),destructive:steps.some(s=>/archive|void|cancel/.test(s.operation)),steps}}:{})}}
// Browser contracts are synthetic. SQL/handler suites verify authorization and calculations.
export async function workflow(page,{steps=[docStep()],respond,contact={email:'customer@example.test',phone:null}}={}){
 const state=await mock(page,{ai:true});state.customers[0]={...state.customers[0],...contact};const requests=[],executions=[],plans=new Map();let latest
 await page.route('**/functions/v1/fin-workflow',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});const body=route.request().postDataJSON();requests.push(body);latest=respond?await respond(body,requests.length):reply(steps);if(latest.plan)plans.set(latest.plan.id,latest.plan);return route.fulfill({status:200,headers:cors,json:latest})})
 await page.route('**/rest/v1/rpc/fin_execute_review',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});const body=route.request().postDataJSON();executions.push(body);const plan=plans.get(body.p_review);const results=plan.steps.map(s=>({operation:s.operation,resource:s.operation.includes('invoice')?'invoices':s.operation.includes('estimate')?'estimates':'customers',id:E,label:s.label,status:'completed'}));for(const s of plan.steps)if(s.operation==='create_invoice'||s.operation==='create_estimate')state.documents.push({document_kind:s.operation.slice(7),payload:s.fields,request_id:s.request_id});return route.fulfill({status:200,headers:cors,json:{status:'completed',steps:results}})})
 for(const table of ['invoices','estimates','change_orders'])await page.route('**/rest/v1/'+table+'?*',route=>{if(new URL(route.request().url()).searchParams.get('select')?.startsWith('customer_id,status,customers'))return route.fulfill({status:200,headers:cors,json:{customer_id:C,status:'draft',customers:state.customers[0]}});return route.fallback()})
 await page.route('**/rest/v1/rpc/fin_cancel_review',route=>route.fulfill({status:200,headers:cors,json:null}))
 return {state,requests,executions,plans}
}
export async function ask(page,text){await page.getByRole('textbox',{name:'Describe your invoice or request'}).fill(text);await page.getByRole('button',{name:'Ask Fin',exact:true}).click()}
export async function start(page,text='Create invoice for Test Customer: landscaping $200 and painting $100'){await page.goto('/');await openFinTyping(page);await ask(page,text)}
export const review=page=>page.getByRole('region',{name:'Review Fin’s plan'})
export async function save(page){
 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/fin_execute_review')&&r.request().method()==='POST'),review(page).getByRole('button',{name:'Confirm and save',exact:true}).click()])
 if(response.ok()){
  await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toBeVisible({timeout:15000})
  await expect(page.getByRole('status').filter({hasText:'Loading saved document delivery options…'})).toHaveCount(0,{timeout:15000})
 }
}
