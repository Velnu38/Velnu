import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { changeOrderStatusLabel, isLinkedChangeOrder, type DocumentChangeOrderContext } from '../lib/documentChangeOrders'
import { getChangeOrderBilling, getDocumentChangeContext, listChangeOrders, type ChangeOrderBilling, type DocumentChangeSource } from '../services/changeOrders'
import { readPendingPersonalSend } from '../services/personalDelivery'
import '../change-orders.css'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const signed = (value: number) => (value > 0 ? '+' : '') + money.format(value)
type Order = Awaited<ReturnType<typeof listChangeOrders>>[number]
type Entry = { order: Order; pending: boolean; billing?: ChangeOrderBilling }

const billingLabels: Record<ChangeOrderBilling['action'], string> = {
  awaiting_approval: '',
  billed: 'Included on invoice',
  included_on_final: 'Will be included on the final invoice',
  verify_existing: 'Review existing invoice',
  add_to_draft: 'Ready to add to draft invoice',
  create_invoice: 'Ready to bill',
  manual_review: 'Review billing or credit',
  scope_only: 'No billing change',
}

export default function DocumentChangeOrders({ business, context, allowNew, onOpen }: {
  business: CurrentBusiness
  context: DocumentChangeOrderContext
  allowNew: boolean
  onOpen: (orderId: string) => void
}) {
  const { documentType, documentId, documentNumber, customerId, jobId } = context
  const [summary, setSummary] = useState<{ source: DocumentChangeSource; entries: Entry[] }>()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    let loading = false
    async function refresh() {
      if (document.hidden || loading) return
      loading = true
      try {
        const source = await getDocumentChangeContext(documentType, documentId)
        const scope = { documentType, documentId, documentNumber, customerId, jobId: source.job_id ?? jobId }
        const orders = (await listChangeOrders(business.id, scope)).filter(order => isLinkedChangeOrder(order, scope))
        const entries = await Promise.all(orders.map(async order => ({
          order,
          pending: order.status === 'draft' && !!(await readPendingPersonalSend(business.id, 'change_order', order.id)),
          billing: order.status === 'approved' ? await getChangeOrderBilling(order.id).catch(() => undefined) : undefined,
        })))
        if (active) { setSummary({ source, entries }); setError(false) }
      } catch {
        if (active) setError(true)
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [business.id, documentType, documentId, documentNumber, customerId, jobId, retry])

  const entries = summary?.entries ?? []
  const showNew = allowNew && summary?.source.can_change
  if (!entries.length && !showNew && summary && !error) return null
  const approved = entries.some(({ order }) => order.status === 'approved')
  const total = summary?.source.current_total
  return <section className="detail-card document-linked-changes calendar-no-print" aria-label="Linked change orders">
    <div className="linked-changes-heading">
      <h2>Change orders</h2>
      {showNew && <button type="button" className="secondary-button compact" onClick={() => onOpen('new')}>+ New change order</button>}
    </div>
    {error && <p role="alert">Change orders couldn’t refresh. <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!summary && !error && <p role="status" className="quiet">Loading change orders…</p>}
    {summary && !entries.length && <p className="quiet">No linked change orders yet.</p>}
    {approved && total != null && <p className="linked-changes-total">Approved project total <strong>{money.format(total)}</strong></p>}
    {entries.length > 0 && <ul className="linked-changes-list">{entries.map(({ order, pending, billing }) => {
      const totals = order.change_totals
      const status = changeOrderStatusLabel(order.status, pending)
      const isProposed = order.status === 'draft' || order.status === 'sent'
      const change = Number(totals?.change_amount ?? order.total)
      const proposed = totals?.revised_total ?? (total == null ? null : total + change)
      const invoiceHref = billing?.invoice_id && billing.invoice_id !== documentId
        ? '/?view=invoices&document=' + encodeURIComponent(billing.invoice_id) : null
      const billingLabel = billing?.action === 'billed' && billing.status === 'void' ? 'Linked invoice voided'
        : billing?.action === 'billed' && billing.status === 'draft' ? 'Added to draft invoice'
        : billing && billingLabels[billing.action]
      const action = pending ? 'Confirm sent' : order.status !== 'approved' ? 'Open change order'
        : billing && ['add_to_draft','create_invoice','verify_existing','manual_review'].includes(billing.action) ? 'Review billing' : 'Open change order'
      return <li key={order.id}>
        <div><strong>{order.change_order_number || 'Draft change order'} · {order.title}</strong>
          <p><span className="status-chip">{status}</span> <span>{signed(change)}</span></p>
          {isProposed && proposed != null && <p className="quiet">{totals ? 'Proposed total as quoted' : 'Projected total if approved'} {money.format(proposed)}</p>}
          {order.status === 'approved' && !billing && <p className="quiet">Open the change order to check billing.</p>}
          {billingLabel && <p className="quiet">{billingLabel}{billing?.action === 'billed' && billing.number ? ' · ' + billing.number : ''}</p>}
        </div>
        <div className="linked-changes-actions">
          <button type="button" className="secondary-button compact" onClick={() => onOpen(order.id)}
            aria-label={action + ' ' + (order.change_order_number || order.title)}>{action}</button>
          {invoiceHref && billing?.action === 'billed' && <a href={invoiceHref}>Open linked invoice</a>}
        </div>
      </li>
    })}</ul>}
  </section>
}
