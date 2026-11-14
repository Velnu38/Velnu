import {useEffect,useState} from 'react'
import CustomerPicker from './CustomerPicker'
import {searchJobCustomers} from '../services/customers'
import type {CustomerOption} from '../lib/customerSuggestions'

export default function JobCustomerPicker({businessId,value,onChange,disabled=false,seed}:{businessId:string;value:string;onChange:(id:string)=>void;disabled?:boolean;seed?:CustomerOption}) {
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[retry,setRetry]=useState(0)
 const [result,setResult]=useState<{key:string;business:string;data:Awaited<ReturnType<typeof searchJobCustomers>>}|null>(null)
 const [failure,setFailure]=useState<{key:string;message:string}|null>(null)
 const key=JSON.stringify([businessId,search,value,retry])
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),200);return()=>clearTimeout(timer)},[query])
 useEffect(()=>{let active=true;searchJobCustomers(businessId,search,value).then(data=>{if(active){setResult({key,business:businessId,data});setFailure(null)}}).catch(e=>{if(active)setFailure({key,message:(e as Error).message||'Customer suggestions could not load.'})});return()=>{active=false}},[key])
 const current=result?.key===key?result.data:null,error=failure?.key===key?failure.message:''
 const previous=result?.business===businessId?result.data:null
 const selected=current?current.selected:previous?.items.find(c=>c.id===value)||(previous?.selected?.id===value?previous.selected:null)||(seed?.id===value?seed:null)
 const customers=error?[]:[...(current?.items||[]),...(selected&&!current?.items.some(c=>c.id===selected.id)?[selected]:[])]
 return <CustomerPicker customers={customers} value={value} onChange={onChange} onQueryChange={setQuery} required disabled={disabled} loading={!current&&!error||query.trim()!==search} error={error} onRetry={()=>setRetry(v=>v+1)}/>
}
