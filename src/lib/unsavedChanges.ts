import {useEffect,useRef} from 'react'

const editors=new Map<symbol,{dirty:boolean;busy:boolean}>()
export function hasUnsavedChanges(){return [...editors.values()].some(e=>e.dirty||e.busy)}
export function confirmNavigation() {
 if([...editors.values()].some(e=>e.busy)){window.alert('Please wait for the current save to finish.');return false}
 return ![...editors.values()].some(e=>e.dirty)||window.confirm('Discard unsaved changes? Choose Cancel to keep editing.')
}
export function useUnsavedChanges(busy=false) {
 const key=useRef(Symbol('editor')),dirty=useRef(false)
 const state=useRef({dirty:false,busy})
 state.current.busy=busy
 useEffect(()=>{editors.set(key.current,state.current);const unload=(e:BeforeUnloadEvent)=>{if(state.current.dirty||state.current.busy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',unload);return()=>{editors.delete(key.current);window.removeEventListener('beforeunload',unload)}},[])
 return {markDirty:()=>{dirty.current=true;state.current.dirty=true},markClean:()=>{dirty.current=false;state.current.dirty=false},canClose:(extraDirty=false)=>!busy&&(!(dirty.current||extraDirty)||window.confirm('Discard unsaved changes? Choose Cancel to keep editing.'))}
}
