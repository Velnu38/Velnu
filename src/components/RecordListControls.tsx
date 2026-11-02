import { useState } from 'react'

/** Bound DOM size while allowing search across the complete loaded list. */
export function useRecordList<T>(rows: T[], describe: (row: T) => string) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const filtered = search.trim() ? rows.filter(row => describe(row).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : rows
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages - 1)
  return { visible: filtered.slice(current * 25, (current + 1) * 25), search, setSearch: (value: string) => { setSearch(value); setPage(0) }, page: current, setPage, pages, total: filtered.length }
}

export default function RecordListControls({ label, list }: { label: string; list: ReturnType<typeof useRecordList> }) {
  return <div className="record-list-controls">
    <label>Search {label}<input type="search" value={list.search} onChange={e => list.setSearch(e.target.value)} placeholder="Customer, number, date, or status" /></label>
    <nav aria-label={`${label} pages`}><span aria-live="polite">{list.total} records · Page {list.page + 1} of {list.pages}</span><button type="button" className="secondary-button compact" disabled={list.page === 0} onClick={() => list.setPage(list.page - 1)}>Previous</button><button type="button" className="secondary-button compact" disabled={list.page + 1 >= list.pages} onClick={() => list.setPage(list.page + 1)}>Next</button></nav>
    {list.total === 0 && list.search && <p>No records match your search.</p>}
  </div>
}
