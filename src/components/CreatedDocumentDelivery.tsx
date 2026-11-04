import {useEffect,useState} from 'react'
import {canManageFinances,type CurrentBusiness} from '../lib/business'
import {getDocumentDeliveryContext,type DeliveryDocumentKind,type DocumentDeliveryContext} from '../services/reviewDelivery'
import DocumentDelivery from './DocumentDelivery'
import CustomerEditDialog from './CustomerEditDialog'

/** Keeps delivery in Fin after the creation result, without navigating elsewhere. */
export default function CreatedDocumentDelivery({business,kind,documentId,onChanged,onBusyChange}:{business:CurrentBusiness;kind:DeliveryDocumentKind;documentId:string;onChanged:()=>void;onBusyChange:(busy:boolean)=>void}){
 const [context,setContext]=useState<DocumentDeliveryContext|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[editing,setEditing]=useState(false)
 useEffect(()=>{let active=true;setError('');void getDocumentDeliveryContext(business.id,kind,documentId).then(data=>{if(active)setContext(data)}).catch(()=>{if(active)setError('Your draft is saved, but its delivery details could not load.')});return()=>{active=false}},[business.id,kind,documentId,revision])
 if(!canManageFinances(business.role))return null
 if(error)return <div><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={()=>setRevision(n=>n+1)}>Reload delivery options</button></div>
 if(!context)return <p role="status">Loading saved document delivery options…</p>
 if(kind==='invoice'?context.status==='void':!['draft','sent'].includes(context.status))return null
 return <><DocumentDelivery key={documentId} businessId={business.id} kind={kind} documentId={documentId} email={context.customer?.email} phone={context.customer?.phone} onEditContact={()=>setEditing(true)} onBusyChange={onBusyChange} onSent={()=>{setRevision(n=>n+1);onChanged()}}/>{editing&&<CustomerEditDialog businessId={business.id} customerId={context.customer_id} onClose={()=>setEditing(false)} onSaved={()=>{setRevision(n=>n+1);onChanged()}}/>}</>
}
