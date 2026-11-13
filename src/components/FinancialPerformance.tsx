import { useBusinessRefresh } from '../lib/useBusinessRefresh'
import FinancialInsights from './FinancialInsights'
import type {FinanceOverview} from '../services/operations'
import ReceiptLink from './ReceiptLink'
import {useTierUsage} from '../lib/useTierUsage'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../lib/business'
import FinancialEntryDialog from './FinancialEntryDialog'
import { canAccess, canOpenView } from '../lib/workspaceAccess'
import { financialBuckets, financialRange, financialTotals, type FinancialBucket, type FinancialPeriod } from '../lib/dashboardFinance'
import { listVelnuWorkbook, type WorkbookLine } from '../services/bookkeeping'
import { readableError } from '../lib/errors'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
type Detail = 'income' | 'expense' | 'all'

function FinancialTrend({ buckets, selected, onSelect }: { buckets: FinancialBucket[]; selected: string | null; onSelect: (key: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const gradient = useId().replaceAll(':','')
  const max = Math.max(1, ...buckets.map(item => Math.max(item.income, item.expenses)))
  const point = (index: number, amount: number) => ({ x: 48 + index * (700 / Math.max(1, buckets.length - 1)), y: 174 - amount / max * 142 })
  const path = (field: 'income' | 'expenses') => buckets.map((item, index) => { const p = point(index, item[field]); return `${index ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}` }).join(' ')
  const active = buckets.find(item => item.key === hovered || (!hovered && item.key === selected))
  return <div className="performance-trend">
    <div className="trend-readout" aria-live="polite">{active ? <><strong>{active.fullLabel}</strong><span>Income {usd.format(active.income)} · Expenses {usd.format(active.expenses)}</span></> : <><strong>{buckets.length > 12 ? 'Daily cash activity' : 'Income & expense trend'}</strong><span>Select a point to explore transactions</span></>}</div>
    <svg viewBox="0 0 800 220" className="performance-chart" role="group" aria-label="Income and expense chart. Select a date to review its transactions.">
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3c89d8" stopOpacity=".24"/><stop offset="100%" stopColor="#3c89d8" stopOpacity=".02"/></linearGradient></defs>
      {[0,.5,1].map(fraction => <g key={fraction} aria-hidden="true"><line x1="48" x2="748" y1={174 - fraction * 142} y2={174 - fraction * 142} stroke="#e7edf4" strokeDasharray="4 5"/><text x="2" y={178 - fraction * 142} className="chart-axis">${compact.format(max * fraction)}</text></g>)}
      <path d={`${path('income')} L 748 174 L 48 174 Z`} fill={`url(#${gradient})`} aria-hidden="true"/>
      <path d={path('income')} fill="none" stroke="#357fca" strokeWidth="3" strokeLinejoin="round" aria-hidden="true"/>
      <path d={path('expenses')} fill="none" stroke="#d69055" strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" aria-hidden="true"/>
      {buckets.map((item, index) => {
        const income = point(index, item.income), expense = point(index, item.expenses), chosen = item.key === selected
        const showLabel = buckets.length <= 12 || index % 5 === 0 || index === buckets.length - 1
        const width = Math.min(72, 700 / buckets.length)
        return <g key={item.key} className={`trend-point${chosen ? ' selected' : ''}`} role="button" tabIndex={0} aria-pressed={chosen} aria-label={`${item.fullLabel}: income ${usd.format(item.income)}, expenses ${usd.format(item.expenses)}`} onClick={() => onSelect(item.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.key) } }} onMouseEnter={() => setHovered(item.key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(item.key)} onBlur={() => setHovered(null)}>
          <rect className="chart-hit" x={income.x - width / 2} y="16" width={width} height="195" rx="7"/>
          <circle cx={income.x} cy={income.y} r={chosen ? 6 : 4} fill="#fff" stroke="#357fca" strokeWidth="2.5"/>
          <circle cx={expense.x} cy={expense.y} r="3" fill="#d69055"/>
          {showLabel && <text x={income.x} y="205" textAnchor="middle" className="chart-label">{item.label}</text>}
        </g>
      })}
    </svg>
    <div className="trend-legend"><span><i className="income"/>Income received</span><span><i className="expense"/>Recorded expenses</span></div>
  </div>
}

export default function FinancialPerformance({ business, onOpenWorkbook, refreshVersion = 0, compact = false, hideEntryAction = false, summary = false, onReceivables }: { business: CurrentBusiness; onOpenWorkbook?: () => void; refreshVersion?: number; compact?: boolean; hideEntryAction?: boolean; summary?: boolean; onReceivables?:(value:FinanceOverview|null)=>void }) {
  const [expanded,setExpanded]=useState(false)
  const card=useRef<HTMLElement>(null),previousExpanded=useRef(false)
  useEffect(()=>{if(!summary||expanded===previousExpanded.current)return;previousExpanded.current=expanded;card.current?.querySelector<HTMLElement>(expanded?'h2':'button[aria-label="View finances"]')?.focus()},[expanded,summary])
  const [newEntry,setNewEntry]=useState(false),[notice,setNotice]=useState('')
  const tier=useTierUsage(business.id),restricted=!tier||tier.plan==='free'
  const zone = business.timezone || 'America/New_York'
  const [day, setDay] = useState(() => DateTime.now().setZone(zone).toISODate()!)
  const [period, setPeriod] = useState<FinancialPeriod>(compact || summary ? 1 : 6)
  const [result, setResult] = useState<{ key: string; rows: WorkbookLine[] } | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [search, setSearch] = useState(''), [source, setSource] = useState('all'), [page, setPage] = useState(0)
  const range = restricted?{from:DateTime.fromISO(day,{zone}).minus({days:29}).toISODate()!,to:DateTime.fromISO(day,{zone}).plus({days:1}).toISODate()!,timezone:zone,label:'Last 30 days'}:financialRange(period, day, zone)
  const requestKey = [business.id, business.role, business.access_modules?.join(','), range.from, range.to, zone].join(':')
  // A background refresh must not disable a pressed read-only control or unmount
  // its open receipt while the pointer event is in progress. Retain only the last
  // successful snapshot for this exact workspace, role and date range, and label
  // it while refreshing. A failed read still removes the snapshot below.
  const ready = !error && result?.key === requestKey
  const rows = useMemo(() => result?.key === requestKey ? result.rows.filter(row => row.currency === 'USD' && row.entry_date >= range.from && row.entry_date < range.to) : [], [result, requestKey, range.from, range.to])
  useBusinessRefresh(business.id, () => { setDay(DateTime.now().setZone(zone).toISODate()!); setVersion(value => value + 1) })
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void listVelnuWorkbook(business.id, { from: range.from, to: range.to, timezone: zone }).then(data => { if (active) setResult({ key: requestKey, rows: data }) })
      .catch(err => { if (active) { setResult(null); setError(readableError(err, 'Unable to load financial transactions.')) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id, requestKey, range.from, range.to, zone, refreshVersion, version])
  const buckets = useMemo(() => restricted?Array.from({length:30},(_,i)=>{const d=DateTime.fromISO(day,{zone}).minus({days:29-i}),date=d.toISODate()!,totals=financialTotals(rows.filter(r=>r.entry_date===date));return{key:date,label:d.toFormat('d'),fullLabel:d.toFormat('MMMM d, yyyy'),from:date,to:d.plus({days:1}).toISODate()!,income:totals.income,expenses:totals.expenses}}):financialBuckets(rows, period, day, zone), [rows, period, day, zone,restricted])
  const bucket = buckets.find(item => item.key === selected)
  const scopeRows = bucket ? rows.filter(row => row.entry_date >= bucket.from && row.entry_date < bucket.to) : rows
  const totals = financialTotals(scopeRows)
  const scopeLabel = bucket?.fullLabel || range.label
  const filtered = scopeRows.filter(row => (!detail || detail === 'all' || row.direction === detail) && (source === 'all' || row.source === source) && [row.description, row.category, row.source_label, row.source_reference, row.payment_method, row.notes, row.id].join(' ').toLowerCase().includes(search.toLowerCase().trim()))
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), currentPage = Math.min(page, pages - 1)
  function resetFilters() { setSearch(''); setSource('all'); setPage(0) }
  function expand(kind: Detail) { setDetail(value => value === kind ? null : kind); resetFilters() }
  function selectBucket(key: string) { setSelected(value => value === key ? null : key); setDetail('all'); resetFilters() }
  if(summary&&!expanded)return <section ref={card} className="financial-performance dashboard-tile home-financial-card" aria-labelledby="financial-performance-title">
    <h2 className="dashboard-tile-title" id="financial-performance-title" tabIndex={summary?-1:undefined}>Financial Performance</h2><p className="home-period-label">{restricted?'Last 30 days':'This month'}</p>
    {error?<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setVersion(v=>v+1)}>Retry financial data</button></p>:!ready?<p role="status">Loading financial transactions…</p>:<dl className="home-financial-values"><div><dt>Income</dt><dd>{usd.format(totals.income)}</dd></div><div><dt>Expenses</dt><dd>{usd.format(totals.expenses)}</dd></div><div><dt>Net cash</dt><dd className={totals.net<0?'is-negative':'is-positive'}>{usd.format(totals.net)}</dd></div></dl>}
    <FinancialInsights business={business} refreshVersion={refreshVersion+version} summary onOverview={onReceivables}/>
    <button type="button" className="text-button home-financial-open" aria-label="View finances" onClick={()=>{setExpanded(true);setPeriod(1);setSelected(null);setDetail(null);resetFilters()}}>View finances <span aria-hidden="true">›</span></button>
  </section>
  return <section ref={card} className={`financial-performance interactive-performance dashboard-tile${compact ? ' performance-compact' : ''}`} aria-labelledby="financial-performance-title">
    {summary&&<button type="button" className="text-button home-detail-back" onClick={()=>{setExpanded(false);setPeriod(1);setSelected(null);setDetail(null);resetFilters()}}>‹ Back to overview</button>}
    <div className="performance-heading"><div><p className="eyebrow">Business insights</p><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><h2 className="dashboard-tile-title" id="financial-performance-title" tabIndex={summary?-1:undefined}>Financial Performance</h2>{!hideEntryAction&&canAccess(business,"finances")&&<button type="button" className="calendar-add" onClick={()=>setNewEntry(true)}>{compact?'Add transaction':'+ Add Entry'}</button>}</div><p>{range.label} · USD</p></div><div className="view-switch financial-range" role="group" aria-label="Financial period">{([1,3,6,12] as const).map(months => <button key={months} type="button" disabled={restricted} aria-pressed={period === months} aria-label={`${months} ${months === 1 ? 'month' : 'months'}`} onClick={() => { setPeriod(months); setSelected(null); setDetail(null); resetFilters() }}>{months}<span>{compact ? 'M' : months === 1 ? ' month' : ' months'}</span></button>)}</div></div>
    {restricted&&<p className="quiet">Free includes the last 30 days. <a href="/?view=settings&section=plans">Individual includes full financial history.</a> Your original records remain available for viewing and export.</p>}
    {notice&&<p role="status" className="form-message">{notice}</p>}
    {loading&&ready&&<p role="status" className="quiet">Refreshing financial transactions. Showing the last successful update.</p>}
    {newEntry&&<FinancialEntryDialog business={business} onClose={()=>setNewEntry(false)} onSaved={(date,direction,payment)=>{setNewEntry(false);setSelected(null);resetFilters();setNotice(`${payment?'Payment recorded':direction==='income'?'Income saved':'Expense saved'}.${date<range.from||date>=range.to?' This transaction is outside the selected period. View all income & expenses to find it.':' Totals are refreshing.'}`);setVersion(v=>v+1)}}/>}
    <FinancialInsights business={business} refreshVersion={refreshVersion+version} compact={compact} rows={ready?scopeRows:[]} onOverview={onReceivables}/>
    <div className="insight-section-heading"><div><h3>Cash activity</h3><p className="quiet">Recorded income and expenses · {scopeLabel}</p></div></div>
    {error ? <div className="performance-unavailable" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setVersion(value => value + 1)}>Retry financial data</button></div> : !ready ? <div className="performance-loading" role="status">Loading financial transactions…</div> : !compact ? <FinancialTrend buckets={buckets} selected={bucket?.key || null} onSelect={selectBucket}/> : null}
    <div className="performance-scope"><span>{!ready ? loading ? 'Loading financial data…' : 'Financial data unavailable' : bucket ? `Viewing ${scopeLabel}` : `Period total · ${scopeRows.length} transactions`}</span>{bucket && <button className="text-button" onClick={() => { setSelected(null); resetFilters() }}>Show entire period</button>}</div>
    <div className="performance-metrics">
      {([{ kind: 'income', label: compact?'Income received':'Income', value: totals.income, count: scopeRows.filter(row => row.direction === 'income').length }, { kind: 'expense', label: 'Expenses', value: totals.expenses, count: scopeRows.filter(row => row.direction === 'expense').length }, { kind: 'all', label: 'Net Cash Flow', value: totals.net, count: scopeRows.length }] as const).map(item => <button key={item.kind} type="button" className={`performance-metric ${item.kind}`} disabled={!ready} aria-expanded={detail === item.kind} aria-controls="financial-transactions" onClick={() => expand(item.kind)}>
        <span>{item.label}<span aria-hidden="true">{detail === item.kind ? '−' : '+'}</span></span><strong>{ready ? usd.format(item.value) : '—'}</strong><small>{ready ? `${item.count} ${item.count === 1 ? 'transaction' : 'transactions'}` : 'Unavailable'} <span aria-hidden="true">↗</span></small>
      </button>)}
    </div>
    {compact && <details className="home-financial-trend"><summary>Income &amp; expense trend</summary>{ready ? <FinancialTrend buckets={buckets} selected={bucket?.key || null} onSelect={selectBucket}/> : <p className="calendar-status" role="status">{error ? 'Financial data unavailable. Retry above.' : 'Loading chart…'}</p>}</details>}
    {detail && ready && <div id="financial-transactions" className="financial-transactions" role="region" aria-label={`${detail === 'all' ? 'All' : detail === 'income' ? 'Income' : 'Expense'} transactions`}>
      <div className="transaction-heading"><div><h3>{detail === 'all' ? 'All transactions' : detail === 'income' ? 'Income transactions' : 'Expense transactions'}</h3><p>{scopeLabel}{detail === 'all' ? ` · Income ${usd.format(totals.income)} − expenses ${usd.format(totals.expenses)} = ${usd.format(totals.net)}` : ''}</p></div><button className="calendar-arrow" aria-label="Close transaction details" onClick={() => setDetail(null)} type="button">×</button></div>
      <div className="transaction-filters"><label>Search transactions<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Description, source, or reference…"/></label><label>Source<select value={source} onChange={event => { setSource(event.target.value); setPage(0) }}><option value="all">All sources</option><option value="invoice_payment">Invoice payments</option><option value="manual">Manual & job entries</option></select></label></div>
      {!filtered.length ? <p className="transaction-empty">{search || source !== 'all' ? 'No transactions match these filters.' : 'No transactions recorded in this period.'}</p> : <ul className="transaction-list">{filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(row => <li key={`${row.source}:${row.id}`}>
        <span className={`transaction-direction ${row.direction}`} aria-label={row.direction === 'income' ? 'Income' : 'Expense'}>{row.direction === 'income' ? '↙' : '↗'}</span>
        <div className="transaction-copy"><strong>{row.description || row.category}</strong><span>{DateTime.fromISO(row.entry_date).toFormat('MMM d, yyyy')} · {row.category}</span><span className="transaction-origin">{row.source_label}{row.payment_method ? ` · ${row.payment_method.replaceAll('_',' ')}` : ''}{row.source_reference ? ` · ${row.source_reference}` : ''}</span>{row.notes && <p>{row.notes}</p>}{row.receiptPath&&<ReceiptLink path={row.receiptPath}/>}{row.source_id && row.source_view && canOpenView(business, row.source_view) && <a href={`/?view=${row.source_view}&document=${encodeURIComponent(row.source_id)}`}>View {row.source_view === 'work' ? 'job' : row.source_view === 'invoices' ? 'invoice' : 'estimate'} <span aria-hidden="true">↗</span></a>}</div>
        <strong className={`transaction-amount ${row.direction}`}>{row.direction === 'income' ? '+' : '−'}{usd.format(row.amount)}</strong>
      </li>)}</ul>}
      <div className="transaction-pagination"><span>{filtered.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, filtered.length)} of ${filtered.length}` : '0 transactions'}</span>{pages > 1 && <div><button className="secondary-button compact" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="secondary-button compact" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div>}</div>
    </div>}
    <div className="performance-footer">{compact ? <details className="performance-explanation"><summary>What’s included</summary><p>Income includes recorded payments. Expenses include recorded costs. QuickBooks and non-USD entries stay separate.</p></details> : <p>Income includes recorded payments. Expenses include recorded costs. QuickBooks and non-USD entries stay separate.</p>}{onOpenWorkbook && <button className="text-button" onClick={onOpenWorkbook}>View all income &amp; expenses <span aria-hidden="true">↗</span></button>}</div>
  </section>
}
