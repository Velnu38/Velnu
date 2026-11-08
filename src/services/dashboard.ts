import { DateTime } from 'luxon'
import { readFinancialNumber } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

type CustomerRef = Array<{ first_name: string | null; last_name: string | null; company: string | null }> | null

export interface DashboardSnapshot {
  openInvoices: number
  outstandingBalance: number
  activeJobCount: number
  activeJobs: Array<{ id: string; title: string; status: string; customers: CustomerRef }>
  recentDocuments: Array<{
    id: string; kind: 'estimate' | 'invoice'; number: string | null; title: string | null;
    status: string; total: number; created_at: string; customers: CustomerRef
  }>
  overdueInvoiceCount: number
  pendingApprovalCount: number
  pendingEstimateCount?: number
  pendingChangeOrderCount?: number
  dueReminderCount: number
  overdueInvoices: Array<{
    id: string
    invoice_number: string | null
    due_date: string | null
    balance_due: number
    customers: CustomerRef
  }>
  dueReminders: Array<{
    id: string
    kind: string
    due_at: string
    note: string | null
    invoice_id: string | null
    estimate_id: string | null
    job_id: string | null
    customer_id: string | null
  }>
  todayAppointments: Array<{
    id: string
    title: string
    starts_at: string
    ends_at: string | null
    status: string
    customers: CustomerRef
  }>
  pendingApprovals: Array<{
    id: string
    document_type: 'estimate' | 'change_order'
    estimate_id?: string | null
    number: string | null
    title: string
    total: number
    issue_date: string
    customers: CustomerRef
  }>
}

