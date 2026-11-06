import { monthlyPlans, type VelnuTier } from '../lib/pricing'
import { settingsHref } from '../lib/settingsNavigation'
import './settings/tiers.css'

type UpgradeTier = Exclude<VelnuTier, 'free'>

export function planUpgradeHref(tier: UpgradeTier) {
  return settingsHref('plans') + '&tier=' + tier
}

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
    {canUpgrade
      ? <a href={planUpgradeHref(required)}>View {monthlyPlans[required].name} upgrade</a>
      : <p>Ask your workspace owner about {monthlyPlans[required].name}.</p>}
  </div>
}
