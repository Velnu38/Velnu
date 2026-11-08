import { useEffect, useRef, useState } from 'react'
import { useBusinessRefresh } from '../lib/useBusinessRefresh'
import { listCustomerPaymentReviews, type CustomerPaymentReview } from '../services/customerPaymentReviews'

const reasons: Record<string, string> = {
  credited_deposit_refund: 'A refund affects a deposit credited to a final invoice. Review both records together.',
  settled_payment_needs_reconciliation: 'An online payment was received after the invoice balance changed. Confirm how the received funds should be allocated.',
  invoice_changed_before_checkout: 'The invoice changed while its payment page was being prepared. Confirm the earlier checkout is closed before requesting another payment.',
}

/** Read-only queue: no record is marked paid or resolved from a browser action. */
export default function CustomerPaymentReviews({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<CustomerPaymentReview[]>([])
  const [error, setError] = useState('')
  const current = useRef(businessId)
  const sequence = useRef(0)
  current.current = businessId
  async function refresh() {
    const business = businessId, request = ++sequence.current
    try {
      const reviews = await listCustomerPaymentReviews(business)
      if (current.current === business && sequence.current === request) { setRows(reviews); setError('') }
    } catch {
      if (current.current === business && sequence.current === request) setError('Payment review status is unavailable. Retry before reconciling an online payment.')
    }
  }
  useEffect(() => {
    setRows([]); setError(''); void refresh()
    return () => { sequence.current++ }
  }, [businessId])
  useBusinessRefresh(businessId, refresh)
  if (!rows.length && !error) return null
  return <section className="dashboard-tile" aria-label="Payments to review">
    <h2>Payments to review</h2>
    {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => void refresh()}>Retry</button></p>}
    {rows.map(row => <article key={row.id} className="work-card">
      <strong>{row.invoice_number || 'Invoice'} · {new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(Number(row.amount))}</strong>
      <p>{reasons[row.reason] || 'This online payment needs reconciliation before another payment can be requested.'}</p>
      <a className="text-button" href={'/?view=invoices&document=' + encodeURIComponent(row.invoice_id)}>Review invoice</a>
    </article>)}
  </section>
}
