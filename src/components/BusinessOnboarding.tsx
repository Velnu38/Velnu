import BusinessProfileEditor from './BusinessProfileEditor'
import type { CurrentBusiness } from '../lib/business'

export default function BusinessOnboarding({ onCreated }: { onCreated: (business: CurrentBusiness) => void }) {
  return <main className="onboarding-page">
    <div className="onboarding-card profile-onboarding">
      <div className="logo-mark">V</div>
      <p className="eyebrow">Welcome to Velnu</p>
      <h1>Set up your business</h1>
      <p>Personalize your invoices and estimates with your company information. You can change these details later in Settings.</p>
      <BusinessProfileEditor onSaved={onCreated} />
    </div>
  </main>
}
