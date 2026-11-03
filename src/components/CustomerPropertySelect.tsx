import { useEffect, useRef, useState } from 'react'
import { createProperty,listCustomerProperties } from '../services/properties'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'

type Property = ServiceAddress & { id: string; label: string | null }

export default function CustomerPropertySelect({ businessId, customerId, value, onChange, disabled = false }: {
  businessId: string
  customerId: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [adding,setAdding]=useState(false),[saving,setSaving]=useState(false),[address,setAddress]=useState(''),[city,setCity]=useState(''),[state,setState]=useState(''),[zip,setZip]=useState('')
  const pending=useRef<{signature:string;id:string}|null>(null),inFlight=useRef(false)
  const [rows, setRows] = useState<Property[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setRows([])
    setError('')
    onChange('');setAdding(false);setAddress('');setCity('');setState('');setZip('');pending.current=null
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
    {customerId&&<details open={adding} onToggle={e=>setAdding(e.currentTarget.open)}><summary>Add a service location here</summary><fieldset disabled={disabled||saving} className="form-grid"><label className="full">Street address<input value={address} maxLength={200} onChange={e=>setAddress(e.target.value)}/></label><label>City<input value={city} maxLength={100} onChange={e=>setCity(e.target.value)}/></label><label>State<input value={state} maxLength={50} onChange={e=>setState(e.target.value)}/></label><label>ZIP<input value={zip} maxLength={20} onChange={e=>setZip(e.target.value)}/></label><button type="button" className="secondary-button" disabled={!address.trim()||saving} onClick={async()=>{if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const input={customer_id:customerId,address_line1:address,city,state,postal_code:zip},signature=JSON.stringify(input);if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};const saved=await createProperty(businessId,input,pending.current.id);setRows(v=>[...v.filter(r=>r.id!==saved.id),saved]);onChange(saved.id);setAdding(false);setAddress('');pending.current=null}catch(e){setError(e instanceof Error?e.message:'Unable to add location. Your address is still here.')}finally{inFlight.current=false;setSaving(false)}}}>{saving?'Saving location…':'Save & use location'}</button></fieldset></details>}
    {customerId && rows.length === 0 && !loading && !error && <p className="property-select-help">Use Add a service location here to save an address without leaving this form.</p>}
    {error && <p className="form-message error-text" role="alert">{error}</p>}
  </div>
}
