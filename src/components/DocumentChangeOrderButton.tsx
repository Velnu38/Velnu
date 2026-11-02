import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { canManageFinances } from '../lib/business'
import { getDocumentChangeContext } from '../services/changeOrders'
export default function DocumentChangeOrderButton({business,kind,id,onClick}:{business:CurrentBusiness;kind:'invoice'|'estimate';id:string;onClick:()=>void}) {
  const [allowed,setAllowed]=useState<boolean|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0)
  useEffect(()=>{let active=true;setAllowed(null);setError('');void getDocumentChangeContext(kind,id).then(source=>{if(active)setAllowed(source.can_change)}).catch(()=>{if(active)setError('Unable to check work status.')});return()=>{active=false}},[business.id,kind,id,version])
  if(!canManageFinances(business.role)||allowed===false)return null
  if(error)return <button type="button" className="text-button" title={error} onClick={()=>setVersion(v=>v+1)}>Retry change order access</button>
  return <button type="button" className="secondary-button" disabled={allowed!==true} onClick={onClick}>{allowed===null?'Checking change order…':'Change order'}</button>
}
