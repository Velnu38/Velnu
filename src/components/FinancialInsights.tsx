import {useEffect,useState} from 'react'
import {DateTime} from 'luxon'
import type {CurrentBusiness} from '../lib/business'
import {canOpenView} from '../lib/workspaceAccess'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import {getFinancialOverview,type FinanceOverview} from '../services/operations'
import type {WorkbookLine} from '../services/bookkeeping'
import './operations.css'
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n))
const buckets=['current','1–30 days','31–60 days','61–90 days','91+ days']
export default function FinancialInsights({business,refreshVersion=0,compact=false,rows=[]}:{business:CurrentBusiness;refreshVersion?:number;compact?:boolean;rows?:WorkbookLine[]}){
 const [result,setResult]=useState<{key:string;value:FinanceOverview}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0),[detail,setDetail]=useState(false)
 const key=[business.id,business.role,business.access_modules?.join(',')].join(':')
 useBusinessRefresh(business.id,()=>setVersion(v=>v+1))
 useEffect(()=>{let active=true;setLoading(true);setError('');getFinancialOverview(business.id).then(value=>{if(active)setResult({key,value})}).catch(()=>{if(active){setResult(null);setError('Receivables could not load. Refresh to retry.')}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[key,refreshVersion,version])
 const value=result?.key===key&&!error&&!loading?result.value:null
 const categories=new Map<string,number>();for(const row of rows)if(row.direction==='expense'&&row.currency==='USD')categories.set(row.category,(categories.get(row.category)||0)+Math.round(Number(row.amount)*100))
 const InvoiceLink=canOpenView(business,'invoices')?'a':'div'
 const costs=[...categories].sort((a,b)=>b[1]-a[1]).slice(0,6),max=Math.max(1,...costs.map(c=>c[1]))
 return <div className={'finance-insights'+(compact?' is-compact':'')}>
  <div className="insight-section-heading"><div><p className="eyebrow">Money coming in</p><h3>Receivables</h3><p className="quiet">{value?.as_of?'As of '+DateTime.fromISO(value.as_of).toFormat('MMM d, yyyy'):'Current invoice balances'} · separate from the cash period below</p></div><button type="button" className="text-button" onClick={()=>setDetail(v=>!v)} aria-expanded={detail}>{detail?'Hide breakdown':'View breakdown'}</button></div>
  {error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setVersion(v=>v+1)}>Retry</button></p>}
  {value?.currency_supported===false?<p role="status">Receivables insights currently support USD businesses. Your original documents and transactions remain available.</p>:<div className="receivable-cards" aria-busy={loading}>
   <InvoiceLink href={canOpenView(business,'invoices')?'/?view=invoices&filter=open':undefined} className="insight-stat"><span>Outstanding</span><strong>{value?money(value.receivables.outstanding):'—'}</strong><small>{value?`${value.receivables.invoices} unpaid invoices`:'Loading invoice balances…'}</small></InvoiceLink>
   <InvoiceLink href={canOpenView(business,'invoices')?'/?view=invoices&filter=overdue':undefined} className="insight-stat is-warning"><span>Past due</span><strong>{value?money(value.receivables.overdue):'—'}</strong><small>{value?`${value.receivables.overdue_count} invoices need follow-up`:'Loading overdue invoices…'}</small></InvoiceLink>
  </div>}
  {detail&&value?.currency_supported&&<div className="finance-detail-grid"><section><h4>Receivables aging</h4><ul className="insight-lines">{[...buckets,...(value.aging.some(r=>r.bucket==='date_review')?['date_review']:[])].map(bucket=>{const row=value.aging.find(r=>r.bucket===bucket);return <li key={bucket}><span>{bucket==='current'?'Not yet overdue':bucket==='date_review'?'Past due · date needs review':bucket}<small>{row?.count||0} invoices</small></span><strong>{money(row?.amount||0)}</strong></li>})}</ul><p className="quiet">Unpaid issued invoices only. Drafts and void invoices are excluded; recorded payments reduce the balance.</p></section><section><h4>Customer balances</h4>{value.customers.length?<ul className="insight-lines">{value.customers.map(c=><li key={c.customer_id}><span>{canOpenView(business,'customers')?<a href={'/?view=customers&document='+c.customer_id}>{c.customer}</a>:c.customer}<small>{c.invoices} open invoices</small></span><strong>{money(c.balance)}</strong></li>)}</ul>:<p className="quiet">No outstanding customer balances.</p>}</section>{!!value.oldest.length&&<section><h4>Oldest unpaid invoices</h4><ul className="insight-lines">{value.oldest.map(i=><li key={i.id}><span>{canOpenView(business,'invoices')?<a href={'/?view=invoices&document='+i.id}>{i.invoice_number}</a>:i.invoice_number}<small>Due {DateTime.fromISO(i.due_date).toFormat('MMM d, yyyy')}</small></span><strong>{money(i.balance_due)}</strong></li>)}</ul></section>}</div>}
  {!compact&&costs.length>0&&<details className="cost-breakdown"><summary>Where recorded expenses went · selected cash period</summary><ul className="cost-bars">{costs.map(([name,cents])=><li key={name}><div><span>{name}</span><strong>{money(cents/100)}</strong></div><meter min={0} max={max} value={cents} aria-label={name+' expenses'}/></li>)}</ul><p className="quiet">Largest six recorded categories. Provider refunds remain cash outflows; they are not operating profit expenses.</p></details>}
 </div>
}
