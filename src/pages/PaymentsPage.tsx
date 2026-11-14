import {useAssistantRefresh} from '../lib/useAssistantRefresh'
import {readableError} from '../lib/errors'
import RecordListControls,{useRecordList} from '../components/RecordListControls'
import RecordPaymentDialog from '../components/RecordPaymentDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { useEffect, useState } from 'react'
import { canManageFinances, type CurrentBusiness } from '../lib/business'
import { listPayments } from '../services/payments'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type InvoiceRelation = { invoice_number: string | null; total: number; balance_due: number; customers: Customer[] | null }
type Payment = { id: string; amount: number; method: string | null; status: string; paid_at: string; notes: string | null; invoices: InvoiceRelation[] | null }

function customerName(customer?: Customer) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function PaymentsPage({ business, onOpenWorkbook }: { business: CurrentBusiness; onOpenWorkbook?: () => void }) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [showForm, setShowForm] = useState(()=>canManageFinances(business.role)&&new URLSearchParams(location.search).get('action')==='record')
  const [error, setError] = useState('')
  const [notice,setNotice]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState('')
  const records=useRecordList(payments.filter(p=>(!from||p.paid_at>=from)&&(!until||p.paid_at.slice(0,10)<=until)),p=>[p.invoices?.[0]?.invoice_number,customerName(p.invoices?.[0]?.customers?.[0]),p.method,p.paid_at,p.amount,p.status].join(' '))

  async function refresh() {
    setPayments(await listPayments(business.id) as Payment[])
  }

  useAssistantRefresh(refresh,e=>setError(readableError(e,'The saved change could not refresh. Reload the list; do not repeat the save.')))
  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load payments')) }, [business.id])

  return <div className="page-stack"><WorkspaceBack />
    <div className="page-heading split-heading"><div><p className="eyebrow">Payments</p><h1>See what came in and what is still owed.</h1></div><div className="payment-heading-actions"><button className="secondary-button compact" onClick={onOpenWorkbook}>View Financial Performance</button>{canManageFinances(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ Record payment</button>}</div></div>
    {notice&&<p role="status" className="form-message success-text">{notice}</p>}{error&&!showForm&&<p role="alert" className="error-text">{error}</p>}
    <div className="toolbar"><label>Paid from<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Paid through<input type="date" min={from} value={until} onChange={e=>setUntil(e.target.value)}/></label></div><RecordListControls label="payments" list={records}/>
    <section className="list-card">
      {payments.length === 0 ? <div className="empty-state"><div className="empty-icon">$</div><h2>No payments yet</h2><p>Record a payment here when you have actually received the funds.</p></div> : records.visible.map((payment) => {
        const invoice = payment.invoices?.[0]
        const customer = invoice?.customers?.[0]
        return <article className="document-row" key={payment.id}>
          <div className="row-main"><strong>{customerName(customer)}</strong><span>{invoice?.invoice_number || 'Invoice'} · {new Date(payment.paid_at).toLocaleDateString()} · {payment.method || 'other'}</span></div>
          <strong className="money paid-money">+${Number(payment.amount).toFixed(2)}</strong>
          <span className={`status-chip ${payment.status === 'succeeded' ? 'paid' : ''}`}>{payment.status === 'succeeded' ? 'Recorded' : payment.status}</span>
        </article>
      })}
    </section>
    {showForm && <RecordPaymentDialog businessId={business.id} onClose={() => setShowForm(false)} onSaved={message => {
      setShowForm(false); setNotice(message)
      void refresh().catch(err => setError(readableError(err, 'Payment recorded. Reload to update the ledger.')))
    }} />}
  </div>
}
