import { readFinancialNumber } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

type CustomerRef = Array<{ first_name: string | null; last_name: string | null; company: string | null }> | null

export interface DashboardSnapshot {
  openInvoices: number
  outstandingBalance: number
  jobsThisWeek: number
  overdueInvoiceCount: number
  pendingApprovalCount: number
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
    number: string | null
    title: string
    total: number
    issue_date: string
    customers: CustomerRef
  }>
}

export async function getDashboardSnapshot(businessId: string): Promise<DashboardSnapshot> {
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() + 7)

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(todayStart.getDate() + 1)
  const todayDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')

  const [invoices, jobs, overdueInvoices, dueReminders, todayAppointments, estimatesAwaiting, changeOrdersAwaiting] = await Promise.all([
    // SECURITY INVOKER RPC calculates exact totals under the caller's existing invoice RLS.
    supabase.rpc('get_dashboard_invoice_totals', { target_business_id: businessId }).single(),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('scheduled_start', now.toISOString()).lt('scheduled_start', weekEnd.toISOString()).neq('status', 'canceled'),
    supabase.from('invoices').select('id,invoice_number,due_date,balance_due,customers!invoices_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).lt('due_date', todayDate).gt('balance_due', 0) .not('status', 'in', '(draft,void)').order('due_date', { ascending: true }).limit(10),
    supabase.from('reminders').select('id,kind,due_at,note,invoice_id,estimate_id,job_id,customer_id', { count: 'exact' }).eq('business_id', businessId).eq('status', 'pending').lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(10),
    supabase.from('appointments').select('id,title,starts_at,ends_at,status,customers!appointments_customer_id_fkey(first_name,last_name,company)').eq('business_id', businessId).gte('starts_at', todayStart.toISOString()).lt('starts_at', tomorrowStart.toISOString()).neq('status', 'canceled').order('starts_at', { ascending: true }).limit(20),
    supabase.from('estimates').select('id,estimate_number,total,issue_date,customers!estimates_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).eq('status', 'sent').order('issue_date', { ascending: true }).limit(10),
    supabase.from('change_orders').select('id,change_order_number,title,total,issue_date,customers!change_orders_customer_id_fkey(first_name,last_name,company)', { count: 'exact' }).eq('business_id', businessId).eq('status', 'sent').order('issue_date', { ascending: true }).limit(10),
  ])

  for (const result of [invoices, jobs, overdueInvoices, dueReminders, todayAppointments, estimatesAwaiting, changeOrdersAwaiting]) {
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
    jobsThisWeek: jobs.count ?? 0,
    overdueInvoiceCount: overdueInvoices.count ?? (overdueInvoices.data ?? []).length,
    dueReminderCount: dueReminders.count ?? (dueReminders.data ?? []).length,
    pendingApprovalCount: (estimatesAwaiting.count ?? (estimatesAwaiting.data ?? []).length)
      + (changeOrdersAwaiting.count ?? (changeOrdersAwaiting.data ?? []).length),
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
