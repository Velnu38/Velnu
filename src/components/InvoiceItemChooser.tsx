import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {collectBusinessRecords} from '../lib/businessRecords'
import {addPackage,type PackageLine} from '../lib/servicePackages'
import type {DraftLine} from './DocumentLineEditor'
import ServiceItemPicker from './ServiceItemPicker'
import ServicePackagePicker from './ServicePackagePicker'

type Choice={id:string;label:string;kind:'service'|'package';items:PackageLine[]}
export default function InvoiceItemChooser({businessId,lines,onChange,newLine}:{businessId:string;lines:DraftLine[];onChange:(lines:DraftLine[])=>void;newLine:()=>DraftLine}){
 const[open,setOpen]=useState(false),[choices,setChoices]=useState<Choice[]>([]),[search,setSearch]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 const trigger=useRef<HTMLButtonElement>(null),container=useRef<HTMLDivElement>(null)
 useEffect(()=>{let active=true;if(!open)return;setLoading(true);setError('');setChoices([])
  void Promise.allSettled([
   collectBusinessRecords((from,to)=>supabase.from('service_items').select('id,description,unit_price,tax_rate',{count:'exact'}).eq('business_id',businessId).eq('active',true).order('id').range(from,to)),
   collectBusinessRecords((from,to)=>supabase.from('service_packages').select('id,name,items',{count:'exact'}).eq('business_id',businessId).eq('active',true).order('id').range(from,to))
  ]).then(([services,packages])=>{if(!active)return
   setChoices([...(services.status==='fulfilled'?services.value.map(item=>({id:item.id,label:item.description,kind:'service' as const,items:[{description:item.description,quantity:1,unit_price:Number(item.unit_price),tax_rate:Number(item.tax_rate)}]})):[]),...(packages.status==='fulfilled'?packages.value.map(item=>({id:item.id,label:item.name,kind:'package' as const,items:item.items})):[])].sort((a,b)=>a.label.localeCompare(b.label)))
   if(services.status==='rejected'||packages.status==='rejected')setError('Some saved items could not load. You can still enter an item manually.')
   setLoading(false)
  });return()=>{active=false}
 },[businessId,open,attempt])
 useEffect(()=>{if(open)container.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()},[open])
 function finish(next:DraftLine[],manual=false){onChange(next);setOpen(false);setSearch('');queueMicrotask(()=>{if(manual)trigger.current?.closest('.invoice-work-editor')?.querySelectorAll<HTMLInputElement>('input[aria-label$="description"]').item(next.length-1)?.focus();else trigger.current?.focus()})}
 return <div ref={container} className="invoice-item-chooser">
  <button ref={trigger} type="button" className="text-button invoice-add-item" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>+ Add item</button>
  {open&&<section className="invoice-item-choices" aria-label="Add an invoice item">
   <button type="button" className="secondary-button" onClick={()=>{const empty=lines.findIndex(line=>!line.description.trim()&&!line.unit_price.trim());if(empty>=0){setOpen(false);queueMicrotask(()=>trigger.current?.closest('.invoice-work-editor')?.querySelectorAll<HTMLInputElement>('input[aria-label$="description"]').item(empty)?.focus())}else finish([...lines,newLine()],true)}} disabled={lines.length>=50&&!lines.some(line=>!line.description.trim()&&!line.unit_price.trim())}>Enter an item manually</button>
   <label>Find a service or package<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search saved items"/></label>
   {loading&&<p role="status">Loading saved items…</p>}
   {error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setAttempt(value=>value+1)}>Retry saved items</button></p>}
   {!loading&&!choices.length&&!error&&<p className="quiet">No saved items yet. Enter your work and price manually.</p>}
   <ul>{choices.filter(choice=>choice.label.toLowerCase().includes(search.trim().toLowerCase())).map(choice=><li key={choice.kind+choice.id}><button type="button" onClick={()=>{try{finish(addPackage(lines,choice.items))}catch(failure){setError((failure as Error).message)}}}><span>{choice.label}<small>{choice.kind==='package'?`${choice.items.length} items`:'Saved service'}</small></span><strong>{choice.kind==='service'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(choice.items[0].unit_price):'Add package'} <span aria-hidden="true">›</span></strong></button></li>)}</ul>
   <details><summary>Manage saved items</summary><ServiceItemPicker businessId={businessId} lines={lines} onChange={onChange}/><ServicePackagePicker businessId={businessId} lines={lines} onChange={onChange}/></details>
  </section>}
 </div>
}
