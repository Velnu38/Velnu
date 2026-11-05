import FinBrand from './FinBrand'
import BusinessProfileEditor from './BusinessProfileEditor'
import type { CurrentBusiness } from '../lib/business'
import PrivateBetaNotice from './PrivateBetaNotice'

export default function BusinessOnboarding({ onCreated }: { onCreated: (business: CurrentBusiness) => void }) {
  return <main className="onboarding-page">
    <div className="onboarding-card profile-onboarding">
      <FinBrand/>
      <p className="eyebrow">Welcome to Finviant Office</p>
      <h1>Set up your business</h1>
      <p>Personalize your invoices and estimates with your company information. You can change these details later in Settings.</p>
      <PrivateBetaNotice compact />
      <BusinessProfileEditor onSaved={onCreated}/>
      <p className="quiet">After setup, choose payment services under Settings → Invoice and Estimate Setup → Customer Payment Methods.</p>
    </div>
  </main>
}
