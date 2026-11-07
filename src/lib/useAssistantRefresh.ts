import {useEffect,useRef} from 'react'
/** Refresh confirmed assistant writes without remounting another editor's unsaved work. */
export function useAssistantRefresh(reload:()=>Promise<unknown>,onError:(error:unknown)=>void) {
 const current=useRef({reload,onError});current.current={reload,onError}
 useEffect(()=>{const saved=()=>{void current.current.reload().catch(e=>current.current.onError(e))};window.addEventListener('finviant-assistant-saved',saved);return()=>window.removeEventListener('finviant-assistant-saved',saved)},[])
}
