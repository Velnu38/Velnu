import {useEffect,useRef,useState,type FormEvent} from 'react'
import {supabase} from '../lib/supabase'
import {readableError} from '../lib/errors'

type Timing={after_days:number;repeat_days:number;max_reminders:number}
type Preference=Timing&{mode:'inherit'|'off'|'custom';master_enabled:boolean;defaults:Timing}
export default function InvoiceReminderPreference({businessId,invoiceId}:{businessId:string;invoiceId:string}){
 const [value,setValue]=useState<Preference|null>(null),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
 const [saved,setSaved]=useState<Preference|null>(null)
 const flight=useRef(false),generation=useRef(0)
 useEffect(()=>{
  const token=++generation.current;setValue(null);setSaved(null);setError('');setReceipt('')
  void Promise.resolve(supabase.rpc('get_invoice_reminder_preference',{p_business:businessId,p_invoice:invoiceId})).then(({data,error:failure})=>{if(token!==generation.current)return;if(failure)setError(readableError(failure,'Unable to load automatic reminders.'));else {setValue(data as Preference);setSaved(data as Preference)}}).catch(failure=>{if(token===generation.current)setError(readableError(failure,'Unable to load automatic reminders.'))})
  return()=>{generation.current++}
 },[businessId,invoiceId,reload])
 async function save(event:FormEvent){
  event.preventDefault();if(!value||flight.current)return
  const token=generation.current;flight.current=true;setBusy(true);setError('');setReceipt('')
  try{
   const {data,error:failure}=await supabase.rpc('save_invoice_reminder_preference',{p_business:businessId,p_invoice:invoiceId,p_mode:value.mode,p_after:value.after_days,p_repeat:value.repeat_days,p_max:value.max_reminders})
   if(failure)throw failure
   if(token===generation.current){setValue(data as Preference);setSaved(data as Preference);setReceipt('Invoice reminder preference saved. No message was sent now.')}
  }catch(failure){if(token===generation.current)setError(readableError(failure,'Unable to save invoice reminders.'))}
  finally{flight.current=false;setBusy(false)}
 }
 return <article className="detail-card"><h2>Automatic customer reminders</h2>
 <p className="quiet">Email reminders for this invoice. Manual reminders and your internal follow-ups are separate.</p>
 {error&&<p role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}
 {saved&&<p aria-label="Saved invoice reminder preference"><strong>Saved preference: {saved.mode==='inherit'?'Use business defaults':saved.mode==='off'?'Off':'Custom'}</strong>. Business rule: {saved.master_enabled?'Enabled':'Paused'}. {saved.mode==='off'?'No automatic reminder for this invoice.':`Saved email timing: ${saved.after_days} days overdue, every ${saved.repeat_days} days, maximum ${saved.max_reminders}.`} Changes below apply only after saving.</p>}
 {!value?error?<button type="button" className="secondary-button" onClick={()=>setReload(n=>n+1)}>Retry reminder settings</button>:<p role="status">Loading reminder settings…</p>:<form className="form-grid" onSubmit={save}>
 <label>Reminder preference<select disabled={busy} value={value.mode} onChange={event=>setValue({...value,mode:event.target.value as Preference['mode']})}><option value="inherit">Use business defaults</option><option value="off">Off for this invoice</option><option value="custom">Custom timing for this invoice</option></select></label>
 {value.mode==='inherit'&&<p>Default: {value.defaults.after_days} days after the due date, then every {value.defaults.repeat_days} days, up to {value.defaults.max_reminders} reminders.</p>}
 {value.mode==='custom'&&<>
 <label>Days after due date<input type="number" min={1} max={30} required disabled={busy} value={value.after_days} onChange={event=>setValue({...value,after_days:event.target.valueAsNumber})}/></label>
 <label>Days between reminders<input type="number" min={3} max={30} required disabled={busy} value={value.repeat_days} onChange={event=>setValue({...value,repeat_days:event.target.valueAsNumber})}/></label>
 <label>Maximum reminders<input type="number" min={1} max={5} required disabled={busy} value={value.max_reminders} onChange={event=>setValue({...value,max_reminders:event.target.valueAsNumber})}/></label>
 </>}
 {!value.master_enabled&&<p role="status">Automatic sending is paused business-wide. This preference will apply only after the primary owner enables sending in Customer reminders settings.</p>}
 <p className="quiet">Only eligible unpaid invoices are reminded. Business Pro and activated Finviant email are required.</p>
 <button className="secondary-button" disabled={busy}>{busy?'Saving…':'Save invoice reminder preference'}</button>
 </form>}</article>
}
