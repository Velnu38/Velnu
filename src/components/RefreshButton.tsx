import type { ButtonHTMLAttributes } from 'react'

/** A shared, non-submitting refresh control. Keep each caller's refresh scope. */
export default function RefreshButton({ label = 'Refresh', busy = false, disabled, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & { label?: string; busy?: boolean }) {
  return <button {...props} type="button" className={`secondary-button compact refresh-button ${className}`.trim()} disabled={disabled || busy} aria-busy={busy || undefined}>
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17"/></svg>
    <span>{busy ? 'Refreshing…' : label}</span>
  </button>
}
