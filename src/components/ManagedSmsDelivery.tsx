import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import {normalizeMobile} from '../lib/smsPhone'
import {preparePersonalDocument} from '../services/personalDelivery'
import type {DeliveryDocumentKind} from '../services/reviewDelivery'
export default function ManagedSmsDelivery({businessId,documentId,saveDocument,kind,phone,ready,disabled,onSent,onBusyChange}:{businessId:string;documentId?:string;saveDocument?:()=>Promise<string|undefined>;kind:DeliveryDocumentKind;phone?:string|null;ready:boolean;disabled:boolean;onSent:()=>void|Promise<unknown>;onBusyChange?:(busy:boolean)=>void}){
 const[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[accepted,setAccepted]=useState(false),operation=useRef<{id:string;token:string}|null>(null),flight=useRef(false)
 const number=normalizeMobile(phone||''),valid=!!number&&/^\+1\d{10}$/.test(number)
 async function send(){if(flight.current||disabled||!ready||!valid||!consent||accepted)return;flight.current=true;setBusy(true);onBusyChange?.(true);setError('');try{
  const id=documentId ?? await saveDocument?.();if(!id)return
  const permission=await supabase.rpc('record_sms_permission',{p_business:businessId,p_phone:number,p_consent:true});if(permission.error)throw permission.error
  if(!operation.current){const share=await preparePersonalDocument(businessId,kind,id);operation.current={id:crypto.randomUUID(),token:share.token}}
  const{data,error:failure}=await supabase.functions.invoke('send-document-sms',{body:{business_id:businessId,document_id:id,kind,request_id:operation.current.id,token:operation.current.token,recipient:number}})
  if(failure){const detail=failure.context instanceof Response?await failure.context.clone().json().catch(()=>null):null;throw Error(detail?.error||'Text delivery was not confirmed. Check activity before a new send.')}
  if(!['accepted','delivered'].includes(data?.status))throw Error('Text outcome is not confirmed.');setAccepted(true);setNotice(`Text ${data.status==='delivered'?'delivered':'accepted for delivery'} to ${number}. ${data.warning||''}`);await onSent()
 }catch(e){setError((e as Error).message)}finally{flight.current=false;setBusy(false);onBusyChange?.(false)}}
 return <section className="document-delivery-option" aria-label="Finviant text sending"><span>{valid?'To: '+number:'Add a valid US mobile number'}</span><button className="primary-button" disabled={disabled||busy||accepted||!ready||!valid||!consent} onClick={()=>void send()}>{busy?'Sending text…':'Send Text'}</button>{ready?<label className="quiet"><input type="checkbox" checked={consent} disabled={busy||accepted} onChange={e=>setConsent(e.target.checked)}/>The customer agreed to receive this business text at this number.</label>:<p className="quiet">Finviant text sending is pending sender activation. Use your own app or finish sending setup.</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error-text">{error}</p>}</section>
}
