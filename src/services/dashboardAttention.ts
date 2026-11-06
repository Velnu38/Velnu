import { supabase } from '../lib/supabase'
import type { DashboardSnapshot } from './dashboard'
import type { WorkflowActions } from './schedulingWorkflow'

export type AttentionItem =
  | {kind:'approved';data:WorkflowActions['approved'][number]}
  | {kind:'completed';data:WorkflowActions['completed'][number]}
  | {kind:'reminder';data:DashboardSnapshot['dueReminders'][number]}
  | {kind:'invoice';data:DashboardSnapshot['overdueInvoices'][number]}
  | {kind:'estimate'|'change_order';data:DashboardSnapshot['pendingApprovals'][number]}
export type AttentionCategoryCounts = {schedule:number;invoice:number;overdue:number;follow_up:number}
export type AttentionPage = {page:number;page_size:number;total:number;attention_count:number;approval_count:number;category_counts:AttentionCategoryCounts;items:AttentionItem[]}
export async function getAttentionPage(business:string,page:number,filter:'attention'|'approvals'|'schedule'|'invoice'|'overdue'|'follow_up'):Promise<AttentionPage> {
  const {data,error}=await supabase.rpc('get_dashboard_attention_page',{p_business:business,p_page:page,p_page_size:5,p_filter:filter})
  if(error)throw new Error(error.message || 'Needs Attention could not be loaded.')
  if(!data || !Array.isArray(data.items) || !Number.isInteger(data.total) || !Number.isInteger(data.page) || data.page<1 || data.page_size!==5
    || !Number.isInteger(data.attention_count) || !Number.isInteger(data.approval_count) || !data.category_counts
    || !['schedule','invoice','overdue','follow_up'].every(key=>Number.isInteger(data.category_counts[key as keyof AttentionCategoryCounts])))throw new Error('Needs Attention could not be loaded.')
  return data as AttentionPage
}
