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
 free: {tier:'free',name:'Free',priceMonthlyUsd:0,documentsPerMonth:Infinity,customerLimit:10,aiCreditsPerMonth:20,fileStorageMb:100,onlineApprovalsPerMonth:Infinity,hostedLogo:false,status:'Try the complete workflow',features:['10 active customers · 5 new job bookings/month','Invoices, estimates, approval and payment links','Send through your own email and text apps','20 introductory Fin requests · 10 voice minutes once','100 MB attachments · 30-day financial view · 1 user']},
 basic: {tier:'basic',name:'Individual',priceMonthlyUsd:19.95,documentsPerMonth:Infinity,customerLimit:Infinity,aiCreditsPerMonth:150,fileStorageMb:2000,onlineApprovalsPerMonth:Infinity,hostedLogo:true,status:'For a busy solo business',features:['No customer, document or job count cap','Send through your own email and text apps','150 Fin requests · 60 voice minutes/month','2 GB attachments · Custom logo · Full financial history','1 user · Manual customer follow-ups']},
 pro: {tier:'pro',name:'Business Pro',priceMonthlyUsd:39.95,documentsPerMonth:Infinity,customerLimit:Infinity,aiCreditsPerMonth:600,fileStorageMb:10000,onlineApprovalsPerMonth:Infinity,hostedLogo:true,status:'Let Finviant send and follow up',features:['Everything in Individual · 5 users including owner','Finviant email and SMS after sender activation','2,000 email recipients · 200 US SMS segments/month','600 Fin requests · 180 voice minutes/month shared','10 GB attachments · Scheduled sending and reminders','Crew scheduling and customer booking links']},
}
export const businessAnnualPrice = 399.50
export const tierComparison = [
 ['Monthly price','$0','$19.95','$39.95'],
 ['Annual price','—','—','$399.50 upfront ($33.29/month equivalent)'],
 ['Users','1','1','5 including owner'],
 ['Active customers','10','No count cap','No count cap'],
 ['New job bookings','5/month','No count cap','No count cap'],
 ['Invoices, estimates, change orders','Included','Included','Included'],
 ['Approval, deposit/final invoice, Mark Paid','Included','Included','Included'],
 ['PDF/print, shared links, payment links','Included','Included','Included'],
 ['Customer email and text','Your apps','Your apps','Finviant after activation; your apps available'],
 ['Automatic overdue invoice emails','—','—','Owner-enabled rules after activation'],
 ['Managed email recipient deliveries','—','—','2,000/month shared'],
 ['Managed US SMS segments','—','—','200/month shared'],
 ['Fin requests','20 once','150/month','600/month shared'],
 ['Voice transcription','10 minutes once','60 minutes/month','180 minutes/month shared'],
 ['Attachment storage','100 MB','2 GB','10 GB shared'],
 ['Picture size','10 MB','10 MB','10 MB'],
 ['Uploaded company logo','—','2 MB','2 MB'],
 ['Calendar, jobs, internal reminders','Included','Included','Included'],
 ['Manual scheduling and rescheduling','1 user · 5 new bookings/month','1 user · Unlimited','Up to 5 users · Unlimited'],
 ['Crew assignment, team availability and dispatch','—','—','Included'],
 ['Customer self-booking from approved estimates','—','—','Private booking links; email after sender activation'],
 ['Automatic customer appointment reminders','—','—','Owner-enabled email after sender activation'],
 ['Financial Performance','Last 30 days','Full history','Full history'],
 ['Manual income/expenses, record export','Included','Included','Included'],
 ['Receipt scanning','—','50/month','200/month shared'],
 ['Google review requests','—','Your email or text app','Your email or text app'],
 ['Team roles and invitations','—','—','Included'],
 ['Recurring invoice drafts','—','Included; review before sending','Included; review before sending'],
 ['QuickBooks read-only import','—','After provider setup','After provider setup'],
 ['External calendar connections','—','After provider setup','After provider setup'],
] as const

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
  mb === 0 ? 'No hosted file storage' : mb >= 1000 ? (mb / 1000).toLocaleString() + ' GB' : mb + ' MB'

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


/** Planned OPTIONAL assistive modules. The core Schedule and Bookkeeping
 * workbook remain accessible without these purchases. No actual paid
 * entitlements, AI task quotas or autopilot functions are enabled in beta.
 */
export type AssistantAddOnId = 'scheduling_assistant' | 'bookkeeping_assistant'
export type PaidAssistantTier = 'basic' | 'pro'
export type AssistantAddOn = {
  id: AssistantAddOnId
  name: string
  summary: string
  functions: string[]
  priceMonthlyByTier: Record<PaidAssistantTier, number>
  status: 'Planned — not active'
}
export const assistantAddOns: AssistantAddOn[] = [
  {
    id: 'scheduling_assistant',
    name: 'Scheduling Assistant',
    summary: 'Help suggest available appointment slots, flag potential conflicts, and prepare follow-up reminders for owner review.',
    functions: ['Suggested appointment times', 'Possible scheduling conflicts', 'Draft reminders for review'],
    priceMonthlyByTier: { basic: 9.99, pro: 7.99 },
    status: 'Planned — not active',
  },
  {
    id: 'bookkeeping_assistant',
    name: 'Bookkeeping Assistant',
    summary: 'Help organize expenses, propose categories and summarize recorded income and spending for owner review.',
    functions: ['Suggested expense categories', 'Income and expense summaries', 'Potential missing or duplicate entries'],
    priceMonthlyByTier: { basic: 14.99, pro: 11.99 },
    status: 'Planned — not active',
  },
]
export function assistantPriceForTier(addOnId: AssistantAddOnId, tier: VelnuTier): number | null {
  if (tier !== 'basic' && tier !== 'pro') return null
  return assistantAddOns.find(a => a.id === addOnId)?.priceMonthlyByTier[tier] ?? null
}
export function assistantMonthlyTotal(tier: VelnuTier, choices: readonly string[]): number {
  if (!['free', 'basic', 'pro'].includes(tier) || !Array.isArray(choices) || choices.some(value => typeof value !== 'string')) throw new Error('Choose a valid plan and service selection')
  if (tier === 'free') return 0
  const ids = new Set(choices)
  return assistantAddOns.reduce((sum, item) =>
    sum + (ids.has(item.id) ? item.priceMonthlyByTier[tier] : 0), 0)
}
