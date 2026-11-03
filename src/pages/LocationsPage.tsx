import RecordListControls,{useRecordList} from '../components/RecordListControls'
import WorkspaceBack from '../components/WorkspaceBack'
import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import GoogleMapTools from '../components/GoogleMapTools'
import { listBusinessProperties } from '../services/properties'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Property = ServiceAddress & { id: string; customer_id: string; label: string | null; customers: Customer[] | null }

function displayCustomer(customer?: Customer) {
  return customer ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer') : 'Customer'
}

export default function LocationsPage({ business, onCustomers }: {
  business: CurrentBusiness
  onCustomers: () => void
}) {
  const [locations, setLocations] = useState<Property[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    setLoading(true)
    void listBusinessProperties(business.id)
      .then(rows => {
        if (!active) return
        const values = rows as Property[]
        setLocations(values)
        setSelectedId(prior => values.some(x => x.id === prior) ? prior : values[0]?.id || '')
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load service locations.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id])

  const records=useRecordList(locations,loc=>[loc.label,formatServiceAddress(loc),displayCustomer(loc.customers?.[0])].join(' '))
  const selected = locations.find(item => item.id === selectedId) || locations[0]

  return <div className="page-stack"><WorkspaceBack />
    <div className="page-heading split-heading"><div><p className="eyebrow">Service locations · Google Maps</p><h1>Know where each job takes you.</h1><p className="quiet">Property addresses from customer records, ready for maps and driving directions.</p></div><a className="secondary-button compact" href={selected?'/?view=customers&document='+encodeURIComponent(selected.customer_id):'/?view=customers'}>Manage properties</a></div>
    {error && <p role="alert" className="form-message error-text">{error}</p>}
    {loading ? <p className="quiet">Loading service locations…</p> : locations.length === 0 ?
      <section className="detail-card locations-empty">
        <h2>No service locations yet</h2>
        <p>Add an address under a customer’s Properties section. Then you can assign it to jobs and open it in Google Maps.</p>
        <button className="primary-button" onClick={onCustomers}>Go to customers</button>
      </section> :
      <div className="locations-layout">
        <section className="locations-list detail-card" aria-label="Service location list">
          <RecordListControls label="service locations" list={records}/>
          {records.total === 0 ? <p className="quiet">No matching locations.</p> : records.visible.map(location => <button className={'locations-choice' + (selected?.id === location.id ? ' selected' : '')} key={location.id} onClick={() => setSelectedId(location.id)}>
            <span className="locations-marker" aria-hidden="true">⌖</span>
            <span><strong>{location.label || displayCustomer(location.customers?.[0])}</strong><small>{formatServiceAddress(location)}</small><small>{displayCustomer(location.customers?.[0])}</small></span>
          </button>)}
        </section>
        <section className="detail-card locations-preview" aria-label="Selected service location">
          {selected ? <>
            <p className="eyebrow">Selected address</p><h2>{selected.label || displayCustomer(selected.customers?.[0])}</h2>
            <p className="locations-full-address">{formatServiceAddress(selected)}</p>
            <GoogleMapTools key={selected.id} address={selected} preview />
            {!import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY && <p className="property-select-help">Google Maps and directions work now. An embedded map will be available here when the Maps Embed API key is configured.</p>}
            <p className="locations-privacy">Google Maps opens in a separate tab or app. Only the property address is passed to Google, never private access notes.</p>
          </> : <p className="quiet">Select a property to view map options.</p>}
        </section>
      </div>}
  </div>
}
