import type { CurrentBusiness } from '../lib/business'
import PrivateBetaNotice from '../components/PrivateBetaNotice'

export default function WorkspaceServicesPage({ business }: { business: CurrentBusiness }) {
  return <div className="page-stack">
    <div className="page-heading">
      <p className="eyebrow">Finviant Office · Private testing</p>
      <h1>Test workspace information</h1>
      <p className="quiet">{business.name} is currently in a private test environment.</p>
    </div>
    <PrivateBetaNotice />
  </div>
}
