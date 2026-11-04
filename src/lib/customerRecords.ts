export type CustomerName = { id: string; first_name?: string | null; last_name?: string | null; company?: string | null }
const alphabet = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
export function customerDisplayName(customer?: CustomerName) {
  return customer ? [customer.first_name?.trim(), customer.last_name?.trim()].filter(Boolean).join(' ') || customer.company?.trim() || 'Customer' : 'Selected customer'
}
/** Visible directory name makes last-name ordering easy to scan. */
export function customerDirectoryName(customer: CustomerName) {
  const first = customer.first_name?.trim(), last = customer.last_name?.trim()
  return last ? [last, first].filter(Boolean).join(', ') : first || customer.company?.trim() || 'Unnamed customer'
}
/** Named contacts first; missing surnames use the supplied name, never a guessed one.
 * Numbered records follow the alphabet so large QA/import batches don't bury names. */
export function compareCustomers(a: CustomerName, b: CustomerName) {
  const key = (c: CustomerName) => c.last_name?.trim() || c.first_name?.trim() || c.company?.trim() || ''
  const group = (c: CustomerName) => !key(c) ? 3 : !/^\p{L}/u.test(key(c)) ? 2 : c.last_name?.trim() ? 0 : 1
  return group(a)-group(b) || alphabet.compare(key(a), key(b)) || alphabet.compare(a.first_name?.trim() || '', b.first_name?.trim() || '') || a.id.localeCompare(b.id)
}
export type CustomerRecordView = 'work' | 'estimates' | 'invoices'
export function customerRecordsHref(view: CustomerRecordView, customerId = '', documentId = '') {
  const query = new URLSearchParams({ view })
  if (customerId) query.set('customer', customerId)
  if (documentId) query.set('document', documentId)
  return '/?' + query.toString()
}
