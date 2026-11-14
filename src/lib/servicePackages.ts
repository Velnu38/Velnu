import type {DraftLine} from '../components/DocumentLineEditor'
import {isRecord,previewDocumentTotal,validDecimal} from './financialValidation'
export type PackageLine={description:string;quantity:number;unit_price:number;tax_rate:number}
export function packageLines(lines:DraftLine[]):PackageLine[]{
 if(lines.length<1||lines.length>50)throw Error('A package needs 1 to 50 complete lines.')
 const items=lines.map(line=>({description:line.description.trim(),quantity:Number(line.quantity),unit_price:Number(line.unit_price),tax_rate:Number(line.tax_rate||0)}))
 if(lines.some(line=>!line.quantity.trim()||!line.unit_price.trim())||items.some(item=>!item.description||item.description.length>2000||!validDecimal(item.quantity,.01,100000)||!validDecimal(item.unit_price,0,10000000)||!validDecimal(item.tax_rate,0,100))||previewDocumentTotal(items)===null)throw Error('Complete every package line with a description and valid quantity, price and tax.')
 return items
}
export function addPackage(lines:DraftLine[],items:unknown):DraftLine[]{
 if(!Array.isArray(items)||items.some(item=>!isRecord(item)||typeof item.description!=='string'||!validDecimal(item.quantity,.01,100000)||!validDecimal(item.unit_price,0,10000000)||!validDecimal(item.tax_rate,0,100)))throw Error('This package could not be verified. Reload before adding it.')
 const additions=items.map(item=>({description:item.description,quantity:String(item.quantity),unit_price:String(item.unit_price),tax_rate:String(item.tax_rate)}))
 packageLines(additions)
 // Only remove untouched empty rows. A partial description or price is an edit.
 const kept=lines.filter(line=>line.description.trim()||line.unit_price.trim())
 if(kept.length+additions.length>50)throw Error('This package would exceed the 50-line limit. Remove lines before adding it.')
 return [...kept,...additions]
}
