import { monthlyPlans, type VelnuTier } from '../lib/pricing'
import UpgradeLink, { type UpgradeTier } from './UpgradeLink'
import './settings/tiers.css'

export { planUpgradeHref } from './UpgradeLink'

export default function PlanRestriction({ plan, required, feature, canUpgrade, limit = false }: {
  plan: VelnuTier
  required: UpgradeTier
  feature: string
  canUpgrade: boolean
  limit?: boolean
}) {
  return <div className="plan-restriction">
    <p>{limit ? `You’ve reached the ${monthlyPlans[plan].name} plan limit for ${feature}.` :
      `${feature} is unavailable on the ${monthlyPlans[plan].name} plan.`}</p>
    <p><UpgradeLink plan={plan} required={required} canUpgrade={canUpgrade} /></p>
  </div>
}
