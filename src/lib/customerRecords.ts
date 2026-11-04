export type CustomerName = { id: string; first_name?: string | null; last_name?: string | null; company?: string | null }
const alphabet = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
export function customerDisplayName(customer?: CustomerName) {
  return customer ? [customer.first_name?.trim(), customer.last_name?.trim()].filter(Boolean).join(' ') || customer.company?.trim() || 'Customer' : 'Selected customer'
}
/** Last name first; company-only and single-name customers stay in the same alphabet. */
export function compareCustomers(a: CustomerName, b: CustomerName) {
  const key = (c: CustomerName) => c.last_name?.trim() || c.company?.trim() || c.first_name?.trim() || ''
  return alphabet.compare(key(a), key(b)) || alphabet.compare(a.first_name?.trim() || '', b.first_name?.trim() || '') || a.id.localeCompare(b.id)
}
export type CustomerRecordView = 'work' | 'estimates' | 'invoices'
export function customerRecordsHref(view: CustomerRecordView, customerId = '', documentId = '') {
  const query = new URLSearchParams({ view })
  if (customerId) query.set('customer', customerId)
  if (documentId) query.set('document', documentId)
  return '/?' + query.toString()
}
