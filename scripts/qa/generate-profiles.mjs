import { writeFileSync } from 'node:fs'
export const DATASET = 'finviant-chaos-v1'
export const FUNCTIONS = ['createInvoice','createEstimate','createChangeOrder','recordPayment','addManualEntry','listVelnuWorkbook','listQuickBooksWorkbook','getDashboardSnapshot','parseQuickInvoice','assistantMonthlyTotal']
export const TENANT = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '22222222-2222-4222-8222-222222222222'
const industries = ['Plumber','Landscaper','Electrician','Restaurant','Cleaner','Salon','Consultant','Auto repair','Roofer','Retailer','Childcare','Trucker','Photographer','Caterer','Carpenter','HVAC','Welder','Tutor','Dog groomer','Painter','Farmer','IT consultant','Fitness trainer','Baker','Nonprofit']
const names = ["O’Connor & Sons",'株式会社テスト','مؤسسة تجريبية','QA <script>alert(1)</script>',"QA Robert'); DROP TABLE invoices; --",'QA José & Zoë','QA 🛠️ Services','QA A/B?&=%#','QA NULL','QA New venture']
function documentInput(i) {
 const v=i%20, amount=(i*137+1)/100
 const input={customer_id:CUSTOMER,job_id:'33333333-3333-4333-8333-333333333333',title:'QA change '+i,items:[{description:'QA service '+i,quantity:1+(i%9)/10,unit_price:amount,tax_rate:(i%4)*2.25}],notes:names[i%names.length],request_id:'44444444-4444-4444-8444-'+String(i).padStart(12,'0')}
 if(v<10)return {input,expect:'accept'}
 const invalid=[null,{}, {...input,items:null},{...input,items:[null]},{...input,items:[{description:8,quantity:1,unit_price:1}]},{...input,items:[{description:'QA',quantity:'1',unit_price:1}]},{...input,items:[{description:'QA',quantity:1,unit_price:-1}]},{...input,items:[{description:'QA',quantity:1,unit_price:1,tax_rate:101}]},{...input,notes:{bad:true}},{...input,due_date:'2027-02-30'}]
 return {input:invalid[v-10],expect:'reject'}
}
export function generateProfiles() {
 return FUNCTIONS.flatMap((fn,batch)=>Array.from({length:100},(_,n)=>{
  const id=batch*100+n+1, v=n%20
  let test
  if(['createInvoice','createEstimate','createChangeOrder'].includes(fn)) test=documentInput(id)
  else if(fn==='recordPayment') {
   const input={invoice_id:CUSTOMER,amount:(id*19+1)/100,method:['cash','check','ach','card','other'][n%5],notes:names[n%10]}
   const bad=[null,{}, {...input,amount:0},{...input,amount:-1},{...input,amount:'200'},{...input,amount:1.999},{...input,amount:1e308},{...input,method:'wire-unknown'},{...input,notes:[]},{...input,invoice_id:42}]
   test={input:v<10?input:bad[v-10],expect:v<10?'accept':'reject'}
  } else if(fn==='addManualEntry') {
   const input={id:'55555555-5555-4555-8555-'+String(id).padStart(12,'0'),business_id:TENANT,entry_date:'2028-02-29',direction:n%2?'income':'expense',amount:(id*17+1)/100,category:'QA Operations',description:names[n%10]}
   const bad=[null,{}, {...input,amount:0},{...input,amount:-1},{...input,amount:'20'},{...input,amount:1.999},{...input,entry_date:'2027-02-30'},{...input,direction:'sideways'},{...input,description:42},{...input,category:null}]
   test={input:v<10?input:bad[v-10],expect:v<10?'accept':'reject'}
  } else if(['listVelnuWorkbook','listQuickBooksWorkbook'].includes(fn)) {
   test={input:{size:[0,1,99,100,101,1001][n%6],amount:(id*13+1)/100,fault:n<80?null:['bad-amount','null-amount','timeout','missing-count'][n%4]},expect:n<80?'accept':'reject'}
  } else if(fn==='getDashboardSnapshot') {
   test={input:{balance:(id*23+1)/100,count:n,fault:n<80?null:['bad-amount','null-amount','timeout','missing-total'][n%4]},expect:n<80?'accept':'reject'}
  } else if(fn==='parseQuickInvoice') {
   const amount=(id*11+1)/100
   const bad=['Create invoice for QA for refund $20','Create invoice for QA for $-10','Create invoice for QA for $1.999','Create invoice for QA for $1e3','Create invoice for QA for $10 plus $20','Create invoice for QA for $99999999999999999999999999',null,{},42,[]]
   test=v<10?{input:'Create invoice for QA'+id+' for service: Repair $'+amount.toFixed(2),expect:'accept',amount:amount.toFixed(2)}:{input:bad[v-10],expect:typeof bad[v-10]==='string'?'empty':'reject'}
  } else {
   const input={tier:['free','basic','pro'][n%3],choices:n%2?['scheduling_assistant','scheduling_assistant']:['scheduling_assistant','bookkeeping_assistant']}
   const bad=[{tier:'enterprise',choices:[]},{tier:null,choices:[]},{tier:'pro',choices:null},{tier:'basic',choices:[{}]},{tier:'pro',choices:'scheduling_assistant'}]
   test={input:v<15?input:bad[v-15],expect:v<15?'accept':'reject'}
  }
  const chaos=[0,-id*100,1e308,'1e1000',null,'$1,200.25',{},[],true,(id*101.17)]
  return {dataset_id:DATASET,scenario_id:id,function_name:fn,batch:batch+1,profile:{synthetic:true,owner:{name:names[n%10]+' '+id,email:'owner-'+id+'@example.invalid',industry:industries[id%industries.length]},financial_context:{monthly_revenue:chaos[n%10],debt:chaos[(n+3)%10],cash_on_hand:n%3? id*10:0,employees:n%7},customer:{name:'QA Customer '+id,company:names[(n+3)%10],email:n%8?'customer-'+id+'@example.invalid':null,notes:n%5?null:'<img src=x onerror=alert(1)>'},test}}
 }))
}
export function seedSql() {
 const rows=generateProfiles()
 const values=rows.map(r=>'('+["'"+r.dataset_id+"'",r.scenario_id,"'"+r.function_name+"'",r.batch,"'"+JSON.stringify(r.profile).replaceAll("'","''")+"'::jsonb"].join(',')+')').join(',\n')
 return `-- STAGING ONLY: xvybcmyoblfgzokaifsx. Synthetic profiles; no business/customer table writes.\nbegin;\ninsert into public.finviant_qa_profiles(dataset_id,scenario_id,function_name,batch,profile) values\n${values}\non conflict(dataset_id,scenario_id) do nothing;\ndo $qa$ begin if (select count(*) from public.finviant_qa_profiles where dataset_id='${DATASET}')<>1000 then raise exception 'Expected exactly 1000 profiles';end if;end $qa$;\ncommit;\n`
}
if(process.argv.includes('--write')) { writeFileSync('scripts/qa/mock-profiles.json',JSON.stringify(generateProfiles(),null,2)+'\n'); writeFileSync('scripts/qa/seed-staging.sql',seedSql());console.log('Generated exactly 1000 profiles; 100 per function.') }
