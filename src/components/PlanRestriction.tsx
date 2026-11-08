import { monthlyPlans, type VelnuTier } from '../lib/pricing'
import UpgradeLink, { planAvailabilityLabel, tierRank, type UpgradeTier } from './UpgradeLink'
import './settings/tiers.css'

export { planUpgradeHref } from './UpgradeLink'

export default function PlanRestriction({ plan, required, feature, canUpgrade, benefit, limit = false }: {
  plan: VelnuTier
  required: UpgradeTier
  feature: string
  canUpgrade: boolean
  benefit?: string
  limit?: boolean
}) {
  if (!limit && tierRank[plan] >= tierRank[required]) return null
  return <div className="plan-restriction" data-required-plan={required}>
    <span className="plan-availability-label">{planAvailabilityLabel(required)}</span>
    <p>{limit ? `You’ve reached the ${monthlyPlans[plan].name} plan limit for ${feature}.` :
      `${feature} is unavailable on the ${monthlyPlans[plan].name} plan.`}</p>
    {benefit && <p className="plan-feature-benefit">{benefit}</p>}
    <p><UpgradeLink plan={plan} required={required} canUpgrade={canUpgrade} /></p>
  </div>
}
