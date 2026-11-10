import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {collectBusinessRecords} from '../lib/businessRecords'
import {addPackage,packageLines,type PackageLine} from '../lib/servicePackages'
import type {DraftLine} from './DocumentLineEditor'
type Package={id:string;name:string;items:PackageLine[]}
export default function ServicePackagePicker({businessId,lines,onChange}:{businessId:string;lines:DraftLine[];onChange:(lines:DraftLine[])=>void}){
 const [opened,setOpened]=useState(false),[packages,setPackages]=useState<Package[]>([]),[selected,setSelected]=useState(''),[name,setName]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const saving=useRef(false)
 useEffect(()=>{let active=true;if(!opened)return;setError('');setLoading(true);void collectBusinessRecords((from,to)=>supabase.from('service_packages').select('id,name,items',{count:'exact'}).eq('business_id',businessId).eq('active',true).order('id').range(from,to)).then(rows=>{if(active){setPackages((rows as Package[]).sort((a,b)=>a.name.localeCompare(b.name)));setSelected(current=>rows.some(row=>row.id===current)?current:'')}}).catch(()=>{if(active)setError('Service packages could not load. You can still enter lines manually.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[businessId,opened])
 async function save(){if(saving.current||loading)return;setError('');setNotice('');try{
  if(!name.trim()||name.trim().length>120)throw Error('Enter a package name with at most 120 characters.')
  const items=packageLines(lines);saving.current=true;setBusy(true)
  const {data,error}=await supabase.from('service_packages').insert({business_id:businessId,name:name.trim(),items}).select('id,name,items').single()
  if(error||!data)throw Error(error?.code==='23505'?'That package name is already saved. Reopen packages to reload it, or choose another name.':'The save could not be confirmed. Reopen packages before trying again.')
  setPackages(previous=>[...previous,data].sort((a,b)=>a.name.localeCompare(b.name)));setSelected(data.id);setName('');setNotice('Package saved. It includes these quantities, prices and tax rates.')
 }catch(e){setError((e as Error).message)}finally{saving.current=false;setBusy(false)}}
 async function archive(){if(saving.current||loading||!selected)return;saving.current=true;setBusy(true);setError('');setNotice('');try{
  const {data,error}=await supabase.from('service_packages').update({active:false}).eq('business_id',businessId).eq('id',selected).select('id').single()
  if(error||!data)throw Error('The package could not be removed. Reopen packages and try again.')
  setPackages(previous=>previous.filter(p=>p.id!==selected));setSelected('');setNotice('Package removed. Existing documents keep their lines.')
 }catch(e){setError((e as Error).message)}finally{saving.current=false;setBusy(false)}}
 function add(){setError('');setNotice('');try{const value=packages.find(p=>p.id===selected);if(!value)throw Error('Choose a package.');onChange(addPackage(lines,value.items));setNotice('Package added. Review quantities, prices and tax before saving this document.')}catch(e){setError((e as Error).message)}}
 return <details className="saved-service-items" onToggle={event=>setOpened(event.currentTarget.open)}><summary>Service packages</summary>{loading&&<p role="status">Loading packages…</p>}<p className="quiet">Reuse a group of service lines. Adding a package copies its saved quantities, prices and tax rates into this draft.</p><label>Find a package<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Choose a package<select value={selected} disabled={busy||loading} onChange={e=>setSelected(e.target.value)}><option value="">{packages.length?'Select a package':'No saved packages yet'}</option>{packages.filter(p=>p.id===selected||p.name.toLowerCase().includes(search.trim().toLowerCase())).map(p=><option key={p.id} value={p.id}>{p.name} · {p.items.length} lines</option>)}</select></label><div className="guided-actions"><button type="button" className="text-button" disabled={busy||loading||!selected} onClick={add}>Add package to draft</button><button type="button" className="text-button" disabled={busy||loading||!selected} onClick={()=>void archive()}>Remove saved package</button></div><label>New package name<input maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="For example, seasonal service"/></label><button type="button" className="text-button" disabled={busy||loading||!name.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save these lines as a package'}</button>{error&&<p role="alert" className="error-text">{error}</p>}{notice&&<p role="status">{notice}</p>}</details>
}
