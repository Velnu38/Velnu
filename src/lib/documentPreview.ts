import { DateTime } from 'luxon'
import { previewDocumentTotal } from './financialValidation'
export function documentEndDate(issued:string,kind:'invoice'|'estimate') {
 return DateTime.fromISO(issued,{zone:'UTC'}).plus({days:kind==='estimate'?30:0}).toISODate()||''
}
export function previewAmounts(items:readonly {quantity:unknown;unit_price:unknown;tax_rate?:unknown}[]) {
 const total=previewDocumentTotal(items)
 const subtotal=previewDocumentTotal(items.map(item=>({...item,tax_rate:0})))
 return {total:total??0,subtotal:subtotal??0,tax:total===null||subtotal===null?0:Math.round((total-subtotal)*100)/100}
}
