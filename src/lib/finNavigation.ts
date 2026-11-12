import type { CurrentBusiness } from './business'
import { canOpenView, canUseAssistant } from './workspaceAccess'
import { canOpenSettingsSection, settingsOptionForPlan, settingsOptions, type SettingsSection } from './settingsNavigation'
import type { VelnuTier } from './pricing'

// Only explicit, navigation-only requests qualify. Never execute model URLs or
// interpret a send/save/enable request as permission to navigate away. Customer
// reminder setup opens its existing settings; it never creates or enables a rule.
const destinations = {
  home: ['dashboard', undefined], customers: ['customers', undefined],
  invoices: ['invoices', undefined], estimates: ['estimates', undefined],
  jobs: ['work', undefined], jobManagement: ['work', undefined], schedule: ['schedule', undefined],
  followups: ['reminders', undefined], finances: ['bookkeeping', undefined],
  settings: ['settings', undefined], customerReminders: ['settings', 'customer_reminders'],
  team: ['settings', 'team'], company: ['settings', 'company'],
  calendar: ['settings', 'calendar'], documents: ['settings', 'documents'],
  support: ['settings', 'support'], storage: ['settings', 'storage'],
} as const
export type FinDestination = keyof typeof destinations
export type FinNavigation = { destination: FinDestination } | { clarification: string }
const aliases: Record<string, FinDestination> = {
  home:'home', dashboard:'home', customers:'customers', 'customer directory':'customers',
  invoices:'invoices', estimates:'estimates', jobs:'jobs', 'jobs directory':'jobs', 'job management':'jobManagement',
  schedule:'schedule', calendar:'schedule', 'internal reminders':'followups',
  'internal follow ups':'followups', 'follow ups':'followups', finances:'finances',
  'financial performance':'finances', expenses:'finances', settings:'settings',
  'customer reminders':'customerReminders', 'customer reminder settings':'customerReminders',
  'customer reminder setup':'customerReminders', 'invoice reminders':'customerReminders',
  'invoice reminder settings':'customerReminders', 'appointment reminders':'customerReminders',
  'appointment reminder settings':'customerReminders', 'team management':'team',
  'worker profiles':'team', 'company profile':'company', 'calendar connections':'calendar',
  'document settings':'documents', 'invoice and estimate setup':'documents',
  help:'support', support:'support', storage:'storage',
}
export function resolveFinNavigation(text: string, previous?: FinDestination): FinNavigation | null {
  const clean=text.toLowerCase().trim().replace(/[.!?]+$/,'').replace(/[-–]/g,' ').replace(/\s+/g,' ').replace(/^(?:can|could|would) you (?:please )?/,'').replace(/^please /,'').replace(/ please$/,'')
  if(/^(?:set up|setup|create|add) (?:a |an )?(?:customer|invoice|appointment) reminders?(?: setup| settings)?$/.test(clean))return {destination:'customerReminders'}
  const match=/^(?:open|show(?: me)?|go to|take me to|navigate to) (?:the |my )?(.+)$/.exec(clean)
  if(!match)return Object.hasOwn(aliases,clean)?{destination:aliases[clean]}:null
  const subject=match[1]
  if(['that','it','that page','there'].includes(subject))return previous?{destination:previous}:{clarification:'Which page would you like to open?'}
  if(subject==='reminders'||subject==='reminder settings')return {clarification:'Do you mean Customer Reminders (messages to customers) or internal follow-ups?'}
  const destination=Object.hasOwn(aliases,subject)?aliases[subject]:undefined
  if(destination)return {destination}
  // Non-destination 'show me' requests remain account questions/searches.
  if(/^show(?: me)? /.test(clean))return null
  // Requests containing consequential verbs belong to the existing review flow.
  if(/\b(send|save|enable|disable|delete|create|charge|pay|update|cancel)\b/.test(subject))return null
  return {clarification:'I cannot open that destination directly. Name a supported page, such as Invoices, Jobs, Customer Reminders, or Calendar Connections. For a specific record, open its directory and select it.'}
}
export function finDestination(destination: FinDestination) {
  if(!Object.hasOwn(destinations,destination))throw Error('This destination is unavailable.')
  const [view,section]=destinations[destination]
  return {view,section:section as SettingsSection|undefined,href:'/?view='+view+(section?'&section='+section:destination==='jobs'?'&workspace=jobs':destination==='jobManagement'?'&workspace=management':'')}
}
export function assertFinNavigationAccess(expectedBusiness: string, business: CurrentBusiness|null, destination: FinDestination, usage: {ai_limit?:number;voice_limit?:number;plan?:string}|null) {
  const target=finDestination(destination)
  if(!business||business.id!==expectedBusiness||!canUseAssistant(business))throw Error('Your business access could not be verified. Reload and try again.')
  if(!usage||Number(usage.ai_limit||0)<=0||Number(usage.voice_limit||0)<=0)throw Error('Fin is not available on your current plan. Use the workspace navigation instead.')
  if(!canOpenView(business,target.view)||(target.section&&!canOpenSettingsSection(business,target.section)))throw Error('This area is not included in your access. Contact your primary business owner.')
  if(target.section){const option=settingsOptions.find(o=>o.id===target.section)!;if(!settingsOptionForPlan(option,usage.plan as VelnuTier))throw Error('This destination is not available on your current plan.')}
  return target
}
