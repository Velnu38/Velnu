import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { customerOptionName, matchingCustomers, type CustomerOption } from '../lib/customerSuggestions'
import './customer-picker.css'

export default function CustomerPicker({ customers, value, onChange, required = false, disabled = false, initialQuery = '', onQueryChange, initiallyOpen = false, loading = false, error = '', onRetry }: {
  loading?: boolean
  error?: string
  onRetry?: () => void
  customers: CustomerOption[]
  value: string
  onChange: (id: string) => void
  required?: boolean
  disabled?: boolean
  initialQuery?: string
  initiallyOpen?: boolean
  onQueryChange?: (query: string) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const selected = customers.find(customer => customer.id === value)
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(initiallyOpen)
  const [active, setActive] = useState(-1)
  useEffect(() => { setQuery(initialQuery); setActive(-1) }, [initialQuery])
  const matches = useMemo(() => loading || error ? [] : matchingCustomers(customers, query), [customers, query, loading, error])
  const expanded = open && !selected && !disabled
  useEffect(() => { input.current?.setCustomValidity(required && !selected ? 'Choose a saved customer from the suggestions.' : '') }, [required, selected])
  function select(customer: CustomerOption) {
    onChange(customer.id)
    setOpen(false)
    setActive(-1)
  }
  return <div className="customer-picker full" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>Customer</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? id + '-options' : undefined} aria-activedescendant={expanded && active >= 0 && matches[active] ? id + '-option-' + active : undefined}
      autoComplete="off" maxLength={200} disabled={disabled} required={required} value={selected ? customerOptionName(selected) : query}
      placeholder="Search by name, company, email, or phone"
      onFocus={() => setOpen(true)} onChange={event => { onChange(''); setQuery(event.target.value); onQueryChange?.(event.target.value); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true)
          setActive(index => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0))
        }
        if (event.key === 'Enter' && expanded && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (active >= 0 && matches[active]) select(matches[active])
        }
      }} />
    {selected && <div className="customer-picker-selected"><span>{[selected.company, selected.email, selected.phone].filter(Boolean).join(' · ')}</span>
      <button type="button" className="text-button" disabled={disabled} onClick={() => { onChange(''); setQuery(''); onQueryChange?.(''); setOpen(true); setActive(-1); input.current?.focus() }}>Change customer</button></div>}
      {error && <p role="alert">{error} {onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry customers</button>}</p>}
    {expanded && <div id={id + '-options'} className="customer-picker-options" role="listbox" aria-label="Matching saved customers">
      {matches.map((customer, index) => <button id={id + '-option-' + index} type="button" role="option" data-customer-id={customer.id} aria-selected={active === index} key={customer.id}
        onMouseDown={event => event.preventDefault()} onClick={() => select(customer)}>
        <strong>{customerOptionName(customer)}</strong><span>{[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ') || 'Customer record ' + customer.id.slice(-8)}</span>
      </button>)}
      {loading && <p role="status">Searching customers…</p>}
      {!loading && !error && !matches.length && <p role="status">No saved customer matches. Add a new customer to continue.</p>}
      {matches.length === 8 && <p>Keep typing to narrow the matches.</p>}
    </div>}
  </div>
}
