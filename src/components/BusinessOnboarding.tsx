import { useState } from 'react'
import PaymentSettings from './settings/PaymentSettings'
import BusinessProfileEditor from './BusinessProfileEditor'
import type { CurrentBusiness } from '../lib/business'
import PrivateBetaNotice from './PrivateBetaNotice'

export default function BusinessOnboarding({ onCreated }: { onCreated: (business: CurrentBusiness) => void }) {
  const [created,setCreated]=useState<CurrentBusiness|null>(null)
  const [payments,setPayments]=useState(false)
  return <main className="onboarding-page">
    <div className="onboarding-card profile-onboarding">
      <div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div>
      <p className="eyebrow">Welcome to Finviant Office</p>
      <h1>{payments?'Choose how customers pay':'Set up your business'}</h1>
      <p>Personalize your invoices and estimates with your company information. You can change these details later in Settings.</p>
      <PrivateBetaNotice compact />
      {payments&&created?<><button type="button" className="back-button" onClick={()=>setPayments(false)}>← Back to business details</button><PaymentSettings business={created} onSaved={()=>onCreated(created)} submitLabel="Save & open workspace"/><button type="button" className="text-button" onClick={()=>onCreated(created)}>Skip payment setup for now</button><p className="quiet">You can also set payment options while creating an invoice or estimate.</p></>:<BusinessProfileEditor business={created||undefined} onSaved={business=>{setCreated(business);setPayments(true)}}/>}
    </div>
  </main>
}
