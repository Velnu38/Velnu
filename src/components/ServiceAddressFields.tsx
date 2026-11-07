export type ServiceAddressDraft = { address_line1: string; address_line2: string; city: string; state: string; postal_code: string }
export const emptyServiceAddress = (): ServiceAddressDraft => ({ address_line1: '', address_line2: '', city: '', state: '', postal_code: '' })

export default function ServiceAddressFields({ value, onChange, required = false }: { value: ServiceAddressDraft; onChange: (value: ServiceAddressDraft) => void; required?: boolean }) {
  return <>
    <label className="full">Street address{!required && ' (optional)'}<input autoComplete="address-line1" maxLength={200} required={required || !![value.address_line2, value.city, value.state, value.postal_code].some(v => v.trim())} value={value.address_line1} onChange={e => onChange({ ...value, address_line1: e.target.value })}/></label>
    <label className="full">Address line 2<input autoComplete="address-line2" maxLength={200} value={value.address_line2} onChange={e => onChange({ ...value, address_line2: e.target.value })}/></label>
    <label>City<input autoComplete="address-level2" maxLength={100} value={value.city} onChange={e => onChange({ ...value, city: e.target.value })}/></label>
    <label>State<input autoComplete="address-level1" maxLength={50} value={value.state} onChange={e => onChange({ ...value, state: e.target.value })}/></label>
    <label>ZIP<input autoComplete="postal-code" maxLength={20} value={value.postal_code} onChange={e => onChange({ ...value, postal_code: e.target.value })}/></label>
  </>
}
