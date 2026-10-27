/** Proposed public pricing for Velnu. Not proof of an active paid entitlement.
 * Stripe checkout, verified webhooks, quota enforcement, and receipt delivery
 * are required before granting any paid allowances or paid add-on credits.
 */
export type VelnuTier = 'free' | 'basic' | 'pro'
export type AddOnId = 'ai_100' | 'ai_500' | 'storage_1gb' | 'storage_5gb'

export type TierAllowance = {
  tier: VelnuTier
  name: string
  priceMonthlyUsd: number
  documentsPerMonth: number
  customerLimit: number
  aiCreditsPerMonth: number
  fileStorageMb: number
  onlineApprovalsPerMonth: number
  hostedLogo: boolean
  status: string
  features: string[]
}

export const monthlyPlans: Record<VelnuTier, TierAllowance> = {
  free: {
    tier: 'free', name: 'Free', priceMonthlyUsd: 0,
    documentsPerMonth: 10, customerLimit: 250, aiCreditsPerMonth: 0,
    fileStorageMb: 0, onlineApprovalsPerMonth: 0, hostedLogo: false,
    status: 'Manual tools · No metered AI',
    features: [
      '10 invoices and estimates combined each month',
      'Up to 250 customers',
      'Company contact details and text branding',
      'Printable invoices and estimates',
      '0 AI credits, online approvals, SMS, or automated email',
    ],
  },
  basic: {
    tier: 'basic', name: 'Basic', priceMonthlyUsd: 9.99,
    documentsPerMonth: 250, customerLimit: 1000, aiCreditsPerMonth: 200,
    fileStorageMb: 500, onlineApprovalsPerMonth: 0, hostedLogo: true,
    status: 'Planned · AI-assisted essentials',
    features: [
      '250 business documents monthly',
      'Up to 1,000 customers',
      '200 AI credits each month',
      'Voice-to-invoice and voice-to-estimate drafts (in testing)',
      'Business-aware AI assistant (in testing)',
      'Custom logo and up to 500 MB file storage',
      'No online estimate acceptances',
    ],
  },
  pro: {
    tier: 'pro', name: 'Pro', priceMonthlyUsd: 24.99,
    documentsPerMonth: 1000, customerLimit: 5000, aiCreditsPerMonth: 1000,
    fileStorageMb: 5120, onlineApprovalsPerMonth: 50, hostedLogo: true,
    status: 'Planned · Expanded AI and client tools',
    features: [
      '1,000 business documents monthly',
      'Up to 5,000 customers',
      '1,000 AI credits each month',
      'Expanded voice and AI assistance (in testing)',
      'Company logo and up to 5 GB file storage',
      '50 online estimate acceptances monthly (not live yet)',
      'Customer email, reminders and team tools (planned)',
    ],
  },
}

export type TopUp = {
  id: AddOnId
  title: string
  quantityLabel: string
  priceUsd: number
  billing: 'one-time' | 'monthly'
  description: string
}

export const addOnCatalog: TopUp[] = [
  {
    id: 'ai_100', title: 'AI Credit Pack', quantityLabel: '+100 AI credits',
    priceUsd: 4.99, billing: 'one-time',
    description: 'For additional AI instructions or speech-to-text processing.',
  },
  {
    id: 'ai_500', title: 'AI Credit Bundle', quantityLabel: '+500 AI credits',
    priceUsd: 17.99, billing: 'one-time',
    description: 'Larger prepaid allowance when you need more AI assistance.',
  },
  {
    id: 'storage_1gb', title: 'Extra Storage', quantityLabel: '+1 GB',
    priceUsd: 1.99, billing: 'monthly',
    description: 'For additional business files when supported uploads launch.',
  },
  {
    id: 'storage_5gb', title: 'Storage Bundle', quantityLabel: '+5 GB',
    priceUsd: 4.99, billing: 'monthly',
    description: 'More room for supported business documents and attachments.',
  },
]

export const formatMoney = (amount: number) => '$' + amount.toFixed(2)
export const formatMonthlyPrice = (tier: VelnuTier) =>
  tier === 'free' ? 'Free' : formatMoney(monthlyPlans[tier].priceMonthlyUsd)
export const formatStorage = (mb: number) =>
  mb === 0 ? 'No hosted file storage' : mb >= 1024 ? (mb / 1024).toLocaleString() + ' GB' : mb + ' MB'

/** Velnu credits are NOT raw OpenAI model tokens. Proposed accounting:
 * 1 AI text interpretation = 1 credit
 * Up to 60 seconds of recorded speech = 2 credits, rounded up per started minute.
 * These rules are not enabled until the billing ledger and server quotas are validated.
 */
export const creditRules = {
  aiCommandCredits: 1,
  voiceCreditsPerStartedMinute: 2,
  maxVoiceMinutesPerRecording: 2,
} as const
