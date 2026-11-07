import '../change-orders.css'
import type { ChangeOrderAmounts } from '../lib/changeOrderAmounts'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function ChangeOrderTotals({ amounts, approved = false }: { amounts: ChangeOrderAmounts; approved?: boolean }) {
  const change = Number(amounts.change_amount)
  const paid = Number(amounts.deposit_paid) + Number(amounts.other_paid)
  const remaining = Math.round((Number(amounts.revised_total) - paid) * 100) / 100
  return <dl className="change-order-totals" aria-label="Change order totals">
    <div><dt>Current total</dt><dd>{currency.format(Number(amounts.current_total))}</dd></div>
    <div><dt>This change</dt><dd>{change > 0 ? '+' : ''}{currency.format(change)}</dd></div>
    <div className="change-order-revised-total"><dt>Revised total</dt><dd>{currency.format(Number(amounts.revised_total))}</dd></div>
    {Number(amounts.deposit_paid) > 0 && <div><dt>Deposit paid</dt><dd>{currency.format(Number(amounts.deposit_paid))}</dd></div>}
    {Number(amounts.other_paid) > 0 && <div><dt>Other payments recorded</dt><dd>{currency.format(Number(amounts.other_paid))}</dd></div>}
    {paid > 0 && (remaining < 0
      ? <div><dt>Credit or refund to review</dt><dd>{currency.format(-remaining)}</dd></div>
      : <div><dt>{approved ? 'Remaining on revised work' : 'Remaining if approved'}</dt><dd>{currency.format(remaining)}</dd></div>)}
  </dl>
}
