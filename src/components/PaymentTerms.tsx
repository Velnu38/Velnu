import {DateTime} from 'luxon'
import {useState} from 'react'
export default function PaymentTerms({issued,value,onChange,kind='invoice',customDate=false}:{issued:string;value:string;onChange:(value:string)=>void;kind?:'invoice'|'estimate';customDate?:boolean}){
 const date=DateTime.fromISO(issued),days=date.isValid?Math.round(DateTime.fromISO(value).diff(date,'days').days):NaN
 const[custom,setCustom]=useState(![0,7,14,30].includes(days))
 return <div className="payment-terms-control"><label>{kind==='invoice'?'Payment terms':'Estimate validity'}<select aria-label={kind==='invoice'?'Payment terms':'Estimate validity'} value={customDate&&custom?'custom':[0,7,14,30].includes(days)?String(days):'custom'} onChange={e=>{setCustom(e.target.value==='custom');if(e.target.value!=='custom'&&date.isValid)onChange(date.plus({days:Number(e.target.value)}).toISODate()!)}}><option value="custom">Custom date</option>{[0,7,14,30].map(n=><option key={n} value={n}>{n===0?(kind==='invoice'?'Due on issue date':'Expires on issue date'):kind==='invoice'?customDate?`Due in ${n} days`:`Net ${n} days`:`Valid for ${n} days`}</option>)}</select></label>{customDate&&(custom||![0,7,14,30].includes(days))&&<label>{kind==='estimate'?'Valid until':'Due date'}<input required type="date" min={issued} value={value} onChange={event=>onChange(event.target.value)}/></label>}</div>
}
