import { customerDisplayName } from '../lib/customerRecords'
import { uniqueCustomerName } from '../lib/customerSuggestions'
import { supabase } from '../lib/supabase'
import type { namedInvoiceSource } from '../lib/voiceDocument'
import { listCustomers } from './customers'
import { getJob } from './jobs'

export type InvoiceSource = { id: string; kind: 'job' | 'estimate'; label: string }
export type InvoiceSourceTarget = { kind: 'job' | 'estimate' | 'invoice'; id: string }

export async function findInvoiceSources(businessId: string, source: NonNullable<ReturnType<typeof namedInvoiceSource>>) {
  const customers = await listCustomers(businessId)
  const customer = source.customer ? uniqueCustomerName(customers, source.customer) : null
  if (source.customer && !customer) throw new Error('Name the saved customer more precisely, or give the exact job title or estimate number.')
  const { data, error } = await supabase.rpc('fin_lookup_records', {
    p_business: businessId,
    p_query: { resource: source.kind === 'job' ? 'jobs' : 'estimates', query: source.name || null,
      customer_id: customer?.id ?? null, order: 'newest', offset: 0 },
  })
  if (error) throw error
  if (!Array.isArray(data?.rows)) throw new Error('Fin could not verify the saved work. Try the lookup again.')
  if (!data.complete) throw new Error('Several records match. Give the exact job title, estimate number, or customer name.')
  const query = source.name.toLowerCase()
  const matches: InvoiceSource[] = data.rows.flatMap((row: {id: string; title?: string; estimate_number?: string; status: string; customer_id: string; scheduled_start?: string; issue_date?: string}) => {
    if (!/^[\da-f-]{36}$/i.test(row.id) || row.status === 'canceled') return []
    const name = source.kind === 'job' ? row.title : row.estimate_number
    if (!name || !name.toLowerCase().includes(query)) return []
    const contact = customers.find(person => person.id === row.customer_id)
    const date = row.scheduled_start?.slice(0,10) || row.issue_date
    return [{ id: row.id, kind: source.kind, label: [name, contact && customerDisplayName(contact), date].filter(Boolean).join(' · ') }]
  })
  if (!matches.length) throw new Error('No saved work matched. Try the exact job title or estimate number.')
  return matches
}

export async function resolveInvoiceSource(businessId: string, source: InvoiceSource): Promise<InvoiceSourceTarget> {
  const column = source.kind === 'job' ? 'job_id' : 'estimate_id'
  const { data: invoice, error } = await supabase.from('invoices').select('id')
    .eq('business_id', businessId).eq(column, source.id).is('deposit_estimate_id', null).neq('status', 'void')
    .order('created_at').limit(1).maybeSingle()
  if (error) throw error
  if (invoice) return { kind: 'invoice', id: invoice.id }
  if (source.kind === 'job') {
    const job = await getJob(businessId, source.id)
    if (job.source_estimate_id) return { kind: 'estimate', id: job.source_estimate_id }
  }
  return { kind: source.kind, id: source.id }
}
