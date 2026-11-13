import FinBrand from './FinBrand'
import AskFinButton from './AskFinButton'
import {useEffect,useRef,type ReactNode} from 'react'
import {useUnsavedChanges} from '../lib/unsavedChanges'
/** Shared native dialog: focus containment, Escape, and safe explicit dismissal. */
export default function FormDialog({label,busy=false,onClose,wide=false,children,disableFields=true,cleanVersion,autoFocusFields=true,navigationScope}:{label:string;busy?:boolean;onClose:()=>void;wide?:boolean;children:ReactNode;disableFields?:boolean;cleanVersion?:unknown;autoFocusFields?:boolean;navigationScope?:string}) {
 const ref=useRef<HTMLDialogElement>(null)
 const guard=useUnsavedChanges(busy,navigationScope)
 const canClose=()=>!ref.current?.querySelector('[data-saving="true"]')&&guard.canClose(!!ref.current?.querySelector('[data-unsaved="true"]'))
 useEffect(()=>{guard.markClean()},[cleanVersion])
 useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();if(autoFocusFields)ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}},[])
 return <dialog ref={ref} className={`modal form-dialog${wide?' wide':''}`} aria-label={label} aria-busy={busy} onInputCapture={e=>{if((e.target as Element).closest('dialog')===ref.current&&!(e.target as Element).closest('[data-editor-independent]'))guard.markDirty()}} onChangeCapture={e=>{if((e.target as Element).closest('dialog')===ref.current&&!(e.target as Element).closest('[data-editor-independent]'))guard.markDirty()}} onClickCapture={e=>{const button=(e.target as Element).closest('button');if((e.target as Element).closest('dialog')===ref.current&&button&&!button.hasAttribute('data-keep-dialog')&&/^(cancel$|close\b|back\b|×$)/i.test(button.getAttribute('aria-label')||button.textContent||'')){if(!canClose()){e.preventDefault();e.stopPropagation()}}}} onCancel={e=>{e.preventDefault();e.stopPropagation();if(canClose())onClose()}}><fieldset className="form-dialog-fields" disabled={busy&&disableFields}>{!label.startsWith('Fin —')&&!/^(More(?: navigation)?|Navigation|Choose workspace|Switch workspace)$/i.test(label)&&<div className="form-dialog-topbar"><div className="form-dialog-brand"><FinBrand wordmark/></div><AskFinButton task={label} disabled={busy}/></div>}{children}</fieldset></dialog>
}
