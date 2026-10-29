import type { BusinessProfile } from '../lib/business'

type PublicBrand = Pick<BusinessProfile, 'name'> & Partial<Omit<BusinessProfile, 'name'>>
import { businessLogoUrl } from '../lib/business'

export default function DocumentBrand({ business, kind }: {
  business: PublicBrand
  kind: 'Invoice' | 'Estimate' | 'Preview'
}) {
  const logo = business.logo_path ? businessLogoUrl({ logo_path: business.logo_path }) : null
  const address = [
    business.address_line1, business.address_line2,
    [business.city, business.state, business.postal_code].filter(Boolean).join(' '),
  ].filter(Boolean)
  return <header className="company-letterhead" style={{ borderTopColor: business.document_accent || '#2563eb' }}>
    <div className="letterhead-identity">
      {logo && <img className="letterhead-logo" src={logo} alt={business.name + ' logo'} />}
      <div>
        <strong className="letterhead-company">{business.name}</strong>
        {business.legal_name && business.legal_name !== business.name && <span>{business.legal_name}</span>}
        {address.map((line, i) => <span key={i}>{line}</span>)}
        {business.phone && <span>{business.phone}</span>}
        {business.email && <span>{business.email}</span>}
        {business.website && <span>{business.website}</span>}
      </div>
    </div>
    <div className="letterhead-document-label">{kind === 'Preview' ? 'Your document' : kind}</div>
  </header>
}
