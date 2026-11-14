import {useEffect,useRef,useState} from 'react'
import FormDialog from './FormDialog'
import {noticeStatus,reviewJourneyNotice,queueJourneyNotice,type NoticeReview} from '../services/journeyNotices'
export default function JourneyNoticeReview({businessId,eventId,onClose,onSaved}:{businessId:string;eventId:string;onClose:()=>void;onSaved:()=>void}){
 const[review,setReview]=useState<NoticeReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const generation=useRef(0),flight=useRef(false)
 useEffect(()=>{const token=++generation.current;setReview(null);setError('');setNotice('');setBusy(false);flight.current=false;void reviewJourneyNotice(businessId,eventId).then(data=>{if(token===generation.current)setReview(data)}).catch(()=>{if(token===generation.current)setError('This notice could not be prepared. Check customer contact, appointment and Finviant email setup.')});return()=>{generation.current++}},[businessId,eventId])
 async function queue(){if(!review||!review.eligible||flight.current)return;const token=generation.current;flight.current=true;setBusy(true);setError('');try{const result=await queueJourneyNotice(businessId,review);if(token===generation.current){setReview({...review,status:result.status});setNotice(noticeStatus(result.status)+'. Check job activity for delivery updates.');onSaved()}}catch{if(token===generation.current)setError('The notice could not be confirmed. Close and reopen it to check its delivery status before trying again.')}finally{if(token===generation.current){flight.current=false;setBusy(false)}}}
 const waiting=!!review&&['pending','blocked'].includes(review.status)
 return <FormDialog label="Review customer notice" busy={busy} onClose={onClose}><div className="modal-head"><h2>Review customer notice</h2><button type="button" className="icon-button" disabled={busy} aria-label="Close customer notice" onClick={onClose}>×</button></div>
 {!review&&!error&&<p role="status">Preparing customer notice…</p>}{error&&<p role="alert">{error}</p>}
 {review&&<><p>Status: {waiting&&review.eligible?'Ready to send':noticeStatus(review.status)}. Provider acceptance is separate from confirmed delivery.</p>{review.eligible&&review.snapshot?<><p><strong>To:</strong> {review.snapshot.payload.to[0]}</p><p><strong>{review.snapshot.payload.subject}</strong></p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{review.snapshot.payload.text}</p></>:<p>This notice needs attention. Verify the current appointment, customer email and activated sender before sending.</p>}</>}
 {notice&&<p role="status">{notice}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Close</button>{waiting&&review?.eligible&&<button type="button" className="primary-button" disabled={busy} onClick={()=>void queue()}>{busy?'Saving…':'Send Finviant Email'}</button>}</div>
 </FormDialog>
}
