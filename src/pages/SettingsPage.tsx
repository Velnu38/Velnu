import type { CurrentBusiness } from '../lib/business'
import { canWrite } from '../lib/business'
import BusinessProfileEditor from '../components/BusinessProfileEditor'
import DocumentBrand from '../components/DocumentBrand'
import PrivateBetaNotice from '../components/PrivateBetaNotice'

export default function SettingsPage({ business, onSaved }: {
  business: CurrentBusiness
  onSaved: (next: CurrentBusiness) => void
}) {
  return <div className="page-stack">
    <div className="page-heading">
      <p className="eyebrow">Settings · Your company</p>
      <h1>Make Finviant Office yours.</h1>
      <p className="quiet">Your company identity, invoice branding, and optional business context are saved with your workspace.</p>
    </div>
    {canWrite(business.role) && ['owner','admin'].includes(business.role) ?
      <BusinessProfileEditor key={business.id} business={business} onSaved={onSaved} /> :
      <p className="form-message">Only the business owner or administrator can edit company settings.</p>}
    <PrivateBetaNotice compact />
    <section className="settings-document-preview">
      <p className="eyebrow">Current invoice / estimate letterhead</p>
      <DocumentBrand business={business} kind="Preview" />
      <p className="quiet">This is your current branding. Newly issued invoices and estimates preserve these company details even if you update the profile later. Documents issued before this protection was added may still show current company information. Logos are public images, not private attachments.</p>
    </section>
  </div>
}
