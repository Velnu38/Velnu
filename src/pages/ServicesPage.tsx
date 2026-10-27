import { useState } from 'react'
import ServicePicker from '../components/ServicePicker'
import { getPendingServiceInterests, setPendingServiceInterests } from '../lib/serviceCatalog'
export default function ServicesPage() {
  const [selected, setSelected] = useState(getPendingServiceInterests)
  function change(value: typeof selected) { setSelected(value); setPendingServiceInterests(value) }
  function saveAndContinue() { setPendingServiceInterests(selected); window.location.assign('/auth?mode=signup') }
  return <main className="services-public-page">
    <header className="services-public-nav">
      <a href="/" className="marketing-brand"><span className="marketing-logo">V</span><strong>velnu<span className="brand-dot">.</span></strong></a>
      <nav><a href="/">Home</a><a href="/install">Use the app</a><a href="/auth?mode=signin">Sign in</a></nav>
    </header>
    <div className="services-public-body">
      <p className="marketing-section-kicker">MAKE VELNU WORK FOR YOU</p>
      <h1>Choose what you need. <em>Leave out what you don't.</em></h1>
      <p className="services-public-lead">Velnu's core business app works right in your browser. Explore optional tools à la carte, or express interest in a future Basic or Pro plan.</p>
      <p className="services-beta-notice">Free provides no online customer acceptances, hosted logos, cloud AI, metered email, or SMS. During the private beta, selections are non-billable feature interests, not subscriptions. Unfinished features will remain unavailable until they are tested and launched.</p>
      <ServicePicker value={selected} onChange={change}/>
      <div className="service-public-actions">
        <button type="button" className="marketing-btn marketing-btn-accent" onClick={saveAndContinue}>Continue to account setup <span>↗</span></button>
        <a href="/auth?mode=signin" className="service-existing-login" onClick={()=>setPendingServiceInterests(selected)}>Already have an account? Sign in and save choices</a>
      </div>
      <p className="services-public-fine">Your choices are temporarily remembered in this browser. After signing in, confirm them in My services to save them to your business account. No payment information is requested.</p>
    </div>
  </main>
}
