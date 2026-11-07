import {useState} from 'react'
import DeliverySetup from './settings/DeliverySetup'
import FinBrand from './FinBrand'
import BusinessProfileEditor from './BusinessProfileEditor'
import type { CurrentBusiness } from '../lib/business'
import PrivateBetaNotice from './PrivateBetaNotice'

export default function BusinessOnboarding({ onCreated }: { onCreated: (business: CurrentBusiness) => void }) {
  const [created,setCreated]=useState<CurrentBusiness|null>(null)
  return <main className="onboarding-page">
    <div className="onboarding-card profile-onboarding">
      <FinBrand/>
      <p className="eyebrow">Welcome to Finviant Office</p>
      <h1>Set up your business</h1>
      <p>Personalize your invoices and estimates with your company information. You can change these details later in Settings.</p>
      <PrivateBetaNotice compact />
      {created?<DeliverySetup businessId={created.id} onComplete={()=>onCreated(created)}/>:<BusinessProfileEditor onSaved={setCreated}/>}
      <p className="quiet">After setup, choose payment services under More → Invoice & Estimate Setup → Customer Payment Methods.</p>
    </div>
  </main>
}
