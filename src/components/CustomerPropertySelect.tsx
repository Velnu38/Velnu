import { useEffect, useState } from 'react'
import { listCustomerProperties } from '../services/properties'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'

type Property = ServiceAddress & { id: string; label: string | null }

export default function CustomerPropertySelect({ businessId, customerId, value, onChange, disabled = false }: {
  businessId: string
  customerId: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [rows, setRows] = useState<Property[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setRows([])
    setError('')
    onChange('')
    if (!customerId) return () => { active = false }
    setLoading(true)
    void listCustomerProperties(businessId, customerId)
      .then(data => { if (active) setRows((data || []) as Property[]) })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load service locations') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [businessId, customerId])

  return <div className="property-select-group">
    <label>Service location (optional)
      <select aria-label="Service location" value={value} disabled={disabled || loading || !customerId} onChange={event => onChange(event.target.value)}>
        <option value="">{loading ? 'Loading locations…' : 'No location selected'}</option>
        {rows.map(item => <option key={item.id} value={item.id}>{item.label ? item.label + ' · ' : ''}{formatServiceAddress(item)}</option>)}
      </select>
    </label>
    {customerId && rows.length === 0 && !loading && !error && <p className="property-select-help">Add a property address in Customers to show directions on this job and schedule.</p>}
    {error && <p className="form-message error-text" role="alert">{error}</p>}
  </div>
}
