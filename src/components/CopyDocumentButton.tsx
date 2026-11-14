import {useRef,useState} from 'react'
import {copyDocumentToDraft} from '../services/operations'
export default function CopyDocumentButton({businessId,kind,id,disabled=false}:{businessId:string;kind:'invoice'|'estimate';id:string;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),request=useRef(crypto.randomUUID())
 async function copy(){if(busy)return;setBusy(true);setError('');try{const draft=await copyDocumentToDraft(businessId,kind,id,request.current);location.assign('/?view='+(kind==='invoice'?'invoices':'estimates')+'&document='+draft.id+'&edit=1')}catch(e){setError((e as Error).message);setBusy(false)}}
 return <><button type="button" disabled={disabled||busy} data-keep-menu onClick={()=>void copy()}>{busy?'Preparing draft…':'Copy to new draft'}</button>{error&&<p role="alert">{error}</p>}</>
}
