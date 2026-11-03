import {useEffect,useRef,useState} from 'react'
import {supportRequest,type CaseRow,type CaseDetail} from '../services/platformAdmin'
import FormDialog from './FormDialog'
export default function SupportCases({businessId}:{businessId:string}){
 const [rows,setRows]=useState<CaseRow[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[detail,setDetail]=useState<CaseDetail|null>(null),[creating,setCreating]=useState(false)
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[priority,setPriority]=useState('normal'),[reply,setReply]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const running=useRef(false),request=useRef<string|null>(null),sequence=useRef(0)
 async function load(){const seq=++sequence.current;try{const r=await supportRequest<{rows:CaseRow[];total:number}>(businessId,'list',{page});if(seq===sequence.current){setRows(r.rows);setTotal(r.total)}}catch(e){if(seq===sequence.current)setError((e as Error).message)}}
 useEffect(()=>{void load();return()=>{sequence.current++}},[businessId,page])
 async function open(id:string){try{setError('');setDetail(await supportRequest<CaseDetail>(businessId,'detail',{id}));setReply('');request.current=null}catch(e){setError((e as Error).message)}}
 async function save(){if(running.current)return;running.current=true;setBusy(true);setError('');try{
  const id=request.current||crypto.randomUUID();request.current=id
  const r=await supportRequest<CaseDetail>(businessId,creating?'create':'reply',creating?{request_id:id,title,description,priority}:{id:detail!.case.id,request_id:id,body:reply})
  setCreating(false);setDetail(r);setTitle('');setDescription('');setReply('');request.current=null;setNotice('Saved to your support case. Replies appear here; no email was sent.');await load()
 }catch(e){setError((e as Error).message)}finally{running.current=false;setBusy(false)}}
 function changed(){request.current=null}
 return <section className="settings-panel support-cases"><h2>Help & support</h2><p>Report a problem to Finviant and follow replies here. Include the steps you took and what you expected. Do not include passwords, API keys, card details or customer documents.</p>
 <div className="settings-actions"><button className="primary-button" onClick={()=>{setCreating(true);setDetail(null);setTitle('');setDescription('');request.current=null;setError('')}}>Report an issue</button><button className="secondary-button" onClick={()=>void load()}>Refresh cases</button></div>
 {error&&!detail&&!creating&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {rows.length===0?<p>No support cases yet.</p>:<ul className="admin-case-list">{rows.map(r=><li key={r.id}><button className="secondary-button" onClick={()=>void open(r.id)}>{r.title} · {r.status.replaceAll('_',' ')}</button><small>{new Date(r.updated_at).toLocaleString()}</small></li>)}</ul>}
 <div className="settings-actions"><button className="secondary-button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous cases</button><span>{total} cases · Page {page+1}</span><button className="secondary-button" disabled={(page+1)*25>=total} onClick={()=>setPage(p=>p+1)}>Next cases</button></div>
 {(creating||detail)&&<FormDialog label={creating?'Report an issue':'Your support case'} busy={busy} cleanVersion={detail?.case.version} onClose={()=>{setCreating(false);setDetail(null)}}><div className="admin-case-detail">
 <h2>{creating?'Report an issue':detail!.case.title}</h2>{error&&<p role="alert">{error}</p>}
 <form onSubmit={e=>{e.preventDefault();void save()}}>
 {creating?<><label>Issue title<input required minLength={3} maxLength={160} value={title} onChange={e=>{setTitle(e.target.value);changed()}}/></label><label>What happened?<textarea required minLength={5} maxLength={6000} value={description} onChange={e=>{setDescription(e.target.value);changed()}}/></label><label>Impact<select value={priority} onChange={e=>{setPriority(e.target.value);changed()}}><option value="low">Low — question or minor issue</option><option value="normal">Normal — work is slowed</option><option value="high">High — unable to complete work</option></select></label></>:<><p>Status: {detail!.case.status.replaceAll('_',' ')}</p><p className="admin-message">{detail!.case.description}</p>{detail!.messages.map(m=><article className="admin-message" key={m.id}><strong>{m.sender||'Message'}</strong><small>{new Date(m.created_at).toLocaleString()}</small><p>{m.body}</p></article>)}<label>Add a reply<textarea required minLength={1} maxLength={4000} value={reply} onChange={e=>{setReply(e.target.value);changed()}}/></label><p className="quiet">Replying to a resolved or closed case reopens it.</p></>}
 <div className="settings-actions"><button className="primary-button" disabled={busy}>{busy?'Saving…':creating?'Submit issue':'Send reply'}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setCreating(false);setDetail(null)}}>Close</button></div></form></div></FormDialog>}
 </section>
}
