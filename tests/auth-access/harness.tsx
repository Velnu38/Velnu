import React from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from '../../src/lib/supabase'
import AuthScreen from '../../src/components/AuthScreen'
import PasswordRecovery from '../../src/components/PasswordRecovery'
const root=createRoot(document.getElementById('root')!)
;(window as any).requests=[]
;(supabase.auth as any).signInWithPassword=async()=>({error:new Error('private stack trace')})
;(supabase.auth as any).resetPasswordForEmail=async(email:any,options:any)=>{(window as any).requests.push({type:'reset',email,options});return {error:null}}
;(supabase.auth as any).signUp=async(input:any)=>{(window as any).requests.push(input);return {data:{session:null},error:null}}
;(supabase.auth as any).updateUser=async()=>({error:null})
let signouts=0
;(supabase.auth as any).signOut=async(input:any)=>{if(input.scope!=='global')throw Error('Must revoke globally');return {error:signouts++===0?new Error('offline'):null}}
;(window as any).mountRecovery=(session:boolean,invalid:boolean)=>root.render(<PasswordRecovery key={String(session)} session={session?{user:{email:'test@example.test'}} as any:null} invalidLink={invalid} onDone={()=>{}}/> )
root.render(<AuthScreen/> )
