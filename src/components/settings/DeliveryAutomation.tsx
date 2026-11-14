import {useEffect,useRef,useState} from 'react'
import {supabase} from '../../lib/supabase'
type State={plan:string;ready:boolean;rule:{enabled:boolean;after_days:number;repeat_days:number;max_reminders:number};tasks:{id:string;kind:string;document_id:string;due_at:string;reminder:boolean;status:string;last_error:string|null}[]}
export default function DeliveryAutomation({businessId}:{businessId:string}){
 const[state,setState]=useState<State|null>(null),[enabled,setEnabled]=useState(false),[after,setAfter]=useState(2),[repeat,setRepeat]=useState(7),[max,setMax]=useState(3),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const generation=useRef(0),flight=useRef(false)
 function apply(data:State){setState(data);setEnabled(data.rule.enabled);setAfter(data.rule.after_days);setRepeat(data.rule.repeat_days);setMax(data.rule.max_reminders)}
 useEffect(()=>{
  const token=++generation.current;flight.current=false;setBusy(false);setState(null);setError('');setNotice('')
  void Promise.resolve(supabase.rpc('get_delivery_automation',{p_business:businessId})).then(({data,error})=>{
   if(token!==generation.current)return
   if(error)throw error
   apply(data)
  }).catch(e=>{if(token===generation.current)setError((e as Error).message)})
  return()=>{generation.current++}
 },[businessId])
 async function save(e:React.FormEvent){
  e.preventDefault();if(flight.current||!state)return
  flight.current=true;const token=generation.current;setBusy(true);setError('');setNotice('')
  try{
   const{data,error}=await supabase.rpc('save_reminder_rule',{p_business:businessId,p_enabled:enabled,p_after:after,p_repeat:repeat,p_max:max})
   if(error)throw error
   if(token===generation.current){apply(data);setNotice(data.rule.enabled?'Automatic overdue invoice email rule saved. Eligibility and sender checks still apply.':'Automatic overdue invoice emails paused.')}
  }catch(e){if(token===generation.current)setError((e as Error).message)}
  finally{if(token===generation.current){flight.current=false;setBusy(false)}}
 }
 async function cancel(task:State['tasks'][number]){
  if(flight.current)return
  flight.current=true;const token=generation.current;setBusy(true);setError('');setNotice('')
  try{
   const{error}=await supabase.rpc('schedule_document_email',{p_business:businessId,p_kind:task.kind,p_document:task.document_id,p_request:task.id,p_due:task.due_at,p_cancel:true})
   if(error)throw error
   if(token!==generation.current)return
   const result=await supabase.rpc('get_delivery_automation',{p_business:businessId})
   if(result.error)throw result.error
   if(token===generation.current)apply(result.data)
  }catch(e){if(token===generation.current)setError((e as Error).message)}
  finally{if(token===generation.current){flight.current=false;setBusy(false)}}
 }
 if (!state && !error) return <p role="status">Loading customer reminder defaults…</p>
 return <section className="settings-panel"><h3>Overdue invoice email defaults</h3><p>Save this business-wide rule once. New rules start at 2 days overdue, repeat every 7 days, with a maximum of 3 reminders. Previously saved rules are preserved. Business Pro can email customers about overdue invoices. Nothing runs until the owner enables a rule and Finviant email is activated. Paid, void and draft invoices are excluded. Included email usage applies.</p><p className="quiet">These are customer messages, separate from <a href="/?view=reminders">internal follow-ups</a>. Invoices inherit this rule unless you choose Off or Custom in that invoice’s Automatic customer reminders section. Appointment defaults are configured separately below.</p>{state&&state.plan!=='pro'&&<p>Business Pro is required for automatic reminders.</p>}{error&&<p role="alert" className="error-text">{error}</p>}{state&&<p aria-label="Saved invoice reminder rule"><strong>Saved business rule: {state.rule.enabled?'Enabled':'Paused'}</strong> · Email only · {state.rule.after_days} days overdue, every {state.rule.repeat_days} days, maximum {state.rule.max_reminders}. Changes below apply only after saving.</p>}{state?.plan==='pro'&&<form onSubmit={e=>void save(e)}><label className="delivery-checks"><span><input type="checkbox" checked={enabled} disabled={busy||(!state.rule.enabled&&(!state.ready||state.plan!=='pro'))} onChange={e=>setEnabled(e.target.checked)}/>Enable overdue invoice email reminders</span></label><div className="profile-field-grid"><label>First reminder, days after due date<input type="number" min={1} max={30} value={after} disabled={busy} required onChange={e=>setAfter(Number(e.target.value))}/></label><label>Days between reminders<input type="number" min={3} max={30} value={repeat} disabled={busy} required onChange={e=>setRepeat(Number(e.target.value))}/></label><label>Maximum reminders per invoice<input type="number" min={1} max={5} value={max} disabled={busy} required onChange={e=>setMax(Number(e.target.value))}/></label></div><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save business-wide defaults'}</button>{(!state.ready||state.plan!=='pro')&&<p className="quiet">Activation is required before this rule can send. You can still review the proposed timing here.</p>}</form>}{state && state.plan!=='pro' && state.rule.enabled && <p className="quiet">Automatic overdue invoice emails are paused. Business Pro is required.</p>}{notice&&<p role="status">{notice}</p>}{!!state?.tasks.length&&<><h3>Scheduled sending activity</h3><ul>{state.tasks.map(t=><li key={t.id}>{t.reminder?'Invoice reminder':t.kind+' email'} · {new Date(t.due_at).toLocaleString()} · {t.status}{t.last_error&&<p>{t.last_error}</p>}{['scheduled','blocked'].includes(t.status)&&<button className="text-button" disabled={busy} onClick={()=>void cancel(t)}>Cancel this send</button>}</li>)}</ul></>}</section>
}
