import { supabase } from '../lib/supabase'
import { announceCalendarChange } from './calendar'
export type WorkerProfile = {id:string;name:string;trade:string;active:boolean;is_owner:boolean;use_business_hours:boolean;work_days:number[];start_minutes:number;end_minutes:number;updated_at:string}
export type WorkerRoster = {workers:WorkerProfile[];active_count:number;worker_limit:number;plan:'free'|'basic'|'pro'}
async function request<T>(name:string,args:Record<string,unknown>):Promise<T> {
  const {data,error}=await supabase.rpc(name,args)
  if(error)throw new Error(error.message)
  return data as T
}
export function getWorkers(business:string){return request<WorkerRoster>('get_worker_roster',{p_business:business})}
export async function saveWorker(business:string,id:string,input:Omit<WorkerProfile,'id'|'is_owner'|'updated_at'>,expected:string|null){
  await request('save_worker_profile',{p_business:business,p_id:id,p_input:input,p_expected:expected})
  announceCalendarChange()
}
