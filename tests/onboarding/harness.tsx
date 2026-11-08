import React from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from '../../src/lib/supabase'
import BusinessOnboarding from '../../src/components/BusinessOnboarding'
import '../../src/styles.css'
import '../../src/components/onboarding.css'
const root=createRoot(document.getElementById('root')!)
let record:any,channels:any=null
;(window as any).insertCount=0;(window as any).opened=false
;(supabase.auth as any).getUser=async()=>({data:{user:{id:'owner',email:'owner@example.test'}}})
;(supabase as any).from=()=>{const chain:any={insert:(p:any)=>{record=p;(window as any).insertCount++;return chain},update:(p:any)=>{record={...record,...p};return chain},select:()=>chain,eq:()=>chain,single:async()=>({data:record,error:null})};return chain}
;(supabase as any).rpc=async(name:string,p:any)=>{if(name==='business_onboarding_status'){if(p.p_channels)channels=p.p_channels;if(p.p_complete&&(window as any).failComplete)return {error:{message:'Test save failure'}};return {data:{required:true,channels,completed:!!p.p_complete}}};return {data:{plan:'pro',acknowledged:false,managed_email_ready:false,managed_sms_ready:false,personal_email_ready:false,personal_sms_ready:false}}}
const onCreated=()=>{(window as any).opened=true}
;(window as any).resume=()=>root.render(<BusinessOnboarding key="resume" business={{...record,primary_owner:true,role:'owner'}} onCreated={onCreated}/>)
root.render(<BusinessOnboarding onCreated={onCreated}/>)
