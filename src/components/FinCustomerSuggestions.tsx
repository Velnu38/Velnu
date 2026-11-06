import { finInvoiceDraft } from '../lib/voiceDocument'
import { useEffect, useState } from 'react'
import { listCustomers } from '../services/customers'
import { customerOptionName, matchingCustomers, type CustomerOption } from '../lib/customerSuggestions'
import './customer-picker.css'

export default function FinCustomerSuggestions({businessId, text, disabled, onSelect}: {
  businessId: string
  text: string
  disabled: boolean
  onSelect: (text: string, customerId: string) => void
}) {
  const [records, setRecords] = useState<{businessId: string; customers: CustomerOption[]} | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let active = true
    setRecords(null); setFailed(false)
    void listCustomers(businessId).then(customers => { if (active) setRecords({businessId, customers}) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [businessId])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const invoice = finInvoiceDraft(text)
      const match = text.match(/\b(?:invoice|estimate|job)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|with|due|on|at|total)\b|[,;$\n]|$)/i)
      setQuery(invoice ? invoice.seed.customerName : match?.[1]?.trim() || (text.trim().split(/\s+/).length <= 4 ? text.trim() : ''))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [text])
  if (disabled || query.length < 2 || /\[Saved customer record /.test(text)) return null
  if (failed) return <p className="quiet">Customer suggestions could not load. Fin can still look up your request.</p>
  const customers = records?.businessId === businessId ? matchingCustomers(records.customers, query) : []
  if (!customers.length) return null
  return <section className="customer-picker" aria-label="Suggested customers for Fin"><p className="quiet">Use a saved customer in this request</p><div className="customer-picker-options">
    {customers.map(customer => <button type="button" key={customer.id} onClick={() => {
      const name = customerOptionName(customer)
      const details = [customer.email, customer.phone].filter(Boolean).join(' · ')
      onSelect(text + '\n[Saved customer record ' + customer.id + ': ' + name + (details ? ' · ' + details : '') + ']', customer.id)
    }}><strong>Use {customerOptionName(customer)}</strong><span>{[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ') || 'Customer record ' + customer.id.slice(-8)}</span></button>)}
  </div></section>
}
