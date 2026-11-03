import {useEffect,useRef,type ReactNode} from 'react'
import {useUnsavedChanges} from '../lib/unsavedChanges'
/** Shared native dialog: focus containment, Escape, and safe explicit dismissal. */
export default function FormDialog({label,busy=false,onClose,wide=false,children,disableFields=true,cleanVersion}:{label:string;busy?:boolean;onClose:()=>void;wide?:boolean;children:ReactNode;disableFields?:boolean;cleanVersion?:unknown}) {
 const ref=useRef<HTMLDialogElement>(null)
 const guard=useUnsavedChanges(busy)
 useEffect(()=>{guard.markClean()},[cleanVersion])
 useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}},[])
 return <dialog ref={ref} className={`modal form-dialog${wide?' wide':''}`} aria-label={label} aria-busy={busy} onInputCapture={e=>{if((e.target as Element).closest('dialog')===ref.current)guard.markDirty()}} onChangeCapture={e=>{if((e.target as Element).closest('dialog')===ref.current)guard.markDirty()}} onClickCapture={e=>{const button=(e.target as Element).closest('button');if((e.target as Element).closest('dialog')===ref.current&&button&&/^(cancel$|close\b|back\b|×$)/i.test(button.getAttribute('aria-label')||button.textContent||'')){if(!guard.canClose()){e.preventDefault();e.stopPropagation()}}}} onCancel={e=>{e.preventDefault();e.stopPropagation();if(guard.canClose())onClose()}}><fieldset className="form-dialog-fields" disabled={busy&&disableFields}>{children}</fieldset></dialog>
}
