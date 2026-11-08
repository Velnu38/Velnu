import {useEffect,useRef,useState} from 'react'
import FormDialog from './FormDialog'
import DocumentDelivery,{type DocumentDeliveryProps} from './DocumentDelivery'
import DocumentPdfPreview from './DocumentPdfPreview'
import {canShareDocumentPdf,shareDocumentPdf,type DocumentPdfArtifact} from '../services/documentPdf'
import {readPendingPersonalSend} from '../services/personalDelivery'
import {getReviewedSendOperationId,type DeliveryDocumentKind} from '../services/reviewDelivery'
import {supabase} from '../lib/supabase'
import './record-detail.css'

const stateEvent='finviant:delivery-state'
const notifyDeliveryState=()=>window.dispatchEvent(new Event(stateEvent))
export type PreparedDocumentCopy={url:string;revisionId:string}
export type DocumentDeliveryDialogProps=DocumentDeliveryProps&{
 open:boolean;onClose:()=>void;title?:string;readOnly?:boolean;customerLink?:string
 prepareCopy?:(revisionId?:string)=>Promise<PreparedDocumentCopy>
}

function checkedCustomerLink(value:string){
 const url=new URL(value,window.location.origin)
 if(url.origin!==window.location.origin||url.pathname!=='/'||!['document_share','approval'].some(key=>/^[a-f0-9]{64}$/.test(url.searchParams.get(key)||'')))throw new Error('The customer link could not be verified.')
 return url.toString()
}

