import { DateTime } from 'luxon'
import type { FinanceOverview } from '../services/operations'
import './kanban.css'
const money = (n: number) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(n)
const lanes = ['current','1–30 days','31–60 days','61–90 days','91+ days','date_review']
export function collectionLane(due: string, asOf: string) {
  const end = DateTime.fromISO(asOf.slice(0,10)), start = DateTime.fromISO(due)
  if (!start.isValid || !end.isValid) return 'date_review'
  const days = Math.floor(end.diff(start,'days').days)
  return days <= 0 ? 'current' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '91+ days'
}
export default function CollectionsKanban({value,canOpenInvoices}:{value:FinanceOverview;canOpenInvoices:boolean}) {
  return <section aria-label="Collections Kanban" className="collections-kanban">
    <h4>Collections board</h4><p className="quiet">Current unpaid issued invoices, grouped by age. Balances include recorded payments. Open an invoice to review follow-up or payment actions.</p>
    <p className="quiet">Scroll across to see each aging lane. Invoice cards preview up to eight oldest past-due records.</p>
    <div className="workflow-kanban" tabIndex={0} role="group" aria-label="Collections aging lanes">{lanes.filter(lane=>lane!=='date_review'||value.aging.some(a=>a.bucket===lane)).map(lane=>{
      const aging=value.aging.find(a=>a.bucket===lane)
      const invoices=value.oldest.filter(i=>collectionLane(i.due_date,value.as_of)===lane)
      return <section className="workflow-lane" key={lane} aria-label={lane==='current'?'Not yet overdue':lane==='date_review'?'Date needs review':lane}>
        <header><h5>{lane==='current'?'Not yet overdue':lane==='date_review'?'Date needs review':lane}</h5><strong>{money(aging?.amount||0)}</strong><span>{aging?.count||0} invoices</span></header>
        {invoices.map((invoice,index)=><article className="workflow-card" key={`${invoice.id}:${index}`}><strong>{canOpenInvoices?<a href={'/?view=invoices&document='+encodeURIComponent(invoice.id)}>{invoice.invoice_number}</a>:invoice.invoice_number}</strong><span>{money(invoice.balance_due)} remaining</span><small>Due {invoice.due_date}</small></article>)}
        <p className="quiet">{canOpenInvoices&&<a href="/?view=invoices&filter=open">View invoice records</a>}</p>
        <p className="quiet">{!aging?.count?'No outstanding invoices.':invoices.length?`${invoices.length} from the oldest unpaid invoice preview. See invoice records for the full list.`:'See invoice records for invoices in this lane.'}</p>
      </section>
    })}</div>
  </section>
}
