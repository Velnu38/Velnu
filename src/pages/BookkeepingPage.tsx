import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { CurrentBusiness } from '../lib/business'
import {
  addManualEntry, connectQuickBooks, disconnectQuickBooks,
  getQuickBooksStatus, listQuickBooksWorkbook, listVelnuWorkbook,
  removeManualEntry, syncQuickBooks,
  type EntryDirection, type QBStatus, type WorkbookLine, type WorkbookSource,
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
  anchor.download = 'velnu-' + source + '-workbook-' + getToday() + '.csv'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function BookkeepingPage({ business }: { business: CurrentBusiness }) {
  const canSee = permitted.includes(business.role)
  const canManageQuickBooks = managers.includes(business.role)
  const [source, setSource] = useState<WorkbookSource>(new URLSearchParams(window.location.search).has('quickbooks') ? 'quickbooks' : 'velnu')
  const [range, setRange] = useState<RangeChoice>('90')
  const [velnuRows, setVelnuRows] = useState<WorkbookLine[]>([])
  const [qbRows, setQbRows] = useState<WorkbookLine[]>([])
  const [qbStatus, setQbStatus] = useState<QBStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newEntry, setNewEntry] = useState(false)
  const [direction, setDirection] = useState<EntryDirection>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Materials & supplies')
  const [description, setDescription] = useState('')
  const [entryDate, setEntryDate] = useState(getToday)
  const [notes, setNotes] = useState('')
  const [costsAcknowledged, setCostsAcknowledged] = useState(false)
  const retryId = useRef<string | null>(null)

  async function refresh() {
    if (!canSee) return
    const results = await Promise.allSettled([
      listVelnuWorkbook(business.id),
      listQuickBooksWorkbook(business.id),
      canManageQuickBooks ? getQuickBooksStatus(business.id) : Promise.resolve(null),
    ])
    const errors: string[] = []
    if (results[0].status === 'fulfilled') setVelnuRows(results[0].value)
    else errors.push('Velnu entries: ' + String(results[0].reason?.message || results[0].reason))
    if (results[1].status === 'fulfilled') setQbRows(results[1].value)
    else errors.push('QuickBooks entries: ' + String(results[1].reason?.message || results[1].reason))
    if (results[2].status === 'fulfilled') setQbStatus(results[2].value)
    else errors.push('QuickBooks status: ' + String(results[2].reason?.message || results[2].reason))
    setError(errors.join(' · '))
  }
  useEffect(() => {
    if (!canSee) { setLoading(false); return }
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [business.id, business.role])

  const allRows = source === 'velnu' ? velnuRows : qbRows
  const visible = useMemo(() => {
    if (range === 'all') return allRows
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - Number(range))
    const from = [cutoff.getFullYear(), String(cutoff.getMonth() + 1).padStart(2, '0'), String(cutoff.getDate()).padStart(2, '0')].join('-')
    return allRows.filter(row => row.entry_date >= from)
  }, [allRows, range])

  const totals = useMemo(() => {
    // Currency and data-source isolation: QuickBooks items are *never* combined
    // with Velnu income. Non-USD rows are displayed but not put into USD totals.
    return visible.reduce((totals, row) => {
      if (row.currency !== 'USD') return totals
      if (row.direction === 'income') totals.income += row.amount
      else totals.expenses += row.amount
      return totals
    }, { income: 0, expenses: 0 })
  }, [visible])

  async function saveManual(event: FormEvent) {
    event.preventDefault()
    if (!canSee || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      retryId.current ||= crypto.randomUUID()
      await addManualEntry({
        id: retryId.current, business_id: business.id, direction, entry_date: entryDate,
        category, description, notes, amount: Number(amount),
      })
      retryId.current = null
      setNewEntry(false)
      setAmount(''); setDescription(''); setNotes('')
      await refresh()
      setNotice('Manual ' + direction + ' saved to your Velnu workbook.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this entry.')
    } finally { setBusy(false) }
  }

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
        + (result.limited ? ' Some categories reached the 100-record limit; this is not a complete accounting report.' : ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QuickBooks sync failed.')
    } finally { setBusy(false) }
  }

  async function disconnect() {
    if (!canManageQuickBooks || busy) return
    if (!window.confirm('Disconnect QuickBooks and permanently remove its imported transactions from Velnu? Your records inside QuickBooks will not change.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await disconnectQuickBooks(business.id)
      setQbRows([])
      setCostsAcknowledged(false)
      await refresh()
      setNotice('QuickBooks disconnected. Imported transactions were removed from Velnu, not from QuickBooks.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect QuickBooks.')
    } finally { setBusy(false) }
  }

  if (!canSee) return <div className="page-stack">
    <div className="page-heading"><p className="eyebrow">Bookkeeping</p><h1>Company financial workbook.</h1></div>
    <p className="form-message">The Bookkeeping workbook is available to business owners, administrators, and office staff. Ask your business owner to update your access role.</p>
  </div>

  return <div className="page-stack bookkeeping-page">
    <div className="page-heading split-heading">
      <div><p className="eyebrow">Bookkeeping · Money in and out</p><h1>Know what you earned. Know what you spent.</h1>
        <p className="quiet">Payments on Velnu invoices appear automatically. Add other expenses or income manually, or optionally connect QuickBooks Online.</p></div>
      <button className="primary-button compact" onClick={() => { retryId.current = null; setNewEntry(true); setSource('velnu') }}>+ Add expense or income</button>
    </div>
    <section className="bookkeeping-tabs" role="group" aria-label="Workbook source">
      <button type="button" className={source === 'velnu' ? 'active' : ''} aria-pressed={source === 'velnu'} onClick={() => setSource('velnu')}>Velnu workbook</button>
      <button type="button" className={source === 'quickbooks' ? 'active' : ''} aria-pressed={source === 'quickbooks'} onClick={() => setSource('quickbooks')}>QuickBooks Online</button>
    </section>
    <div className="bookkeeping-toolbar">
      <label>Period <select value={range} onChange={e => setRange(e.target.value as RangeChoice)}>
        <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All available entries</option>
      </select></label>
      <button type="button" className="secondary-button compact" disabled={!visible.length} onClick={() => exportCsv(visible, source)}>Download CSV</button>
    </div>

    {source === 'quickbooks' && <section className="bookkeeping-connect">
      <div className="bookkeeping-connect-head"><span className="bookkeeping-connect-icon">QB</span><div>
        <h2>QuickBooks Online <span className="bookkeeping-readonly">Read-only</span></h2>
        <p>Optional connection · Existing Intuit subscription required</p></div></div>
      {new URLSearchParams(window.location.search).get('quickbooks') === 'connected' && <p role="status" className="form-message">QuickBooks authorization finished. Choose Sync transactions to import your recent records.</p>}
      {new URLSearchParams(window.location.search).get('quickbooks') === 'error' && <p role="alert" className="form-message error-text">QuickBooks connection did not finish. Check your Intuit account or ask the Velnu administrator to review setup.</p>}
      {new URLSearchParams(window.location.search).get('quickbooks') === 'cancelled' && <p role="status" className="form-message">QuickBooks connection was canceled. Nothing was imported.</p>}
      <p className="bookkeeping-explainer">QuickBooks income and purchases are shown in a <strong>separate workbook</strong>, rather than mixed with Velnu payments. This avoids counting the same customer payment twice. Imported records are not editable here.</p>
      {canManageQuickBooks ? <>
        {qbStatus?.connected ? <div className="bookkeeping-connect-actions">
          <div><strong>Connected {qbStatus.environment === 'sandbox' ? 'to a sandbox company' : 'to a QuickBooks company'}</strong><small>Company ID: {qbStatus.company_id} · Last sync: {qbStatus.last_sync_at ? new Date(qbStatus.last_sync_at).toLocaleString() : 'Not yet synced'}</small></div>
          <button className="primary-button compact" disabled={busy} onClick={synchronize}>{busy ? 'Working…' : 'Sync transactions'}</button>
          <button className="secondary-button compact" disabled={busy} onClick={disconnect}>Disconnect</button>
        </div> : <>
          {!qbStatus?.configured ? <p className="form-message">The QuickBooks integration is prepared but cannot connect yet. Velnu's administrator must configure Intuit developer credentials and the secure OAuth callback.</p> :
            <p className="form-message">This preview currently uses <strong>{qbStatus.environment === 'sandbox' ? 'Intuit sandbox testing' : 'the live Intuit production service'}</strong>. Only connect a test account unless the integration has been approved for production.</p>}
          <label className="bookkeeping-consent"><input type="checkbox" checked={costsAcknowledged} onChange={e => setCostsAcknowledged(e.target.checked)} />
            <span>I understand QuickBooks Online requires an eligible Intuit subscription. Separate fees may apply for the selected Intuit plan, payments, add-ons, third-party services or integrations. Charges and eligibility are determined by Intuit and the relevant providers, not included automatically in Velnu. I authorize a read-only import of selected QuickBooks transactions.</span></label>
          <button className="primary-button compact" disabled={busy || !qbStatus?.configured || !!qbStatus.connected || !costsAcknowledged} onClick={connect}>Connect QuickBooks Online</button>
        </>}
      </> : <p className="form-message">Only a business owner or administrator may connect, sync or disconnect QuickBooks.</p>}
      <p className="bookkeeping-small">Current import covers up to 100 records each for QuickBooks Payments, Sales Receipts, and Purchases from approximately the past 90 days. It does not include bills, payroll, refunds, bank reconciliation, or a complete profit-and-loss statement. No transactions are written back to QuickBooks. <a href="https://quickbooks.intuit.com/pricing/" target="_blank" rel="noopener noreferrer">Review Intuit plans and fees</a>.</p>
    </section>}

    <section className="bookkeeping-overview" aria-label="Summary in US dollars">
      <article><small>Received income · USD</small><strong>{usd.format(totals.income)}</strong><span>{source === 'velnu' ? 'Recorded customer payments + manual income' : 'Imported QBO payments and sales receipts'}</span></article>
      <article><small>Recorded expenses · USD</small><strong>{usd.format(totals.expenses)}</strong><span>{source === 'velnu' ? 'Manually entered expenses' : 'Imported QBO purchases'}</span></article>
      <article><small>Difference · USD</small><strong>{usd.format(totals.income - totals.expenses)}</strong><span>Not an accounting profit-and-loss or tax report</span></article>
    </section>
    {source === 'velnu' && <p className="bookkeeping-caution">Income from Velnu invoices is included <strong>only when a payment is recorded</strong>, not when an invoice is issued. Do not add a second manual income entry for the same payment. Recording income here does not process a payment.</p>}
    {source === 'quickbooks' && <p className="bookkeeping-caution">QuickBooks figures are independent from Velnu figures. Do not add the two summaries together. Non-USD amounts are shown below but excluded from USD totals. These are selected transaction types, not a complete accounting report.</p>}
    {notice && <p className="form-message success-text" role="status">{notice}</p>}
    {error && <p className="form-message error-text" role="alert">{error}</p>}
    <section className="bookkeeping-list">
      <div className="bookkeeping-list-title"><h2>{source === 'velnu' ? 'Velnu income & expenses' : 'Imported QuickBooks transactions'}</h2><span>{visible.length} records</span></div>
      {loading ? <div className="empty-state">Loading your workbook…</div> : !visible.length ?
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
    {newEntry && <div className="modal-backdrop" onMouseDown={() => { if (!busy) setNewEntry(false) }}>
      <section className="modal bookkeeping-modal" role="dialog" aria-modal="true" aria-label="Add workbook entry" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">Manual bookkeeping</p><h2>Add income or expense</h2></div>
          <button type="button" className="icon-button" disabled={busy} onClick={() => setNewEntry(false)} aria-label="Close form">×</button></div>
        <p className="quiet">Use manual income only for money that isn't already recorded against a Velnu invoice.</p>
        <form className="bookkeeping-entry-form" onSubmit={saveManual}>
          <label>Entry type <select value={direction} onChange={e => { setDirection(e.target.value as EntryDirection); setCategory(e.target.value === 'income' ? 'Other received income' : 'Materials & supplies') }}>
            <option value="expense">Expense / money spent</option><option value="income">Other income / money received</option></select></label>
          <label>Transaction date <input aria-label="Transaction date" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} required /></label>
          <label>Amount in USD ($) <input aria-label="Amount in USD" type="number" min="0.01" max="100000000" step=".01" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
          <label>Category <select value={category} onChange={e => setCategory(e.target.value)}>
            {(direction === 'expense' ? ['Materials & supplies','Equipment & tools','Fuel & travel','Contractor payments','Software & subscriptions','Office expenses','Insurance','Other expense']
              : ['Other received income','Cash sale (not invoiced)','Additional service income','Miscellaneous income']).map(x => <option key={x}>{x}</option>)}
          </select></label>
          <label className="full">Description <input aria-label="Description" value={description} maxLength={400} onChange={e => setDescription(e.target.value)} placeholder="What was paid for?" required /></label>
          <label className="full">Notes (optional) <textarea aria-label="Notes" value={notes} maxLength={2000} rows={2} onChange={e => setNotes(e.target.value)} placeholder="Receipt or reference notes" /></label>
          <p className="bookkeeping-small full">This creates a bookkeeping record only. It does not withdraw, deposit, charge, or transfer funds.</p>
          <div className="bookkeeping-entry-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={() => setNewEntry(false)}>Cancel</button>
            <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</button></div>
        </form>
      </section>
    </div>}
  </div>
}
