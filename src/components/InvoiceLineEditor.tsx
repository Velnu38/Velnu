import {useEffect,useRef,useState} from 'react'
import type {DraftLine} from './DocumentLineEditor'
import {previewDocumentTotal} from '../lib/financialValidation'
import InvoiceItemChooser from './InvoiceItemChooser'

function InvoiceItem({line,index,onChange,onRemove}:{line:DraftLine;index:number;onChange:(key:keyof DraftLine,value:string)=>void;onRemove:()=>void}){
 const[quantityOpen,setQuantityOpen]=useState(Number(line.quantity)!==1)
 useEffect(()=>{if(Number(line.quantity)!==1)setQuantityOpen(true)},[line.quantity])
 const multiple=Number(line.quantity)!==1,subtotal=previewDocumentTotal([{...line,tax_rate:'0'}])
 return <fieldset className="invoice-item-card"><legend>Item {index+1}</legend>
  <label>Description<input aria-label={`Line ${index+1} description`} placeholder="Work performed" required maxLength={2000} value={line.description} onChange={event=>onChange('description',event.target.value)}/></label>
  <label>{multiple?'Unit price':'Amount'}<input aria-label={`Line ${index+1} unit price`} placeholder="0.00" inputMode="decimal" type="number" min="0" step="0.01" required value={line.unit_price} onChange={event=>onChange('unit_price',event.target.value)}/></label>
  <details className="invoice-item-quantity" open={quantityOpen} onToggle={event=>setQuantityOpen(event.currentTarget.open)}><summary>Quantity <span>{line.quantity||'Check quantity'}</span></summary><label>Quantity<input aria-label={`Line ${index+1} quantity`} inputMode="decimal" type="number" min="0.01" max="100000" step="0.01" required value={line.quantity} onChange={event=>onChange('quantity',event.target.value)}/></label>{multiple&&subtotal!==null&&<p className="quiet">Item subtotal: ${subtotal.toFixed(2)} before tax</p>}</details>
  {(line.description||line.unit_price)&&<button type="button" className="text-button invoice-remove-item" aria-label={`Remove line ${index+1}${line.description?': '+line.description:''}`} onClick={onRemove}>×</button>}
 </fieldset>
}
export default function InvoiceLineEditor({businessId,lines,onChange,newLine}:{businessId:string;lines:DraftLine[];onChange:(lines:DraftLine[])=>void;newLine:()=>DraftLine}){
 const[removed,setRemoved]=useState<{line:DraftLine;index:number}|null>(null),undo=useRef<HTMLButtonElement>(null)
 return <section className="invoice-work-editor line-items" aria-label="Work and price"><h3>Work &amp; price</h3>
  {lines.map((line,index)=><InvoiceItem key={index} line={line} index={index} onChange={(key,value)=>onChange(lines.map((current,n)=>n===index?{...current,[key]:value}:current))} onRemove={()=>{setRemoved({line,index});onChange(lines.length===1?[newLine()]:lines.filter((_,n)=>n!==index));queueMicrotask(()=>undo.current?.focus())}}/>)}
  {removed&&<p role="status">Item removed. <button ref={undo} type="button" className="text-button" onClick={()=>{const next=[...lines];if(next.length===1&&!next[0].description&&!next[0].unit_price)next.splice(0,1);next.splice(Math.min(removed.index,next.length),0,removed.line);onChange(next);setRemoved(null)}}>Undo removal</button></p>}
  <InvoiceItemChooser businessId={businessId} lines={lines} onChange={onChange} newLine={newLine}/>
 </section>
}
export function InvoiceTaxOptions({lines,onChange,rate,onRate}:{lines:DraftLine[];onChange:(lines:DraftLine[])=>void;rate:string;onRate:(rate:string)=>void}){
 const mixed=lines.some(line=>Number(line.tax_rate)!==Number(rate))
 return <section className="invoice-tax-options" aria-label="Invoice tax"><label>Tax (%)<input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={rate} onChange={event=>{const next=event.target.value;onRate(next);onChange(lines.map(line=>Number(line.tax_rate)===Number(rate)?{...line,tax_rate:next}:line))}}/></label><details open={mixed||undefined}><summary>Per-item tax rates{mixed?' · Overrides applied':''}</summary>{lines.map((line,index)=><label key={index}>Item {index+1}{line.description?' · '+line.description:''}<input aria-label={`Line ${index+1} Tax rate (%)`} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={line.tax_rate} onChange={event=>onChange(lines.map((current,n)=>n===index?{...current,tax_rate:event.target.value}:current))}/></label>)}</details></section>
}
