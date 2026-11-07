import React from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from '../../src/lib/supabase'
import StorageUsage from '../../src/components/StorageUsage'
import RecordResources from '../../src/components/RecordResources'
const id='11111111-1111-4111-8111-111111111111'
let used=80_000_000
;(window as any).setUsage=(value:number)=>{used=value}
;(supabase as any).rpc=async()=>({data:{plan:'free',used_bytes:used,limit_bytes:100_000_000,remaining_bytes:Math.max(0,100_000_000-used),pending_bytes:0,warning:used>=100_000_000?'full':used>=95_000_000?'critical':used>=80_000_000?'warning':'none'},error:null})
;(supabase as any).from=()=>{const chain:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>resolve({data:[],error:null,count:0}):()=>chain});return chain}
createRoot(document.getElementById('root')!).render(<><StorageUsage businessId={id} detailed/><RecordResources business={{id,name:'Test',role:'owner',primary_owner:true,timezone:'America/New_York'} as any} target={{kind:'job',id}}/></>)
