import {useEffect,useRef,useState} from 'react'
import type {CurrentBusiness} from '../../lib/business'
import {isPrimaryOwner} from '../../lib/workspaceAccess'
import {readableError} from '../../lib/errors'
import {beginOwnerArchive,getOwnerArchive,prepareOwnerArchive,downloadOwnerArchive,type OwnerArchive as Archive,type ArchivePart} from '../../services/ownerArchive'
export default function OwnerArchive({business}:{business:CurrentBusiness}){
 const [archive,setArchive]=useState<Archive|null>(null),[page,setPage]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[downloaded,setDownloaded]=useState<number[]>([])
 const mounted=useRef(false),flight=useRef(false),generation=useRef(0),request=useRef<string|null>(null),controller=useRef<AbortController|null>(null),stop=useRef(false)
 const [preparing,setPreparing]=useState(false)
 const owner=isPrimaryOwner(business)
 function remember(id:string){try{setDownloaded(JSON.parse(sessionStorage.getItem('finviant-archive-downloads:'+id)||'[]'))}catch{setDownloaded([])}}
 async function load(id:string|null=null,n=page){const version=++generation.current;setLoading(true);try{const result=await getOwnerArchive(business.id,id,n);if(mounted.current&&version===generation.current){setArchive(result);if(result)remember(result.id)}}catch(e){if(mounted.current&&version===generation.current)setError(readableError(e,'Archive status unavailable.'))}finally{if(mounted.current&&version===generation.current)setLoading(false)}}
 useEffect(()=>{mounted.current=true;setArchive(null);setPage(0);setError('');request.current=null;if(owner)void load(null,0);return()=>{mounted.current=false;generation.current++;stop.current=true;controller.current?.abort()}},[business.id,owner])
 async function prepare(fresh=false){
  if(flight.current)return;flight.current=true;stop.current=false;controller.current=new AbortController();setBusy(true);setPreparing(true);setError('');setNotice('')
  try{
   let id=archive?.id
   if(fresh||!id){request.current??=crypto.randomUUID();id=await beginOwnerArchive(business.id,request.current);const initial=await getOwnerArchive(business.id,id,0);if(!mounted.current)return;setArchive(initial);request.current=null;setPage(0)}
   while(!stop.current&&mounted.current){
    const result=await prepareOwnerArchive(business.id,id,controller.current.signal)
    const current=await getOwnerArchive(business.id,id,fresh?0:page)
    if(!mounted.current)return
    setArchive(current)
    if(current?.status==='ready'||result.ready){setNotice('Archive ready. Download every part listed below and keep them together. Each part includes its integrity manifest.');break}
    if(result.busy){setNotice('Another request is preparing this archive. Refresh or resume in two minutes.');break}
   }
   if(stop.current&&mounted.current)setNotice('Preparation paused. Resume this same archive before it expires.')
  }catch(e){if(mounted.current&&!(e instanceof DOMException&&e.name==='AbortError'))setError(readableError(e,'Archive preparation was interrupted. Resume the same archive.'))}
  finally{flight.current=false;if(mounted.current){setBusy(false);setPreparing(false)}}
 }
 async function download(part:ArchivePart){if(flight.current||!archive)return;flight.current=true;setBusy(true);setError('');controller.current=new AbortController();try{await downloadOwnerArchive(business.id,archive.id,part,controller.current.signal);if(!mounted.current)return;setDownloaded(old=>{const next=[...new Set([...old,part.part_no])];try{sessionStorage.setItem('finviant-archive-downloads:'+archive.id,JSON.stringify(next))}catch{}return next});setNotice('Part '+part.part_no+' verified and handed to your browser. Confirm it appears in your Downloads folder.')}catch(e){if(mounted.current)setError(readableError(e,'Download interrupted. Try this same part again.'))}finally{flight.current=false;if(mounted.current)setBusy(false)}}
 if(!owner)return <p role="alert">Only the primary owner can export all business records.</p>
 return <section className="settings-section" aria-label="Business archive"><h2>Download your business records</h2>
  <p>Create an archive of customers, jobs, invoices, estimates, payments, expenses, schedules, settings and stored attachments. It includes records from all dates and is available on every plan.</p>
  <p className="quiet">Preparation runs while this page is open and can be resumed. Download every ZIP part; each has a manifest with counts and SHA-256 hashes. Archives expire seven days after they are requested. Your original records stay in Finviant.</p>
  {error&&<p role="alert" className="error-text">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {loading&&!archive?<p role="status">Loading archive status…</p>:null}
  {archive&&<div className="detail-card"><h3>Archive requested {new Date(archive.created_at).toLocaleString()}</h3><p>Status: <strong>{archive.status}</strong> · Expires {new Date(archive.expires_at).toLocaleString()}</p>
   {archive.status!=='expired'&&<><p>{archive.record_count.toLocaleString()} records · {archive.file_count.toLocaleString()} stored files · {archive.ready_count} of {archive.part_count} parts prepared</p>
    {archive.status==='building'&&<button type="button" className="primary-button" disabled={busy||loading} onClick={()=>void prepare()}>Resume preparation</button>}
    {archive.status==='ready'&&<><p>Download all {archive.part_count} parts. {downloaded.length} handed to your browser in this session.</p><ul>{archive.parts.map(part=><li key={part.part_no}>Part {part.part_no} · {part.kind==='records'?'Records':'Stored file'} · {(Number(part.byte_size)/1000000).toFixed(2)} MB <button type="button" className="secondary-button" disabled={busy} onClick={()=>void download(part)}>{downloaded.includes(part.part_no)?'Download again':'Download part '+part.part_no}</button></li>)}</ul>
     {archive.part_count>25&&<nav aria-label="Archive parts pages"><button type="button" disabled={busy||loading||page===0} onClick={()=>{const n=page-1;setPage(n);void load(archive.id,n)}}>Previous</button><span> Page {page+1} of {Math.ceil(archive.part_count/25)} </span><button type="button" disabled={busy||loading||(page+1)*25>=archive.part_count} onClick={()=>{const n=page+1;setPage(n);void load(archive.id,n)}}>Next</button></nav>}</>}
   </>}
  </div>}
  <div className="related-page-actions"><button type="button" className="secondary-button" disabled={busy||loading} onClick={()=>{setError('');void load(archive?.id||null)}}>Refresh archive</button>{(!archive||archive.status!=='building'||!!error)&&<button type="button" className="primary-button" disabled={busy||loading} onClick={()=>void prepare(true)}>Create new archive</button>}{preparing&&<button type="button" className="secondary-button" onClick={()=>{stop.current=true;setNotice('Preparation will pause after the current part is saved.')}}>Pause preparation</button>}</div>
  <p className="quiet">Up to two archive requests per day. Credentials and internal support notes are excluded. This download preserves records and files; automatic import into Finviant is separate.</p>
 </section>
}
