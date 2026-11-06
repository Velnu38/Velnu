import { finInvoiceDraft, resolveFinInvoiceSeed } from '../lib/voiceDocument'
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
  const [debouncedText, setDebouncedText] = useState('')
  useEffect(() => {
    let active = true
    setRecords(null); setFailed(false)
    void listCustomers(businessId).then(customers => { if (active) setRecords({businessId, customers}) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [businessId])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text), 180)
    return () => window.clearTimeout(timer)
  }, [text])
  if (disabled || !text.trim() || debouncedText !== text || /\[Saved customer record /.test(text)) return null
  const savedCustomers = records?.businessId === businessId ? records.customers : []
  const invoice = finInvoiceDraft(text)
  const match = text.match(/\b(?:invoice|estimate|job)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|with|due|on|at|total)\b|[,;$\n]|$)/i)
  const query = invoice ? resolveFinInvoiceSeed(invoice, savedCustomers).customerName
    : match?.[1]?.trim() || (text.trim().split(/\s+/).length <= 4 ? text.trim() : '')
  if (query.length < 2) return null
  if (failed) return <p className="quiet">Customer suggestions could not load. Fin can still look up your request.</p>
  const customers = matchingCustomers(savedCustomers, query)
  if (!customers.length) return null
  return <section className="customer-picker" aria-label="Suggested customers for Fin"><p className="quiet">Use a saved customer in this request</p><div className="customer-picker-options">
    {customers.map(customer => <button type="button" key={customer.id} onClick={() => {
      const name = customerOptionName(customer)
      const details = [customer.email, customer.phone].filter(Boolean).join(' · ')
      onSelect(text + '\n[Saved customer record ' + customer.id + ': ' + name + (details ? ' · ' + details : '') + ']', customer.id)
    }}><strong>{invoice ? 'Create invoice for ' : 'Use '}{customerOptionName(customer)}</strong><span>{[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ') || 'Customer record ' + customer.id.slice(-8)}</span></button>)}
  </div></section>
}
