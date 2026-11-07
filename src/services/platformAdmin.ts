import {supabase} from '../lib/supabase'
export type CaseRow={id:string;title:string;description?:string;priority:string;status:string;version:number;created_at:string;updated_at:string;business_name?:string}
export type CaseDetail={case:CaseRow;messages:{id:string;body:string;audience:string;sender?:string;created_at:string}[]}
export type AdminOverview={checked_at:string;environment:string;accounts:number;account_limit:number;pro_workspaces:number;open_cases:number;billing:string;database:string;email_queue:number;email_failures:number;provider_note:string}
export async function adminRequest<T>(action:string,input:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await supabase.rpc('platform_admin_request',{p_action:action,p_input:input})
 if(error)throw new Error('Administration could not be reached. Check your connection and retry.')
 if(data?.error)throw new Error(data.error)
 return data as T
}
export async function supportRequest<T>(business:string,action:string,input:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await supabase.rpc('support_request',{p_business:business,p_action:action,p_input:input})
 if(error)throw new Error('Support could not be reached. Your entered text is preserved; retry this request.')
 if(data?.error)throw new Error(data.error)
 return data as T
}
