import { supabase } from '../lib/supabase'
import { asList } from './relations'
import { collectWorkbookPages } from '../lib/workbookPages'

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
    collectWorkbookPages((from, to) => supabase.from('payments')
      .select('id,amount,paid_at,status,method,invoices!payments_invoice_id_fkey(invoice_number)', { count: 'exact' })
      .eq('business_id', businessId).eq('status', 'succeeded')
      .order('id', { ascending: true }).range(from, to)),
    collectWorkbookPages((from, to) => supabase.from('bookkeeping_entries')
      .select('id,entry_date,direction,amount,currency,category,description', { count: 'exact' })
      .eq('business_id', businessId).order('id', { ascending: true }).range(from, to)),
  ])
  const received = (payments as PaymentRow[]).map(p => {
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
  const extra = manual.map(row => ({
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
  const data = await collectWorkbookPages((from, to) => supabase.from('quickbooks_transactions')
    .select('id,txn_date,direction,amount,description,source_type,currency', { count: 'exact' })
    .eq('business_id', businessId).order('id', { ascending: true }).range(from, to))
  return (data as QBRow[]).map(row => ({
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
  })).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
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
  const payload = {
    id: input.id,
    business_id: input.business_id,
    entry_date: input.entry_date,
    direction: input.direction,
    amount: amt,
    category: input.category.trim(),
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    currency: 'USD',
  }
  const { error } = await supabase.from('bookkeeping_entries').insert(payload)
  if (!error) return
  if (error.code !== '23505') throw error
  // A lost acknowledgement may cause a legitimate retry. A unique-key error
  // alone does not prove that this workspace's exact entry was saved.
  const { data: existing, error: readError } = await supabase.from('bookkeeping_entries')
    .select('id,business_id,entry_date,direction,amount,category,description,notes,currency')
    .eq('business_id', input.business_id).eq('id', input.id).maybeSingle()
  if (readError || !existing) {
    throw new Error('Unable to verify whether this entry was saved. Reload the workbook before trying again.')
  }
  const same = existing.business_id === payload.business_id && existing.id === payload.id &&
    existing.entry_date === payload.entry_date && existing.direction === payload.direction &&
    Number(existing.amount) === payload.amount && existing.currency === payload.currency &&
    existing.category === payload.category && existing.description === payload.description &&
    (existing.notes ?? null) === payload.notes
  if (!same) {
    throw new Error('This entry was already saved with different details. Review the workbook before adding another entry.')
  }
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
