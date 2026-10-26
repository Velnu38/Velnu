import type { CurrentBusiness } from '../lib/business'
import { canWrite } from '../lib/business'
import BusinessProfileEditor from '../components/BusinessProfileEditor'
import DocumentBrand from '../components/DocumentBrand'

export default function SettingsPage({ business, onSaved }: {
  business: CurrentBusiness
  onSaved: (next: CurrentBusiness) => void
}) {
  return <div className="page-stack">
    <div className="page-heading">
      <p className="eyebrow">Settings · Your company</p>
      <h1>Make Velnu yours.</h1>
      <p className="quiet">Your company identity, invoice branding, and optional business context are saved with your workspace.</p>
    </div>
    {canWrite(business.role) && ['owner','admin'].includes(business.role) ?
      <BusinessProfileEditor key={business.id} business={business} onSaved={onSaved} /> :
      <p className="form-message">Only the business owner or administrator can edit company settings.</p>}
    <section className="settings-document-preview">
      <p className="eyebrow">Current invoice / estimate letterhead</p>
      <DocumentBrand business={business} kind="Preview" />
      <p className="quiet">Company details shown above appear on newly viewed invoices and estimates. Logos are public company images, not private attachments.</p>
    </section>
  </div>
}
