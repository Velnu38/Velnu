import { supabase } from '../lib/supabase'
import { announceCalendarChange } from './calendar'
export type CalendarEntry={id:string;title:string;notes:string|null;starts_at:string;ends_at:string|null;assigned_user_id:string|null;updated_at:string;job_id:string|null}
const fields='id,title,notes,starts_at,ends_at,assigned_user_id,updated_at,job_id'
export async function getCalendarEntry(business:string,id:string):Promise<CalendarEntry>{
  const {data,error}=await supabase.from('appointments').select(fields).eq('business_id',business).eq('id',id).single();if(error)throw error;return data
}
export async function saveCalendarEntry(business:string,input:{id:string;title:string;notes:string;starts_at:string;ends_at:string;assigned_user_id:string},previous?:CalendarEntry){
  if(!input.title.trim()||input.title.trim().length>200||input.notes.length>2000)throw new Error('Add a title up to 200 characters and notes up to 2,000 characters.')
  const payload={...input,title:input.title.trim(),notes:input.notes.trim()||null,business_id:business}
  if(previous?.job_id)throw new Error('Edit scheduled jobs from Jobs so the crew and customer stay linked.')
  const query=previous?supabase.from('appointments').update(payload).eq('business_id',business).eq('id',previous.id).eq('updated_at',previous.updated_at):supabase.from('appointments').insert({...payload,status:'scheduled'})
  const {data,error}=await query.select(fields).single()
  if(error){
    if(error.code==='23505'&&!previous){const saved=await getCalendarEntry(business,input.id);if(['title','notes','starts_at','ends_at','assigned_user_id'].every(key=>{
      const a=saved[key as keyof CalendarEntry],b=payload[key as keyof typeof payload];return key.endsWith('_at')?Date.parse(String(a))===Date.parse(String(b)):a===b
    })){announceCalendarChange();return saved}}
    if(error.code==='PGRST116')throw new Error('This entry changed in another session. Close and reopen it before editing.')
    throw error
  }
  if(!data)throw new Error('The calendar save is not confirmed. Retry the same entry.')
  announceCalendarChange();return data as CalendarEntry
}

export async function cancelCalendarEntry(business:string,previous:CalendarEntry) {
 if(previous.job_id)throw new Error('Manage linked work from Jobs to keep the schedule consistent.')
 const {data,error}=await supabase.from('appointments').update({status:'canceled'}).eq('business_id',business).eq('id',previous.id).eq('updated_at',previous.updated_at).select('id').maybeSingle()
 if(error)throw error
 if(!data){const saved=await supabase.from('appointments').select('status').eq('business_id',business).eq('id',previous.id).single();if(saved.error)throw saved.error;if(saved.data.status!=='canceled')throw new Error('This event changed elsewhere. Reopen it before canceling.')}
 announceCalendarChange()
}
