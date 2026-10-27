export type ServiceId =
  | 'voice_drafts' | 'estimate_approvals' | 'payment_links' | 'automated_reminders'
  | 'bookkeeping' | 'team_tools' | 'sms_messages'
export type PlanInterest = 'free' | 'basic' | 'pro' | 'a_la_carte'
export type ServiceInterest = { plan: PlanInterest; services: ServiceId[] }

export const serviceCatalog: Array<{
  id: ServiceId; name: string; description: string; stage: string; tag: string
}> = [
  { id: 'voice_drafts', name: 'Voice-to-document assistant', description: 'Dictate invoice and estimate drafts for review; full cloud speech and AI are still in testing.', stage: 'Testing', tag: 'AI' },
  { id: 'estimate_approvals', name: 'Online estimate approvals', description: 'Let customers review scope, totals and terms, then record their acceptance. Customer delivery is not live yet.', stage: 'Testing', tag: 'Customers' },
  { id: 'payment_links', name: 'Payment links', description: 'Offer a secure way for customers to pay an invoice online. Provider integration and fees are not finalized.', stage: 'Planned', tag: 'Payments' },
  { id: 'automated_reminders', name: 'Automated follow-ups', description: 'Prepare invoice reminders and customer follow-up workflows for owner review.', stage: 'Planned', tag: 'Automation' },
  { id: 'bookkeeping', name: 'Bookkeeping & integrations', description: 'Track recorded invoice payments and business expenses; QuickBooks Online connectivity is being evaluated.', stage: 'Workbook beta', tag: 'Finances' },
  { id: 'team_tools', name: 'Team collaboration', description: 'Help owners coordinate employees, roles and assignments with appropriate permissions.', stage: 'Planned', tag: 'Team' },
  { id: 'sms_messages', name: 'Customer text messaging', description: 'Customer SMS updates and replies, subject to messaging consent and provider setup.', stage: 'Planned', tag: 'Messaging' },
]
export const plans: Array<{ id: PlanInterest; label: string; description: string }> = [
  { id: 'free', label: 'Free', description: 'Manual core tools — planned free tier' },
  { id: 'basic', label: 'Basic', description: 'AI-assisted everyday work — pricing coming soon' },
  { id: 'pro', label: 'Pro', description: 'Expanded workflows — pricing coming soon' },
  { id: 'a_la_carte', label: 'À la carte', description: 'Pick services individually — pricing coming soon' },
]
export const defaultServiceInterest: ServiceInterest = { plan: 'free', services: [] }
const key = 'velnu.beta.service-interests.v1'
const knownIds = new Set<ServiceId>(serviceCatalog.map(x => x.id))
const knownPlans = new Set<PlanInterest>(plans.map(x => x.id))

export function normalizeInterests(value: unknown): ServiceInterest {
  if (!value || typeof value !== 'object') return { ...defaultServiceInterest, services: [] }
  const data = value as { plan?: unknown; services?: unknown }
  const plan = knownPlans.has(data.plan as PlanInterest) ? data.plan as PlanInterest : 'free'
  const services: ServiceId[] = Array.isArray(data.services)
    ? [...new Set(data.services.filter((id): id is ServiceId => typeof id === 'string' && knownIds.has(id as ServiceId)))]
    : []
  return { plan, services }
}
export function getPendingServiceInterests(): ServiceInterest {
  try { return normalizeInterests(JSON.parse(localStorage.getItem(key) || 'null')) }
  catch { return { plan: 'free', services: [] } }
}
export function setPendingServiceInterests(interest: ServiceInterest): void {
  try { localStorage.setItem(key, JSON.stringify(normalizeInterests(interest))) }
  catch { /* Preview selection remains usable without local storage. */ }
}
export function clearPendingServiceInterests(): void {
  try { localStorage.removeItem(key) }
  catch { /* Optional cache only. */ }
}