export async function getDashboardSnapshot(businessId: string, timezone = 'America/New_York', access: Record<string,boolean> = {calendar:true,jobs:true,billing:true,finances:true}): Promise<DashboardSnapshot> {
  const now = new Date()
  const localNow = DateTime.fromJSDate(now).setZone(timezone)
  const todayStart = localNow.startOf('day').toJSDate()
  const tomorrowStart = localNow.startOf('day').plus({ days: 1 }).toJSDate()
  const todayDate = localNow.toISODate()!

  const skip = { data: [] as any[], count: 0, error: null }
  const [invoices, jobs, overdueInvoices, dueReminders, todayAppointments, estimatesAwaiting, changeOrdersAwaiting, recentEstimates, recentInvoices] = await Promise.all([
    // SECURITY INVOKER RPC calculates exact totals under the caller's existing invoice RLS.
    access.billing ? supabase.rpc('get_dashboard_invoice_totals', { target_business_id: businessId }).single() : {data:{open_invoices:0,outstanding_balance:0},error:null},
    access.jobs ? supabase.from('jobs').select('id,title,status,customers!jobs_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).in('status', ['lead','scheduled','in_progress']).order('updated_at', { ascending: false }).order('id').limit(3) : skip,
    access.billing ? supabase.from('invoices').select('id,invoice_number,due_date,balance_due,customers!invoices_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).lt('due_date', todayDate).gt('balance_due', 0) .in('status', ['sent','viewed','partial','overdue']).order('due_date', { ascending: true }).limit(10) : skip,
    access.calendar ? supabase.from('reminders').select('id,kind,due_at,note,invoice_id,estimate_id,job_id,customer_id', { count: 'exact' }).eq('business_id', businessId).eq('status', 'pending').lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(10) : skip,
    access.calendar ? supabase.from('appointments').select('id,title,starts_at,ends_at,status,customers!appointments_customer_id_fkey(first_name,last_name,company)').eq('business_id', businessId).gte('starts_at', todayStart.toISOString()).lt('starts_at', tomorrowStart.toISOString()).neq('status', 'canceled').order('starts_at', { ascending: true }).limit(20) : skip,
    access.billing ? supabase.from('estimates').select('id,estimate_number,total,issue_date,customers!estimates_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).eq('status', 'sent').order('issue_date', { ascending: true }).limit(10) : skip,
    access.billing ? supabase.from('change_orders').select('id,estimate_id,change_order_number,title,total,issue_date,customers!change_orders_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).eq('status', 'sent').order('issue_date', { ascending: true }).limit(10) : skip,
    // Five from each source are sufficient to find the latest five in their union.
    // Queries stay bounded and retain the caller's tenant filters and RLS.
    access.billing ? supabase.from('estimates').select('id,estimate_number,status,total,created_at,customers!estimates_customer_id_fkey(first_name,last_name,company),jobs!estimates_job_id_fkey(title)').eq('business_id', businessId).order('created_at', { ascending: false }).order('id').limit(5) : skip,
    access.billing ? supabase.from('invoices').select('id,invoice_number,status,total,created_at,customers!invoices_customer_id_fkey(first_name,last_name,company),jobs!invoices_job_id_fkey(title)').eq('business_id', businessId).order('created_at', { ascending: false }).order('id').limit(5) : skip,
  ])

  for (const result of [invoices, jobs, overdueInvoices, dueReminders, todayAppointments, estimatesAwaiting, changeOrdersAwaiting, recentEstimates, recentInvoices]) {
    if (result.error) throw result.error
  }

  // This is a database table-returning RPC. Keep the response contract explicit:
  // the project does not yet generate typed Supabase Database definitions.
  const invoiceTotals = invoices.data as {
    open_invoices: number | string
    outstanding_balance: number | string
  } | null
  if (!invoiceTotals) throw new Error('Unable to calculate dashboard invoice totals')

  const pendingApprovals: DashboardSnapshot['pendingApprovals'] = [
    ...(estimatesAwaiting.data ?? []).map((row: any) => ({
      id: row.id,
      document_type: 'estimate' as const,
      number: row.estimate_number,
      title: 'Estimate awaiting approval',
      total: Number(row.total ?? 0),
      issue_date: row.issue_date,
      customers: asList(row.customers),
    })),
    ...(changeOrdersAwaiting.data ?? []).map((row: any) => ({
      id: row.id,
      document_type: 'change_order' as const,
      estimate_id: row.estimate_id,
      number: row.change_order_number,
      title: row.title || 'Change order awaiting approval',
      total: Number(row.total ?? 0),
      issue_date: row.issue_date,
      customers: asList(row.customers),
    })),
  ].sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))).slice(0, 12)

  return {
    openInvoices: readFinancialNumber(invoiceTotals.open_invoices),
    outstandingBalance: readFinancialNumber(invoiceTotals.outstanding_balance),
    activeJobCount: jobs.count ?? 0,
    activeJobs: (jobs.data ?? []).map(row => ({ ...row, customers: asList(row.customers) })),
    recentDocuments: [
      ...(recentEstimates.data ?? []).map(row => ({ id: row.id, kind: 'estimate' as const, number: row.estimate_number, status: row.status,
        total: readFinancialNumber(row.total), created_at: row.created_at, customers: asList(row.customers), title: asList(row.jobs)[0]?.title || null })),
      ...(recentInvoices.data ?? []).map(row => ({ id: row.id, kind: 'invoice' as const, number: row.invoice_number, status: row.status,
        total: readFinancialNumber(row.total), created_at: row.created_at, customers: asList(row.customers), title: asList(row.jobs)[0]?.title || null })),
    ].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || a.id.localeCompare(b.id)).slice(0,5),
    overdueInvoiceCount: overdueInvoices.count ?? (overdueInvoices.data ?? []).length,
    dueReminderCount: dueReminders.count ?? (dueReminders.data ?? []).length,
    pendingApprovalCount: (estimatesAwaiting.count ?? (estimatesAwaiting.data ?? []).length)
      + (changeOrdersAwaiting.count ?? (changeOrdersAwaiting.data ?? []).length),
    pendingEstimateCount: estimatesAwaiting.count ?? (estimatesAwaiting.data ?? []).length,
    pendingChangeOrderCount: changeOrdersAwaiting.count ?? (changeOrdersAwaiting.data ?? []).length,
    overdueInvoices: (overdueInvoices.data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) })) as DashboardSnapshot['overdueInvoices'],
    dueReminders: (dueReminders.data ?? []) as DashboardSnapshot['dueReminders'],
    todayAppointments: (todayAppointments.data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) })) as DashboardSnapshot['todayAppointments'],
    pendingApprovals,
  }
}

export async function completeReminder(reminderId: string) {
  const { error } = await supabase
    .from('reminders')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', reminderId)
    .eq('status', 'pending')

  if (error) throw error
}
