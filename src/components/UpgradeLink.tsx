import type { MouseEventHandler, ReactNode } from 'react'
import { monthlyPlans, type VelnuTier } from '../lib/pricing'
import { settingsHref } from '../lib/settingsNavigation'
import './upgrade-link.css'

export type UpgradeTier = Exclude<VelnuTier, 'free'>
const tierRank: Record<VelnuTier, number> = { free: 0, basic: 1, pro: 2 }

export function planUpgradeHref(tier: UpgradeTier) {
  return settingsHref('plans') + '&tier=' + tier
}

/** Identify billing navigation without changing ordinary workspace actions. */
export function isPlanNavigationHref(href: string | null | undefined): boolean {
  if (!href) return false
  try {
    const url = new URL(href, 'https://finviant.com')
    return url.pathname === '/plans' ||
      (url.searchParams.get('view') === 'settings' && ['plans', 'subscription'].includes(url.searchParams.get('section') || '')) ||
      ['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)
  } catch { return false }
}

export function PlanNavigationLink({ href, children, onClick, target }: {
  href: string
  children: ReactNode
  onClick?: MouseEventHandler<HTMLAnchorElement>
  target?: '_blank' | '_self'
}) {
  return <a className="plan-navigation-link" href={href} onClick={onClick} target={target}
    rel={target === '_blank' ? 'noopener noreferrer' : undefined}>{children}</a>
}

/** Plan recommendations navigate; selecting a tier or confirming payment is a separate action. */
export default function UpgradeLink({ plan, required, canUpgrade, children }: {
  plan: VelnuTier
  required: UpgradeTier
  canUpgrade: boolean
  children?: ReactNode
}) {
  if (!(tierRank[required] > tierRank[plan])) return null
  return canUpgrade
    ? <PlanNavigationLink href={planUpgradeHref(required)}>{children || `View ${monthlyPlans[required].name} upgrade`}</PlanNavigationLink>
    : <span className="plan-owner-notice">Ask your workspace owner about {monthlyPlans[required].name}.</span>
}
