import PlanRestriction from '../components/PlanRestriction'
import {isPrimaryOwner} from '../lib/workspaceAccess'
import {useTierUsage} from '../lib/useTierUsage'
import FinancialEntryDialog from '../components/FinancialEntryDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import {
  connectQuickBooks, disconnectQuickBooks,
  getQuickBooksStatus, listQuickBooksWorkbook, listVelnuWorkbook,
  removeManualEntry, syncQuickBooks,
  type QBStatus, type WorkbookLine, type WorkbookSource,
} from '../services/bookkeeping'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const getToday = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }
function money(amount: number, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) }
  catch { return amount.toFixed(2) + ' ' + currency }
}
const permitted = ['owner','admin','office']
const managers = ['owner','admin']
type RangeChoice = '30' | '90' | 'all'
type LoadState = 'loading' | 'ready' | 'error'

function exportCsv(rows: WorkbookLine[], source: WorkbookSource) {
  const safe = (value: unknown) => {
    let string = String(value ?? '')
    if (/^[\t\r\n\s]*[=+\-@]/.test(string)) string = "'" + string
    return '"' + string.replaceAll('"', '""') + '"'
  }
  const columns = ['Date','Type','Description','Category','Amount','Currency','Source']
  const csv = [columns.map(safe).join(','), ...rows.map(row =>
    [row.entry_date,row.direction,row.description,row.category,row.amount.toFixed(2),row.currency,row.source_label]
      .map(safe).join(','))].join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'finviant-' + source + '-workbook-' + getToday() + '.csv'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function BookkeepingPage({ business }: { business: CurrentBusiness }) {
  const tier=useTierUsage(business.id),restricted=!tier||tier.plan==='free'
  const canSee = permitted.includes(business.role)
  const canManageQuickBooks = managers.includes(business.role)
  const [source, setSource] = useState<WorkbookSource>(new URLSearchParams(window.location.search).has('quickbooks') ? 'quickbooks' : 'velnu')
  const [range, setRange] = useState<RangeChoice>('90')
  const [velnuRows, setVelnuRows] = useState<WorkbookLine[]>([])
  const [qbRows, setQbRows] = useState<WorkbookLine[]>([])
  const [qbStatus, setQbStatus] = useState<QBStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [velnuState, setVelnuState] = useState<LoadState>('loading')
  const [qbState, setQbState] = useState<LoadState>('loading')
  const refreshId = useRef(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newEntry, setNewEntry] = useState(false)
  const [costsAcknowledged, setCostsAcknowledged] = useState(false)

  async function refresh() {
    if (!canSee) return
    const requestId = ++refreshId.current
    setVelnuState('loading'); setQbState('loading')
    setVelnuRows([]); setQbRows([]); setQbStatus(null)
    const results = await Promise.allSettled([
      listVelnuWorkbook(business.id),
      listQuickBooksWorkbook(business.id),
      canManageQuickBooks ? getQuickBooksStatus(business.id) : Promise.resolve(null),
    ])
    if (requestId !== refreshId.current) return
    const errors: string[] = []
    if (results[0].status === 'fulfilled') setVelnuRows(results[0].value)
    else errors.push('Finviant Office entries: ' + String(results[0].reason?.message || results[0].reason))
    setVelnuState(results[0].status === 'fulfilled' ? 'ready' : 'error')
    if (results[1].status === 'fulfilled') setQbRows(results[1].value)
    else errors.push('QuickBooks entries: ' + String(results[1].reason?.message || results[1].reason))
    setQbState(results[1].status === 'fulfilled' ? 'ready' : 'error')
    if (results[2].status === 'fulfilled') setQbStatus(results[2].value)
    else errors.push('QuickBooks status: ' + String(results[2].reason?.message || results[2].reason))
    setError(errors.join(' · '))
  }
  useEffect(() => {
    if (canSee) void refresh()
    return () => { refreshId.current += 1 }
  }, [business.id, business.role])

  const sourceState = source === 'velnu' ? velnuState : qbState
  const loading = sourceState === 'loading'
  const summary = (amount: number) => sourceState === 'ready' ? usd.format(amount) : loading ? 'Loading…' : 'Unavailable'
  const allRows = source === 'velnu' ? velnuRows : qbRows
  const visible = useMemo(() => {
    if (!restricted && range === 'all') return allRows
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - Number(restricted?'30':range))
    const from = [cutoff.getFullYear(), String(cutoff.getMonth() + 1).padStart(2, '0'), String(cutoff.getDate()).padStart(2, '0')].join('-')
    return allRows.filter(row => row.entry_date >= from)
  }, [allRows, range, restricted])

  const totals = useMemo(() => {
    // Currency and data-source isolation: QuickBooks items are *never* combined
    // with Finviant Office income. Non-USD rows are displayed but not put into USD totals.
    return visible.reduce((totals, row) => {
      if (row.currency !== 'USD') return totals
      if (row.direction === 'income') totals.income += row.amount
      else totals.expenses += row.amount
      return totals
    }, { income: 0, expenses: 0 })
  }, [visible])

  async function deleteEntry(row: WorkbookLine) {
    if (!row.removable || busy || !window.confirm('Delete this manually entered record? This cannot be undone.')) return
    setBusy(true); setError('')
    try {
      await removeManualEntry(business.id, row.id)
      await refresh()
      setNotice('Manual entry deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this record.')
    } finally { setBusy(false) }
  }

  async function connect() {
    if (!canManageQuickBooks || !costsAcknowledged || busy || !qbStatus?.configured) return
    setBusy(true); setError('')
    try {
      const url = await connectQuickBooks(business.id)
      window.location.assign(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start QuickBooks authorization.')
      setBusy(false)
    }
  }

  async function synchronize() {
    if (!canManageQuickBooks || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await syncQuickBooks(business.id)
      await refresh()
      setNotice('QuickBooks read-only import completed: ' + result.rows_processed + ' transactions processed.'
        + (result.limited ? ' Some categories exceeded the 1,000-record query limit; this is not a complete accounting report.' : ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QuickBooks sync failed.')
    } finally { setBusy(false) }
  }

  async function disconnect() {
    if (!canManageQuickBooks || busy) return
    if (!window.confirm('Disconnect QuickBooks and permanently remove its imported transactions from Finviant Office? Your records inside QuickBooks will not change.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await disconnectQuickBooks(business.id)
      setQbRows([])
      setCostsAcknowledged(false)
      await refresh()
      setNotice('QuickBooks disconnected. Imported transactions were removed from Finviant Office, not from QuickBooks.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect QuickBooks.')
    } finally { setBusy(false) }
  }

  if (!canSee) return <div className="page-stack"><WorkspaceBack />
    <div className="page-heading"><p className="eyebrow">Bookkeeping</p><h1>Company financial workbook.</h1></div>
    <p className="form-message">The Bookkeeping workbook is available to business owners, administrators, and office staff. Ask your business owner to update your access role.</p>
  </div>

  return <div className="page-stack bookkeeping-page"><WorkspaceBack />
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Bookkeeping · Money in and out</p><h1>Know what you earned. Know what you spent.</h1>
        <p className="quiet">Payments on Finviant Office invoices appear automatically. Add other expenses or income manually, or optionally connect QuickBooks Online.</p></div>
      <button className="primary-button compact" onClick={() => { setNewEntry(true); setSource('velnu') }}>+ Entry</button>
    </div>
    <section className="bookkeeping-tabs" role="group" aria-label="Workbook source">
      <button type="button" className={source === 'velnu' ? 'active' : ''} aria-pressed={source === 'velnu'} onClick={() => setSource('velnu')}>Finviant Office workbook</button>
      <button type="button" className={source === 'quickbooks' ? 'active' : ''} aria-pressed={source === 'quickbooks'} onClick={() => setSource('quickbooks')}>QuickBooks Online</button>
    </section>
    <div className="bookkeeping-toolbar">
      <label>Period <select disabled={restricted} value={restricted?'30':range} onChange={e => setRange(e.target.value as RangeChoice)}>
        <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All available entries</option>
      </select></label>
      {tier?.plan==='free'&&<PlanRestriction plan="free" required="basic" feature="Financial history beyond 30 days" canUpgrade={isPrimaryOwner(business)}/>}
      {restricted&&<button type="button" className="secondary-button compact" disabled={sourceState!=='ready'} onClick={()=>exportCsv(allRows,source)}>Export all stored records</button>}
      <button type="button" className="secondary-button compact" disabled={sourceState !== 'ready' || !visible.length} onClick={() => exportCsv(visible, source)}>Export shown transactions ({visible.length})</button>
    </div>

    {source === 'quickbooks' && <section className="bookkeeping-connect">
      <div className="bookkeeping-connect-head"><span className="bookkeeping-connect-icon">QB</span><div>
        <h2>QuickBooks Online <span className="bookkeeping-readonly">Read-only</span></h2>
        <p>Optional connection · Existing Intuit subscription required</p></div></div>
      {new URLSearchParams(window.location.search).get('quickbooks') === 'connected' && <p role="status" className="form-message">QuickBooks authorization finished. Choose Sync transactions to import your recent records.</p>}
      {new URLSearchParams(window.location.search).get('quickbooks') === 'error' && <p role="alert" className="form-message error-text">QuickBooks connection did not finish. Check your Intuit account or ask the Finviant Office administrator to review setup.</p>}
      {new URLSearchParams(window.location.search).get('quickbooks') === 'cancelled' && <p role="status" className="form-message">QuickBooks connection was canceled. Nothing was imported.</p>}
      <p className="bookkeeping-explainer">QuickBooks income and purchases are shown in a <strong>separate workbook</strong>, rather than mixed with Finviant Office payments. This avoids counting the same customer payment twice. Imported records are not editable here.</p>
      {canManageQuickBooks ? <>
        {qbStatus?.connected ? <div className="bookkeeping-connect-actions">
          <div><strong>Connected {qbStatus.environment === 'sandbox' ? 'to a sandbox company' : 'to a QuickBooks company'}</strong><small>Company ID: {qbStatus.company_id} · Last sync: {qbStatus.last_sync_at ? new Date(qbStatus.last_sync_at).toLocaleString() : 'Not yet synced'}</small></div>
          <button className="primary-button compact" disabled={busy} onClick={synchronize}>{busy ? 'Working…' : 'Sync transactions'}</button>
          <button className="secondary-button compact" disabled={busy} onClick={disconnect}>Disconnect</button>
        </div> : <>
          {qbStatus?.plan_restricted ? <PlanRestriction plan="free" required="basic" feature="QuickBooks imports" canUpgrade={isPrimaryOwner(business)}/> : !qbStatus?.configured ? <p className="form-message">The QuickBooks integration is prepared but cannot connect yet. Finviant Office's administrator must configure Intuit developer credentials and the secure OAuth callback.</p> :
            <p className="form-message">This preview currently uses <strong>{qbStatus.environment === 'sandbox' ? 'Intuit sandbox testing' : 'the live Intuit production service'}</strong>. Only connect a test account unless the integration has been approved for production.</p>}
          <label className="bookkeeping-consent"><input type="checkbox" checked={costsAcknowledged} onChange={e => setCostsAcknowledged(e.target.checked)} />
            <span>I understand QuickBooks Online requires an eligible Intuit subscription. Separate fees may apply for the selected Intuit plan, payments, add-ons, third-party services or integrations. Charges and eligibility are determined by Intuit and the relevant providers, not included automatically in Finviant Office. I authorize a read-only import of selected QuickBooks transactions.</span></label>
          <button className="primary-button compact" disabled={busy || !qbStatus?.configured || !!qbStatus.connected || !costsAcknowledged} onClick={connect}>Connect QuickBooks Online</button>
        </>}
      </> : <p className="form-message">Only a business owner or administrator may connect, sync or disconnect QuickBooks.</p>}
      <p className="bookkeeping-small">Current import covers up to 1,000 records each for QuickBooks Payments, Sales Receipts, and Purchases from approximately the past 90 days. If a category exceeds that query limit, the import is marked incomplete. It does not include bills, payroll, refunds, bank reconciliation, or a complete profit-and-loss statement. No transactions are written back to QuickBooks. <a href="https://quickbooks.intuit.com/pricing/" target="_blank" rel="noopener noreferrer">Review Intuit plans and fees</a>.</p>
    </section>}

    <section className="bookkeeping-overview" aria-label="Summary in US dollars">
      <article><small>Received income · USD</small><strong>{summary(totals.income)}</strong><span>{source === 'velnu' ? 'Recorded customer payments + manual income' : 'Imported QBO payments and sales receipts'}</span></article>
      <article><small>Recorded expenses · USD</small><strong>{summary(totals.expenses)}</strong><span>{source === 'velnu' ? 'Manually entered expenses' : 'Imported QBO purchases'}</span></article>
      <article><small>Difference · USD</small><strong>{summary(totals.income - totals.expenses)}</strong><span>Not an accounting profit-and-loss or tax report</span></article>
    </section>
    {source === 'velnu' && <p className="bookkeeping-caution">Income from Finviant Office invoices is included <strong>only when a payment is recorded</strong>, not when an invoice is issued. Do not add a second manual income entry for the same payment. Recording income here does not process a payment.</p>}
    {source === 'quickbooks' && <p className="bookkeeping-caution">QuickBooks figures are independent from Finviant Office figures. Do not add the two summaries together. Non-USD amounts are shown below but excluded from USD totals. These are selected transaction types, not a complete accounting report.</p>}
    {notice && <p className="form-message success-text" role="status">{notice}</p>}
    {error && <p className="form-message error-text" role="alert">{error}</p>}
    <section className="bookkeeping-list">
      <div className="bookkeeping-list-title"><h2>{source === 'velnu' ? 'Finviant Office income & expenses' : 'Imported QuickBooks transactions'}</h2><span>{sourceState === 'ready' ? visible.length + ' records' : 'Records unavailable'}</span></div>
      {loading ? <div className="empty-state" role="status">Loading your workbook…</div> : sourceState === 'error' ?
        <div className="empty-state"><h2>Workbook could not be loaded</h2><p>Totals and export are unavailable until all entries can be verified.</p><button className="secondary-button" onClick={() => void refresh()}>Retry loading workbook</button></div> : !visible.length ?
        <div className="empty-state"><div className="empty-icon">$</div><h2>{source === 'velnu' ? 'Your workbook is ready' : 'No QuickBooks transactions yet'}</h2>
          <p>{source === 'velnu' ? 'Record a payment on an issued invoice, or add an expense to begin.' : 'Connect QuickBooks Online and run a manual sync after Intuit setup is complete.'}</p></div> :
        <div className="bookkeeping-table-wrap"><table className="bookkeeping-table"><thead><tr>
          <th>Date</th><th>Description</th><th>Type</th><th>Source</th><th className="amount">Amount</th><th></th>
        </tr></thead><tbody>{visible.map(row => <tr key={row.source + row.id}>
          <td>{row.entry_date}</td><td><strong>{row.description}</strong><small>{row.category}</small></td>
          <td><span className={'bookkeeping-kind ' + row.direction}>{row.direction === 'income' ? 'Income' : 'Expense'}</span></td>
          <td><small>{row.source_label}</small></td><td className={'amount ' + row.direction}>{row.direction === 'expense' ? '−' : '+'}{money(row.amount, row.currency)}</td>
          <td>{row.removable && <button type="button" className="text-button" disabled={busy} onClick={() => void deleteEntry(row)}>Delete</button>}</td>
        </tr>)}</tbody></table></div>}
    </section>
    {newEntry && <FinancialEntryDialog business={business} onClose={()=>setNewEntry(false)} onSaved={(date,direction)=>{setNewEntry(false);setNotice(`${direction==='income'?'Income':'Expense'} saved. Transaction date: ${date}. Choose All time if it is outside the displayed period.`);void refresh()}}/>}
  </div>
}
