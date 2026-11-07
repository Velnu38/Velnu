import type { CurrentBusiness } from '../lib/business'
import { canOpenView } from '../lib/workspaceAccess'
import { useTierUsage } from '../lib/useTierUsage'
import { canOpenSettingsSection, settingsHref, settingsOptionForPlan, settingsOptions } from '../lib/settingsNavigation'
import { confirmNavigation } from '../lib/unsavedChanges'
import { supabase } from '../lib/supabase'
import WorkspaceIcon from './WorkspaceIcon'
import './more-navigation.css'

/** Shared by desktop, mobile, and bookmarked /?view=settings entry points. */
export default function MoreNavigation({ business }: { business: CurrentBusiness }) {
  const plan = useTierUsage(business.id)?.plan
  const options = settingsOptions
    .filter(option => option.id !== 'sms' && canOpenSettingsSection(business, option.id))
    .flatMap(option => settingsOptionForPlan(option, plan) ?? [])
  const setup = options.filter(option => option.group === 'setup')
  const account = options.filter(option => option.group === 'account')
  const destinations = [
    { id: 'customers', title: 'Customers', description: 'Customer details, locations, and history.' },
    { id: 'schedule', title: 'Schedule', description: 'Scheduled work and reminder management.' },
  ].filter(option => canOpenView(business, option.id))
  return <div className="more-navigation">
    <section aria-label="Business"><h3>Business</h3><div className="more-navigation-grid">
      {destinations.map(option => <a key={option.id} href={'/?view=' + option.id}><WorkspaceIcon kind={option.id}/><span><strong>{option.title}</strong><small>{option.description}</small></span></a>)}
      {options.filter(option => option.group === 'business').map(option => <a key={option.id} href={settingsHref(option.id)}><WorkspaceIcon kind={option.icon}/><span><strong>{option.title}</strong><small>{option.description}</small></span></a>)}
    </div></section>
    {setup.length > 0 && <section aria-label="Setup and connections"><h3>Setup & connections</h3><div className="more-navigation-grid">
      {setup.map(option => <a key={option.id} href={settingsHref(option.id)}><WorkspaceIcon kind={option.icon}/><span><strong>{option.title}</strong><small>{option.description}</small></span></a>)}
    </div></section>}
    <section className="more-navigation-account" aria-label="Account">
      <div><strong>{business.name}</strong><span>{business.role}</span></div>
      <div className="more-account-links">{account.map(option => <a key={option.id} href={settingsHref(option.id)}>{option.title}</a>)}<a href="/legal" target="_blank" rel="noopener noreferrer">Agreement & privacy</a><a href="/install" target="_blank" rel="noopener noreferrer">App icon</a></div>
      <button type="button" className="secondary-button" onClick={() => { if (confirmNavigation()) void supabase.auth.signOut() }}>Sign out</button>
    </section>
  </div>
}
