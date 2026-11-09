import {DateTime} from 'luxon'
export default function PaymentTerms({issued,value,onChange,kind='invoice'}:{issued:string;value:string;onChange:(value:string)=>void;kind?:'invoice'|'estimate'}){
 const date=DateTime.fromISO(issued),days=date.isValid?Math.round(DateTime.fromISO(value).diff(date,'days').days):NaN
 return <label>{kind==='invoice'?'Payment terms':'Estimate validity'}<select aria-label={kind==='invoice'?'Payment terms':'Estimate validity'} value={[0,7,14,30].includes(days)?String(days):'custom'} onChange={e=>{if(e.target.value!=='custom'&&date.isValid)onChange(date.plus({days:Number(e.target.value)}).toISODate()!)}}><option value="custom">Custom date</option>{[0,7,14,30].map(n=><option key={n} value={n}>{n===0?(kind==='invoice'?'Due on issue date':'Expires on issue date'):kind==='invoice'?`Net ${n} days`:`Valid for ${n} days`}</option>)}</select></label>
}