/** Copying a closed document never releases approval or records a new send. */
function DocumentCopyDelivery({businessId,kind,documentId,refreshKey,customerLink,prepareCopy,onBusyChange}:{businessId:string;kind:DeliveryDocumentKind;documentId:string;refreshKey?:string;customerLink?:string;prepareCopy?:(revisionId?:string)=>Promise<PreparedDocumentCopy>;onBusyChange:(busy:boolean)=>void}){
 const [pdf,setPdf]=useState<DocumentPdfArtifact|null>(null),[url,setUrl]=useState(customerLink||''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('')
 const flight=useRef(false)
 async function copy(){
  if(flight.current||!pdf)return
  flight.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('')
  try{
   let link=url
   if(!link){
    if(!prepareCopy)throw new Error('No previously issued customer link is available. You can download or share the saved PDF.')
    const prepared=await prepareCopy(pdf.revisionId??undefined)
    if(prepared.revisionId!==pdf.revisionId)throw new Error('This document changed after review. Reload its PDF before sharing.')
    link=prepared.url
   }
   link=checkedCustomerLink(link);setUrl(link)
   try{await navigator.clipboard.writeText(link);setNotice('Customer link copied.')}
   catch{setNotice('Copy the customer link below.')}
  }catch(failure){setError(failure instanceof Error?failure.message:'The customer link could not be copied.')}
  finally{flight.current=false;setBusy(false);onBusyChange(false)}
 }
 async function share(){
  if(flight.current||!pdf)return
  flight.current=true;setBusy(true);onBusyChange(true);setError('');setNotice('')
  try{
   const result=await shareDocumentPdf(pdf,kind==='estimate'?'Estimate copy':kind==='invoice'?'Invoice copy':'Change order copy',url?checkedCustomerLink(url):'Please review the attached document.')
   setNotice(result==='cancelled'?'Sharing cancelled.':result==='unsupported'?'Download the PDF and attach it in your app.':'PDF shared. The document status is unchanged.')
  }catch(failure){setError(failure instanceof Error?failure.message:'The PDF could not be shared.')}
  finally{flight.current=false;setBusy(false);onBusyChange(false)}
 }
 return <section aria-label="Share document copy" data-saving={busy?'true':undefined}>
  <p className="quiet">Share a copy of the saved document. Its approval and billing status stay unchanged.</p>
  <DocumentPdfPreview source={{businessId,kind,documentId}} title="Saved document PDF" compact onReady={setPdf} refreshKey={refreshKey}/>
  <div className="document-copy-actions">{(url||prepareCopy)&&<button type="button" className="secondary-button" disabled={busy||!pdf} onClick={()=>void copy()}>Copy Link</button>}{pdf&&canShareDocumentPdf(pdf)&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void share()}>Share PDF</button>}</div>
  {url&&<label className="document-copy-link">Customer link<input readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>
}

/** The existing delivery workflow is mounted once inside one focused dialog. */
export default function DocumentDeliveryDialog({open,onClose,title,readOnly=false,customerLink,prepareCopy,...delivery}:DocumentDeliveryDialogProps){
 const [busy,setBusy]=useState(false)
 const label=title||(readOnly?'Share document copy':'Send to customer')
 function changeBusy(value:boolean){setBusy(value);delivery.onBusyChange?.(value)}
 function close(){if(!busy){notifyDeliveryState();onClose()}}
 if(!open)return null
 return <FormDialog label={label} onClose={close} busy={busy} wide autoFocusFields={false} disableFields={false}>
  <div className="document-delivery-dialog"><div className="modal-head"><h2>{label}</h2><button type="button" className="icon-button" aria-label="Close delivery" disabled={busy} onClick={close}>×</button></div>
   {readOnly?<DocumentCopyDelivery businessId={delivery.businessId} kind={delivery.kind} documentId={delivery.documentId} refreshKey={delivery.refreshKey} customerLink={customerLink} prepareCopy={prepareCopy} onBusyChange={changeBusy}/>:<DocumentDelivery {...delivery} compact onBusyChange={changeBusy} onSent={async()=>{try{await delivery.onSent()}finally{notifyDeliveryState()}}}/>}
  </div>
 </FormDialog>
}

export function DocumentDeliveryTrigger({label='Send to customer',className='primary-button',title,readOnly,customerLink,prepareCopy,...delivery}:Omit<DocumentDeliveryDialogProps,'open'|'onClose'>&{label?:string;className?:string}){
 const [open,setOpen]=useState(false)
 return <><button type="button" className={className} disabled={delivery.disabled} onClick={()=>setOpen(true)}>{label}</button><DocumentDeliveryDialog {...delivery} title={title} readOnly={readOnly} customerLink={customerLink} prepareCopy={prepareCopy} open={open} onClose={()=>setOpen(false)}/></>
}

/** Recovery remains visible even when the delivery dialog and More are closed. */
export function DocumentDeliveryRecovery({businessId,kind,documentId,onOpen,onRecoveryChange,refreshKey='',resolved=false}:{businessId:string;kind:DeliveryDocumentKind;documentId:string;onOpen:()=>void;onRecoveryChange?:(attention:boolean)=>void;refreshKey?:string;resolved?:boolean}){
 const [message,setMessage]=useState(''),[attempt,setAttempt]=useState(0)
 const callback=useRef(onRecoveryChange);callback.current=onRecoveryChange
 useEffect(()=>{
  const refresh=()=>setAttempt(value=>value+1)
  window.addEventListener(stateEvent,refresh);window.addEventListener('focus',refresh)
  return()=>{window.removeEventListener(stateEvent,refresh);window.removeEventListener('focus',refresh)}
 },[])
 useEffect(()=>{
  let active=true
  setMessage('');callback.current?.(false)
  async function check(){
   const pending=await readPendingPersonalSend(businessId,kind,documentId)
   let next=pending?`An earlier ${pending.channel==='email'?'email':'text'} app draft is waiting for confirmation.`:''
   const operation=getReviewedSendOperationId(businessId,kind,documentId)
   if(!next&&operation&&!resolved){
    try{
     const result=await supabase.from('messages').select('status').eq('business_id',businessId).eq(kind==='invoice'?'invoice_id':kind==='estimate'?'estimate_id':'change_order_id',documentId).eq('id',operation).maybeSingle()
     if(result.error||!result.data||!['accepted','sent','delivered'].includes(result.data.status))next='An earlier email operation is saved. Review its result before starting another send.'
    }catch{next='An earlier email operation is saved. Review its result before starting another send.'}
   }
   if(active){setMessage(next);callback.current?.(!!next)}
  }
  void check()
  return()=>{active=false}
 },[businessId,kind,documentId,refreshKey,attempt,resolved])
 return message?<aside className="record-delivery-recovery" aria-label="Delivery needs review"><p role="status">{message}</p><button type="button" className="secondary-button" onClick={onOpen}>Review delivery</button></aside>:null
}
