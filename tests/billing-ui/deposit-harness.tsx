import React from 'react'
import {createRoot} from 'react-dom/client'
import EstimateBilling from '../../src/components/EstimateBilling'
import {supabase} from '../../src/lib/supabase'
const id='11111111-1111-4111-8111-111111111111'
;(supabase as any).from=()=>{const chain:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>resolve({data:[],error:null}):()=>chain});return chain}
const root=document.createElement('div');document.body.appendChild(root)
createRoot(root).render(<EstimateBilling businessId={id} estimateId={id} total={105} approved canManage timezone="America/New_York"/>)
