import {taskHelpText,useAssistantAvailable} from '../lib/assistantEntry'
import './ask-fin.css'
export default function AskFinButton({task,disabled=false}:{task:string;disabled?:boolean}){
 const available=useAssistantAvailable()
 return <div className="task-fin-help" data-editor-independent><button type="button" className="secondary-button compact" data-keep-dialog disabled={disabled||!available} title={!available?'Fin is busy or unavailable for this account. You can complete the form manually.':`Get help with ${task}`} onClick={event=>{
  const dialog=event.currentTarget.closest('dialog')
  const fields=Array.from(dialog?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')||[]).filter(el=>el.closest('dialog')===dialog&&!el.closest('[data-editor-independent]')&&!(el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)&&!el.checked)).map(el=>({label:el.getAttribute('aria-label')||el.labels?.[0]?.textContent?.trim()||el.name||'Field',type:el.type,value:el instanceof HTMLSelectElement?Array.from(el.selectedOptions).map(o=>o.text).join(', '):el.value}))
  window.dispatchEvent(new CustomEvent('finviant-assistant-entry',{detail:{text:taskHelpText(task,fields)}}))
 }}>Ask Fin</button><small>{available?'Get help with this task. Your entries stay here.':'Fin is busy or unavailable. You can continue manually.'}</small></div>
}
