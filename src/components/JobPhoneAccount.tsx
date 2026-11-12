import {useEffect,useState,type ReactNode} from 'react'
import {JOB_PHONE_QUERY} from './JobMobileMenu'
/** One disclosure retains all beta and account information across phone workspaces. */
export default function JobPhoneAccount({active,children}:{active:boolean;children:ReactNode}){
 const [phone,setPhone]=useState(()=>window.matchMedia(JOB_PHONE_QUERY).matches)
 useEffect(()=>{const media=window.matchMedia(JOB_PHONE_QUERY);const update=()=>setPhone(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
 return active&&phone?<details className="jm-account-banner"><summary>Private beta <span>Account details</span></summary><div>{children}</div></details>:<>{children}</>
}
