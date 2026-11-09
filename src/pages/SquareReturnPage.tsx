import {useEffect,useState} from 'react'
import {squareRequest} from '../services/square'
import {announceCalendarChange} from '../lib/workEvents'
export default function SquareReturnPage(){
 const [state,setState]=useState('Verifying your Square payment…'),[invoice,setInvoice]=useState(''),[retry,setRetry]=useState(0),[error,setError]=useState('')
 useEffect(()=>{let active=true;async function verify(){try{
  const query=new URLSearchParams(location.search);let data:Record<string,string>={};try{data=JSON.parse(query.get('data')||'{}')}catch{throw Error('Square returned an unreadable response. Check its payment history before accepting another payment.')}
  const reference=(typeof data.state==='string'?data.state:'')||query.get('com.squareup.pos.REQUEST_METADATA')||'',parts=reference.split('.'),id=parts[0],nonce=parts[1]
  if(!/^[a-f0-9-]{36}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(nonce||''))throw Error('Payment return could not be matched. Open the invoice and check Square before retrying.')
  let saved:any=null;try{saved=JSON.parse(localStorage.getItem('finviant-square:'+id)||'null')}catch{}
  if(!saved||saved.state!==nonce)throw Error('Return to the browser where this payment was started, or check Square with the business before retrying.')
  if(active)setInvoice(saved.invoice_id)
  const transaction=data.transaction_id||query.get('com.squareup.pos.SERVER_TRANSACTION_ID')||''
  if(!transaction)throw Error('Square did not return a completed online transaction. Check Square before recording a payment or starting another one.')
  const result=await squareRequest({mode:'return',business_id:saved.business_id,operation_id:id,state:nonce,transaction_id:transaction})
  if(active){setState(result.state==='paid'?'Payment verified. Your Finviant invoice and financial records have been updated.':result.state==='review_required'?'The payment needs reconciliation. Check Square before accepting another payment.':'Square is still processing this payment. Check its status before accepting another payment.');setError('');announceCalendarChange()}
 }catch(e){if(active){setState('Payment has not been confirmed in Finviant.');setError((e as Error).message)}}}void verify();return()=>{active=false}},[retry])
 return <main className="share-document"><p className="eyebrow">Finviant Office</p><h1>Square payment status</h1><p role="status">{state}</p>{error&&<p role="alert">{error}</p>}<div className="guided-actions"><a className="primary-button" href={'/?view=invoices'+(invoice?'&document='+encodeURIComponent(invoice):'')}>Return to invoice</a>{error&&<button type="button" className="secondary-button" onClick={()=>setRetry(v=>v+1)}>Retry verification</button>}</div><p className="quiet">If your session expired, sign in through the invoice link, then return here to retry verification. Do not take a second payment until the original transaction is checked.</p></main>
}
