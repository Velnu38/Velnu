import type { CurrentBusiness } from './business'
import { canAccess, isPrimaryOwner } from './workspaceAccess'

export type SettingsSection = 'storage' | 'plans' | 'delivery' | 'company' | 'team' | 'documents' | 'calendar' | 'scheduling' | 'subscription' | 'testing' | 'support' | 'sms'
export const integrationTestingAvailable = import.meta.env?.VITE_SUPABASE_URL === 'https://xvybcmyoblfgzokaifsx.supabase.co' || import.meta.env?.VITE_PRIVATE_INTEGRATION_TESTING === 'true'

export const settingsOptions: { id: SettingsSection; title: string; description: string; group: 'business' | 'setup' | 'account'; icon: string }[] = [
  { id: 'support', title: 'Help & Support', description: 'Report an issue and follow Finviant replies.', group: 'business', icon: 'support' },
  { id: 'documents', title: 'Invoice & Estimate Setup', description: 'Appearance, branding, taxes, and customer payment methods.', group: 'setup', icon: 'invoices' },
  { id: 'company', title: 'Company Profile', description: 'Business details and services.', group: 'setup', icon: 'company' },
  { id: 'team', title: 'Team & Access', description: 'Invite your team and choose their access.', group: 'setup', icon: 'customers' },
  { id: 'sms', title: 'Text Messaging Setup', description: 'Verify your owner mobile number before sending SMS.', group: 'setup', icon: 'sms' },
  { id: 'calendar', title: 'Calendar Connections', description: 'Google Calendar and Microsoft Outlook.', group: 'setup', icon: 'schedule' },
  { id: 'scheduling', title: 'Working Hours & Team Availability', description: 'Working hours, booking notice, travel time, and time off.', group: 'setup', icon: 'availability' },
  { id: 'storage', title: 'Storage', description: 'View shared business storage and upload limits.', group: 'account', icon: 'company' },
  { id: 'plans', title: 'Plans & Usage', description: 'Compare Free, Individual and Business Pro; test each tier.', group: 'account', icon: 'payments' },
  { id: 'delivery', title: 'Email & Text Setup', description: 'Personal sending apps and Finviant sender readiness.', group: 'setup', icon: 'sms' },
  { id: 'subscription', title: 'Subscription', description: 'View your subscription and manage cancellation.', group: 'account', icon: 'payments' },
  { id: 'testing', title: 'Integration Testing', description: 'Private Stripe and approved Twilio SMS tests.', group: 'account', icon: 'settings' },
]

export function canOpenSettingsSection(business: CurrentBusiness, section: SettingsSection, testingEnabled = integrationTestingAvailable) {
  if (section === 'support' || section === 'storage') return true
  if (section === 'calendar') return canAccess(business, 'calendar')
  if (section === 'scheduling') return ['owner', 'admin', 'office'].includes(business.role) && canAccess(business, 'calendar') && canAccess(business, 'jobs')
  if (section === 'testing' && !testingEnabled) return false
  return isPrimaryOwner(business)
}

export function settingsSectionFromSearch(search: string): SettingsSection | null {
  const query = new URLSearchParams(search)
  const section = query.get('section')
  if (settingsOptions.some(option => option.id === section)) return section as SettingsSection
  if (query.has('sms_setup')) return 'sms'
  if (query.has('integration_test')) return 'testing'
  return null
}

export function settingsHref(section: SettingsSection) {
  return '/?view=settings&section=' + section
}
