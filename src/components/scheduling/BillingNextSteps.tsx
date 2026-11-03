import type { DashboardSnapshot } from '../../services/dashboard'
export default function BillingNextSteps({snapshot,loading,error}:{snapshot:DashboardSnapshot;loading:boolean;error:string}) {
 if(loading)return <p className="calendar-empty" role="status">Loading invoice and estimate follow-ups…</p>
 if(error)return <p className="calendar-empty">Invoice and estimate follow-ups are unavailable. Refresh to try again.</p>
 return <div className="billing-next-steps"><ul className="calendar-reminders">
  {snapshot.overdueInvoices.slice(0,3).map(row=><li key={row.id}><div><strong>Follow up on {row.invoice_number||'unpaid invoice'}</strong><span>Payment is overdue.</span></div><a className="secondary-button compact" href={`/?view=invoices&document=${encodeURIComponent(row.id)}`}>Review invoice</a></li>)}
  {snapshot.pendingApprovals.slice(0,3).map(row=><li key={row.id}><div><strong>Follow up on {row.number||'customer approval'}</strong><span>Waiting for customer approval.</span></div><a className="secondary-button compact" href={row.document_type==='estimate'?`/?view=estimates&document=${encodeURIComponent(row.id)}`:row.estimate_id?`/?view=estimates&document=${encodeURIComponent(row.estimate_id)}`:'/?view=change_orders'}>Review {row.document_type==='estimate'?'estimate':'change'}</a></li>)}
 </ul>{snapshot.overdueInvoiceCount>3&&<a href="/?view=invoices">Review all {snapshot.overdueInvoiceCount} overdue invoices</a>}{snapshot.pendingApprovalCount>3&&<a href="/?view=estimates">Review all {snapshot.pendingApprovalCount} pending approvals</a>}</div>
}
