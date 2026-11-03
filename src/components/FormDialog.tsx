import {useEffect,useRef,type ReactNode} from 'react'
/** Shared native dialog: focus containment, Escape, and safe explicit dismissal. */
export default function FormDialog({label,busy=false,onClose,wide=false,children}:{label:string;busy?:boolean;onClose:()=>void;wide?:boolean;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}},[])
 return <dialog ref={ref} className={`modal form-dialog${wide?' wide':''}`} aria-label={label} aria-busy={busy} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><fieldset className="form-dialog-fields" disabled={busy}>{children}</fieldset></dialog>
}
