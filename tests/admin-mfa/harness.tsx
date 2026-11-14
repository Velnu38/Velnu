import React from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from '../../src/lib/supabase'
import PlatformAdminPage from '../../src/pages/PlatformAdminPage'
let verified=false
;(supabase as any).rpc=async()=>({data:verified?{operator:true,mfa_required:false,accounts:1,account_limit:10,pro_workspaces:1,open_cases:0}: {operator:true,mfa_required:true},error:null})
;(supabase.auth.mfa as any).listFactors=async()=>{const factors=(window as any).factorRemoved?[]:[{id:'existing-factor',status:'verified',friendly_name:'Finviant administration'}];return {data:{totp:factors,all:factors},error:null}}
;(supabase.auth.mfa as any).enroll=async()=>({data:{id:'test-factor',totp:{secret:'TESTONLYSETUPKEY',qr_code:'<svg/>'}},error:null})
;(supabase.auth.mfa as any).challengeAndVerify=async()=>{if(!(window as any).acceptMfa)return {error:new Error('Test invalid code')};verified=true;return {error:null}}
createRoot(document.getElementById('root')!).render(<PlatformAdminPage/> )
