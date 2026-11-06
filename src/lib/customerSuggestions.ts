export type CustomerOption = {
  id: string
  first_name: string | null
  last_name: string | null
  company: string | null
  email?: string | null
  phone?: string | null
}

export function customerOptionName(customer: CustomerOption) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export function normalizeCustomerSearch(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

export function matchingCustomers(customers: CustomerOption[], query: string) {
  const term = normalizeCustomerSearch(query)
  if (!term) return customers.slice(0, 8)
  const digits = term.replace(/\D/g, '')
  return customers.map(customer => {
    const fields = [customerOptionName(customer), customer.company, customer.email, customer.phone].filter(Boolean).map(value => normalizeCustomerSearch(value!))
    const exact = fields.includes(term)
    const prefix = fields.some(value => value.startsWith(term))
    const tokens = term.split(' ').every(token => fields.some(value => value.includes(token)))
    const phone = digits.length >= 3 && /^[\d\s()+.-]+$/.test(term) && (customer.phone || '').replace(/\D/g, '').includes(digits)
    return { customer, score: exact ? 3 : prefix ? 2 : tokens || phone ? 1 : 0 }
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || customerOptionName(a.customer).localeCompare(customerOptionName(b.customer))).map(match => match.customer).slice(0, 8)
}

/** Auto-selection is safe only when the full name identifies one saved record. */
export function uniqueCustomerName(customers: CustomerOption[], name: string) {
  const term = normalizeCustomerSearch(name)
  if (!term) return undefined
  const matches = customers.filter(customer => [customerOptionName(customer), customer.company].some(value => value && normalizeCustomerSearch(value) === term))
  return matches.length === 1 ? matches[0] : undefined
}
