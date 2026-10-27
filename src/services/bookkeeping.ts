import { supabase } from '../lib/supabase'
import { asList } from './relations'

export type EntryDirection = 'income' | 'expense'
export type WorkbookSource = 'velnu' | 'quickbooks'

export interface WorkbookLine {
  id: string
  entry_date: string
  direction: EntryDirection
  description: string
  category: string
  amount: number
  currency: string
  source: 'invoice_payment' | 'manual' | 'quickbooks'
  source_label: string
  removable: boolean
}

export interface BookkeepingInput {
  id: string
  business_id: string
  entry_date: string
  direction: EntryDirection
  amount: number
  category: string
  description: string
  notes?: string
}
type PaymentRow = {
  id: string
  amount: number
  paid_at: string
  status: string
  method: string | null
  invoices: unknown
}
type QBRow = {
  id: string
  txn_date: string
  direction: EntryDirection
  amount: number
  description: string
  source_type: string
  currency: string
}
function dollars(v: unknown) {
  const value = Number(v)
  return Number.isFinite(value) ? value : 0
}

export async function listVelnuWorkbook(businessId: string): Promise<WorkbookLine[]> {
  const [payments, manual] = await Promise.all([
    supabase.from('payments')
      .select('id,amount,paid_at,status,method,invoices!payments_invoice_id_fkey(invoice_number)')
      .eq('business_id', businessId).eq('status', 'succeeded').order('paid_at', { ascending: false }).limit(1000),
    supabase.from('bookkeeping_entries')
      .select('id,entry_date,direction,amount,currency,category,description')
      .eq('business_id', businessId).order('entry_date', { ascending: false }).limit(1000),
  ])
  if (payments.error) throw payments.error
  if (manual.error) throw manual.error
  const received = ((payments.data ?? []) as PaymentRow[]).map(p => {
    const inv = asList(p.invoices as { invoice_number: string | null } | null)[0]
    const invoice = inv?.invoice_number || 'Invoice'
    return {
      id: p.id,
      entry_date: p.paid_at.slice(0, 10),
      direction: 'income' as EntryDirection,
      description: 'Payment received · ' + invoice,
      category: 'Paid services',
      amount: dollars(p.amount),
      currency: 'USD',
      source: 'invoice_payment' as const,
      source_label: 'Finviant Office payment record',
      removable: false,
    }
  })
  const extra = (manual.data ?? []).map(row => ({
    id: row.id,
    entry_date: row.entry_date as string,
    direction: row.direction as EntryDirection,
    description: row.description as string,
    category: row.category as string,
    amount: dollars(row.amount),
    currency: (row.currency as string) || 'USD',
    source: 'manual' as const,
    source_label: 'Manual entry',
    removable: true,
  }))
  return [...received, ...extra].sort((a, b) => b.entry_date.localeCompare(a.entry_date))
}

export async function listQuickBooksWorkbook(businessId: string): Promise<WorkbookLine[]> {
  const { data, error } = await supabase.from('quickbooks_transactions')
    .select('id,txn_date,direction,amount,description,source_type,currency')
    .eq('business_id', businessId)
    .order('txn_date', { ascending: false }).limit(1000)
  if (error) throw error
  return ((data ?? []) as QBRow[]).map(row => ({
    id: row.id,
    entry_date: row.txn_date,
    direction: row.direction,
    description: row.description,
    category: row.source_type === 'Purchase' ? 'QuickBooks purchases' : row.source_type === 'Payment' ? 'QuickBooks payments' : 'QuickBooks sales receipts',
    amount: dollars(row.amount),
    currency: row.currency || 'USD',
    source: 'quickbooks' as const,
    source_label: 'QuickBooks Online · ' + row.source_type,
    removable: false,
  }))
}

export async function addManualEntry(input: BookkeepingInput) {
  const amt = Number(input.amount)
  if (!Number.isFinite(amt) || amt <= 0 || Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-7) {
    throw new Error('Enter a positive amount with no more than two decimal places.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entry_date) || Number.isNaN(Date.parse(input.entry_date + 'T00:00:00'))) {
    throw new Error('Choose a valid transaction date.')
  }
  if (!input.description.trim() || !input.category.trim()) {
    throw new Error('A description and category are required.')
  }
  const { error } = await supabase.from('bookkeeping_entries').insert({
    id: input.id,
    business_id: input.business_id,
    entry_date: input.entry_date,
    direction: input.direction,
    amount: amt,
    category: input.category.trim(),
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    currency: 'USD',
  })
  if (error && error.code !== '23505') throw error
}

export async function removeManualEntry(businessId: string, id: string) {
  const { error } = await supabase.from('bookkeeping_entries')
    .delete().eq('business_id', businessId).eq('id', id)
  if (error) throw error
}

type QBResponse<T> = { data: T; error: null } | { data: null; error: Error }
async function invokeQB<T>(businessId: string, body: Record<string, unknown>): Promise<T> {
  const response = await supabase.functions.invoke('quickbooks', {
    body: { business_id: businessId, ...body },
  }) as QBResponse<T>
  if (response.error) {
    const ctx = (response.error as unknown as { context?: Response }).context
    if (ctx instanceof Response) {
      const detail = await ctx.clone().json().catch(() => null) as { error?: string } | null
      if (detail?.error) throw new Error(detail.error)
    }
    throw response.error
  }
  return response.data as T
}
export interface QBStatus {
  configured: boolean
  plan_restricted?: boolean
  connected: boolean
  environment: 'sandbox' | 'production'
  company_id: string | null
  last_sync_at: string | null
  last_sync_count: number
  callback_url: string
}
export async function getQuickBooksStatus(businessId: string) {
  return invokeQB<QBStatus>(businessId, { action: 'status' })
}
export async function connectQuickBooks(businessId: string) {
  const response = await invokeQB<{ authorization_url: string }>(businessId, {
    action: 'connect',
    acknowledged_extra_costs: true,
  })
  if (!response.authorization_url.startsWith('https://appcenter.intuit.com/connect/oauth2?')) {
    throw new Error('Unexpected Intuit authorization address.')
  }
  return response.authorization_url
}
export async function syncQuickBooks(businessId: string) {
  return invokeQB<{ success: boolean; rows_processed: number; last_sync_at: string; limited: boolean; since: string }>(businessId, {
    action: 'sync',
  })
}
export async function disconnectQuickBooks(businessId: string) {
  return invokeQB<{ disconnected: boolean }>(businessId, {
    action: 'disconnect',
    confirm_delete_imported_data: true,
  })
}
