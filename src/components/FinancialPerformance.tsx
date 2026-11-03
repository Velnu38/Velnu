import { useEffect, useId, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../lib/business'
import { canOpenView } from '../lib/workspaceAccess'
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

export default function FinancialPerformance({ business, onOpenWorkbook, refreshVersion = 0 }: { business: CurrentBusiness; onOpenWorkbook?: () => void; refreshVersion?: number }) {
  const zone = business.timezone || 'America/New_York'
  const [day, setDay] = useState(() => DateTime.now().setZone(zone).toISODate()!)
  const [period, setPeriod] = useState<FinancialPeriod>(6)
  const [result, setResult] = useState<{ key: string; rows: WorkbookLine[] } | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [search, setSearch] = useState(''), [source, setSource] = useState('all'), [page, setPage] = useState(0)
  const range = financialRange(period, day, zone)
  const requestKey = [business.id, business.role, business.access_modules?.join(','), range.from, range.to, zone].join(':')
  const ready = !loading && !error && result?.key === requestKey
  const rows = useMemo(() => result?.key === requestKey ? result.rows.filter(row => row.currency === 'USD' && row.entry_date >= range.from && row.entry_date < range.to) : [], [result, requestKey, range.from, range.to])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) { setDay(DateTime.now().setZone(zone).toISODate()!); setVersion(value => value + 1) } }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [zone])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void listVelnuWorkbook(business.id, { from: range.from, to: range.to, timezone: zone }).then(data => { if (active) setResult({ key: requestKey, rows: data }) })
      .catch(err => { if (active) { setResult(null); setError(readableError(err, 'Unable to load financial transactions.')) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id, requestKey, range.from, range.to, zone, refreshVersion, version])
  const buckets = useMemo(() => financialBuckets(rows, period, day, zone), [rows, period, day, zone])
  const bucket = buckets.find(item => item.key === selected)
  const scopeRows = bucket ? rows.filter(row => row.entry_date >= bucket.from && row.entry_date < bucket.to) : rows
  const totals = financialTotals(scopeRows)
  const scopeLabel = bucket?.fullLabel || range.label
  const filtered = scopeRows.filter(row => (!detail || detail === 'all' || row.direction === detail) && (source === 'all' || row.source === source) && [row.description, row.category, row.source_label, row.source_reference, row.payment_method, row.notes, row.id].join(' ').toLowerCase().includes(search.toLowerCase().trim()))
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), currentPage = Math.min(page, pages - 1)
  function resetFilters() { setSearch(''); setSource('all'); setPage(0) }
  function expand(kind: Detail) { setDetail(value => value === kind ? null : kind); resetFilters() }
  function selectBucket(key: string) { setSelected(value => value === key ? null : key); setDetail('all'); resetFilters() }
  return <section className="financial-performance interactive-performance dashboard-tile" aria-labelledby="financial-performance-title">
    <div className="performance-heading"><div><p className="eyebrow">Business insights</p><h2 className="dashboard-tile-title" id="financial-performance-title">Financial performance</h2><p>{range.label} · USD</p></div><div className="view-switch financial-range" role="group" aria-label="Financial period">{([1,3,6,12] as const).map(months => <button key={months} type="button" aria-pressed={period === months} aria-label={`${months} ${months === 1 ? 'month' : 'months'}`} onClick={() => { setPeriod(months); setSelected(null); setDetail(null); resetFilters() }}>{months}<span> {months === 1 ? 'month' : 'months'}</span></button>)}</div></div>
    {error ? <div className="performance-unavailable" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setVersion(value => value + 1)}>Retry financial data</button></div> : !ready ? <div className="performance-loading" role="status">Loading financial transactions…</div> : <FinancialTrend buckets={buckets} selected={bucket?.key || null} onSelect={selectBucket}/>}
    <div className="performance-scope"><span>{!ready ? loading ? 'Loading financial data…' : 'Financial data unavailable' : bucket ? `Viewing ${scopeLabel}` : `Period total · ${scopeRows.length} transactions`}</span>{bucket && <button className="text-button" onClick={() => { setSelected(null); resetFilters() }}>Show entire period</button>}</div>
    <div className="performance-metrics">
      {([{ kind: 'income', label: 'Income', value: totals.income, count: scopeRows.filter(row => row.direction === 'income').length }, { kind: 'expense', label: 'Expenses', value: totals.expenses, count: scopeRows.filter(row => row.direction === 'expense').length }, { kind: 'all', label: 'Net total', value: totals.net, count: scopeRows.length }] as const).map(item => <button key={item.kind} type="button" className={`performance-metric ${item.kind}`} disabled={!ready} aria-expanded={detail === item.kind} aria-controls="financial-transactions" onClick={() => expand(item.kind)}>
        <span>{item.label}<span aria-hidden="true">{detail === item.kind ? '−' : '+'}</span></span><strong>{ready ? usd.format(item.value) : '—'}</strong><small>{ready ? `${item.count} ${item.count === 1 ? 'transaction' : 'transactions'}` : 'Unavailable'} <span aria-hidden="true">↗</span></small>
      </button>)}
    </div>
    {detail && ready && <div id="financial-transactions" className="financial-transactions" role="region" aria-label={`${detail === 'all' ? 'All' : detail === 'income' ? 'Income' : 'Expense'} transactions`}>
      <div className="transaction-heading"><div><h3>{detail === 'all' ? 'All transactions' : detail === 'income' ? 'Income transactions' : 'Expense transactions'}</h3><p>{scopeLabel}{detail === 'all' ? ` · Income ${usd.format(totals.income)} − expenses ${usd.format(totals.expenses)} = ${usd.format(totals.net)}` : ''}</p></div><button className="calendar-arrow" aria-label="Close transaction details" onClick={() => setDetail(null)} type="button">×</button></div>
      <div className="transaction-filters"><label>Search transactions<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Description, source, or reference…"/></label><label>Source<select value={source} onChange={event => { setSource(event.target.value); setPage(0) }}><option value="all">All sources</option><option value="invoice_payment">Invoice payments</option><option value="manual">Manual & job entries</option></select></label></div>
      {!filtered.length ? <p className="transaction-empty">{search || source !== 'all' ? 'No transactions match these filters.' : 'No transactions recorded in this period.'}</p> : <ul className="transaction-list">{filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(row => <li key={`${row.source}:${row.id}`}>
        <span className={`transaction-direction ${row.direction}`} aria-label={row.direction === 'income' ? 'Income' : 'Expense'}>{row.direction === 'income' ? '↙' : '↗'}</span>
        <div className="transaction-copy"><strong>{row.description || row.category}</strong><span>{DateTime.fromISO(row.entry_date).toFormat('MMM d, yyyy')} · {row.category}</span><span className="transaction-origin">{row.source_label}{row.payment_method ? ` · ${row.payment_method.replaceAll('_',' ')}` : ''}{row.source_reference ? ` · ${row.source_reference}` : ''}</span>{row.notes && <p>{row.notes}</p>}{row.source_id && row.source_view && canOpenView(business, row.source_view) && <a href={`/?view=${row.source_view}&document=${encodeURIComponent(row.source_id)}`}>View {row.source_view === 'work' ? 'job' : row.source_view === 'invoices' ? 'invoice' : 'estimate'} <span aria-hidden="true">↗</span></a>}</div>
        <strong className={`transaction-amount ${row.direction}`}>{row.direction === 'income' ? '+' : '−'}{usd.format(row.amount)}</strong>
      </li>)}</ul>}
      <div className="transaction-pagination"><span>{filtered.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, filtered.length)} of ${filtered.length}` : '0 transactions'}</span>{pages > 1 && <div><button className="secondary-button compact" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="secondary-button compact" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div>}</div>
    </div>}
    <div className="performance-footer"><p>Income includes recorded payments. Expenses include recorded costs. QuickBooks and non-USD entries stay separate.</p>{onOpenWorkbook && <button className="text-button" onClick={onOpenWorkbook}>Full workbook <span aria-hidden="true">↗</span></button>}</div>
  </section>
}
