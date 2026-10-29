import { validDecimal, validCalendarDate, readFinancialNumber, validateDocumentInput } from '../../src/lib/financialValidation.ts'
function assert(value:unknown,message='Validation assertion failed'):asserts value{if(!value)throw new Error(message)}
Deno.test('legitimate high-value cents are not rejected by binary multiplication noise',()=>{
 for(const amount of [8388913.46,8389151.03,8389230.22,8389467.79,8389784.55,9999999.99,999999999.99])assert(validDecimal(amount,0,1000000000),'Rejected legitimate amount '+amount)
 for(let i=0;i<1000;i++){const amount=(838860800+i*7919)/100;assert(validDecimal(amount,0,10000000),'Rejected generated cents '+amount)}
})
Deno.test('noncanonical fractional cents and wrong types fail before database writes',()=>{
 for(const value of [1.999,0.1+0.2,'20',null,{},[],true,NaN,Infinity,-1,1000000001])assert(!validDecimal(value,0,1000000000),'Accepted unsafe amount '+String(value))
})
Deno.test('impossible dates and malformed stored financial values are rejected',()=>{
 assert(validCalendarDate('2028-02-29'));assert(!validCalendarDate('2027-02-29'));assert(!validCalendarDate('2027-02-30'))
 for(const value of [null,'','NaN',{},[],Infinity,'1e999']){let rejected=false;try{readFinancialNumber(value)}catch{rejected=true}assert(rejected,'Invalid stored amount was silently accepted')}
})
Deno.test('null and malformed document input gives an intentional validation error',()=>{
 for(const value of [null,{}, {customer_id:'customer',items:[null]},{customer_id:'customer',items:[{description:42,quantity:1,unit_price:2}]}]){let error:unknown;try{validateDocumentInput(value)}catch(e){error=e}assert(error instanceof Error && !(error instanceof TypeError))}
})
Deno.test('aggregate document bounds use exact cents before any write',()=>{
 const base={customer_id:'customer',items:[{description:'Large supported job',quantity:100000,unit_price:10000000,tax_rate:0}]}
 validateDocumentInput(base)
 let rejected=false;try{validateDocumentInput({...base,items:[{...base.items[0],tax_rate:100}]})}catch{rejected=true}assert(rejected,'Unsafe aggregate was accepted')
 for(let i=0;i<100;i++){const quantity=99999+(i%100)/100;validateDocumentInput({customer_id:'customer',items:[{description:'Boundary '+i,quantity,unit_price:10000000,tax_rate:0}]})}
 let invalid=false;try{readFinancialNumber(1000000000000.01)}catch{invalid=true}assert(invalid,'Unsupported report aggregate was accepted')
})
