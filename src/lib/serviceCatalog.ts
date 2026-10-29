import { addOnCatalog, formatMoney, assistantAddOns, type AddOnId, type AssistantAddOnId } from './pricing'

export type ServiceId =
  | 'voice_drafts' | 'estimate_approvals' | 'payment_links' | 'automated_reminders'
  | 'bookkeeping' | 'team_tools' | 'sms_messages' | AddOnId | AssistantAddOnId
export type PlanInterest = 'free' | 'basic' | 'pro' | 'a_la_carte'
export type ServiceInterest = { plan: PlanInterest; services: ServiceId[] }

export const serviceCatalog: Array<{
  id: ServiceId; name: string; description: string; stage: string; tag: string
}> = [
  { id: 'voice_drafts', name: 'Voice-to-document assistant (AI Office Assistant)', description: 'Paid AI feature: record speech, draft invoices or estimates, and review before saving. No AI requests on Free.', stage: 'Basic / Pro · Testing', tag: 'AI' },
  { id: 'estimate_approvals', name: 'Online estimate approvals', description: 'Paid Pro option: customers review terms and give recorded acceptance. Free includes 0 acceptances and 0 links.', stage: 'Pro · Testing', tag: 'Customers' },
  { id: 'payment_links', name: 'Payment links', description: 'Offer a secure way for customers to pay an invoice online. Provider integration and fees are not finalized.', stage: 'Planned', tag: 'Payments' },
  { id: 'automated_reminders', name: 'Automated follow-ups', description: 'Paid service: prepare follow-up drafts and deliver reminders, subject to verification and per-plan limits.', stage: 'Paid · Planned', tag: 'Automation' },
  { id: 'bookkeeping', name: 'Manual bookkeeping workbook', description: 'Record income and expenses, export a CSV, and view separate QuickBooks imports when configured. This is the basic workbook, not the optional AI Bookkeeping Assistant.', stage: 'Core workbook · Beta', tag: 'Finances' },
  { id: 'team_tools', name: 'Team collaboration', description: 'Help owners coordinate employees, roles and assignments with appropriate permissions.', stage: 'Planned', tag: 'Team' },
  { id: 'sms_messages', name: 'Customer text messaging', description: 'Paid service: outgoing SMS and replies; usage limits and customer messaging consent required.', stage: 'Paid · Planned', tag: 'Messaging' },
]
export const plans: Array<{ id: PlanInterest; label: string; description: string }> = [
  { id: 'free', label: 'Free', description: 'Manual tools only · 0 AI, customer approvals, and metered services' },
  { id: 'basic', label: 'Basic', description: '$9.99/month proposed · 200 AI credits per month' },
  { id: 'pro', label: 'Pro', description: '$24.99/month proposed · 1,000 AI credits per month' },
  { id: 'a_la_carte', label: 'À la carte', description: 'Choose add-ons individually · No charges during beta' },
]
export const defaultServiceInterest: ServiceInterest = { plan: 'free', services: [] }
const key = 'velnu.beta.service-interests.v1'
export const optionalTopUps = addOnCatalog.map(item => ({ ...item, priceLabel: formatMoney(item.priceUsd) }))
const knownIds = new Set<ServiceId>([...serviceCatalog.map(x => x.id), ...addOnCatalog.map(x => x.id), ...assistantAddOns.map(x => x.id)])
const knownPlans = new Set<PlanInterest>(plans.map(x => x.id))

export function normalizeInterests(value: unknown): ServiceInterest {
  if (!value || typeof value !== 'object') return { ...defaultServiceInterest, services: [] }
  const data = value as { plan?: unknown; services?: unknown }
  const plan = knownPlans.has(data.plan as PlanInterest) ? data.plan as PlanInterest : 'free'
  const services: ServiceId[] = Array.isArray(data.services)
    ? [...new Set(data.services.filter((id): id is ServiceId => typeof id === 'string' && knownIds.has(id as ServiceId)))]
    : []
  // Assistants are available only for Basic/Pro interest, not Free or stand-alone A la carte.
  return { plan, services: plan === 'basic' || plan === 'pro' ? services : services.filter(id => !assistantAddOns.some(item => item.id === id)) }
}
export function getPendingServiceInterests(): ServiceInterest {
  try { return normalizeInterests(JSON.parse(localStorage.getItem(key) || 'null')) }
  catch { return { plan: 'free', services: [] } }
}
export function setPendingServiceInterests(interest: ServiceInterest): void {
  try { localStorage.setItem(key, JSON.stringify(normalizeInterests(interest))) }
  catch { /* Preview selection remains usable without local storage. */ }
}
export function hasPendingServiceInterests(): boolean {
  try { return localStorage.getItem(key) !== null }
  catch { return false }
}
export function clearPendingServiceInterests(): void {
  try { localStorage.removeItem(key) }
  catch { /* Optional cache only. */ }
}
