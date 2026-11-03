import { supabase } from '../lib/supabase'
import type { DashboardSnapshot } from './dashboard'
import type { WorkflowActions } from './schedulingWorkflow'

export type AttentionItem =
  | {kind:'approved';data:WorkflowActions['approved'][number]}
  | {kind:'completed';data:WorkflowActions['completed'][number]}
  | {kind:'reminder';data:DashboardSnapshot['dueReminders'][number]}
  | {kind:'invoice';data:DashboardSnapshot['overdueInvoices'][number]}
  | {kind:'estimate'|'change_order';data:DashboardSnapshot['pendingApprovals'][number]}
export type AttentionPage = {page:number;page_size:number;total:number;attention_count:number;approval_count:number;items:AttentionItem[]}
export async function getAttentionPage(business:string,page:number,filter:'attention'|'approvals'):Promise<AttentionPage> {
  const {data,error}=await supabase.rpc('get_dashboard_attention_page',{p_business:business,p_page:page,p_page_size:5,p_filter:filter})
  if(error)throw new Error(error.message || 'Needs Attention could not be loaded.')
  if(!data || !Array.isArray(data.items) || !Number.isInteger(data.total) || !Number.isInteger(data.page) || data.page<1 || data.page_size!==5
    || !Number.isInteger(data.attention_count) || !Number.isInteger(data.approval_count))throw new Error('Needs Attention could not be loaded.')
  return data as AttentionPage
}
