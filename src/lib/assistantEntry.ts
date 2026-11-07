import {useSyncExternalStore} from 'react'
let available=false
let working=false
const listeners=new Set<()=>void>()
export function setAssistantAvailable(value:boolean){if(available===value)return;available=value;listeners.forEach(notify=>notify())}
export function setAssistantWorking(value:boolean){if(working===value)return;working=value;listeners.forEach(notify=>notify())}
export function useAssistantAvailable(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>{listeners.delete(callback)}},()=>available&&!working,()=>false)}
export function taskHelpText(task:string,fields:{label:string;value:string;type?:string}[]){
 const context=fields.filter(f=>f.value.trim()&&!['password','hidden','file'].includes(f.type||'')&&!/password|secret|token|api key|card number|security code/i.test(f.label)).map(f=>`${f.label.slice(0,100)}: ${f.value.slice(0,180)}`).join('\n').slice(0,1300)
 return `Help me complete the open “${task.slice(0,120)}” form. ${context?'Current unsaved entries:\n'+context:'I have not entered details yet.'}\nExplain the next steps and ask for missing information. This is a request for help with the open form, not permission to save, create, send, delete, or change any record. I will review and apply your suggestions in the form.`
}
