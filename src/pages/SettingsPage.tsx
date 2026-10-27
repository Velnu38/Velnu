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
      <p className="eyebrow">Your service tier</p>
      <p className="quiet">Free (10 invoices/estimates combined monthly), proposed Basic ($9.99/month), or proposed Pro ($24.99/month). Paid tiers, AI credit packs and storage top-ups are not activated by selecting them.</p>
      <a className="secondary-button" href="/plans">Review or change service tier</a>
      <p className="quiet"><a href="/legal" target="_blank" rel="noopener noreferrer">Read the complete user agreement, AI disclosure and privacy notice</a></p>
    </section>
    <section className="settings-document-preview">
      <p className="eyebrow">Current invoice / estimate letterhead</p>
      <DocumentBrand business={business} kind="Preview" />
      <p className="quiet">This is your current branding. Newly issued invoices and estimates preserve these company details even if you update the profile later. Documents issued before this protection was added may still show current company information. Logos are public images, not private attachments.</p>
    </section>
  </div>
}
