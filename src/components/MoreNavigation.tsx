import type { CurrentBusiness } from '../lib/business'
import { canOpenView } from '../lib/workspaceAccess'
import { useTierUsage } from '../lib/useTierUsage'
import { canOpenSettingsSection, settingsHref, settingsOptionForPlan, settingsOptions } from '../lib/settingsNavigation'
import { confirmNavigation } from '../lib/unsavedChanges'
import { supabase } from '../lib/supabase'
import UpgradeLink, {tierRank,planAvailabilityLabel,type UpgradeTier} from './UpgradeLink'
import {isPrimaryOwner} from '../lib/workspaceAccess'
import WorkspaceIcon from './WorkspaceIcon'
import './more-navigation.css'

/** Shared by desktop, mobile, and bookmarked /?view=settings entry points. */
export default function MoreNavigation({ business }: { business: CurrentBusiness }) {
  const plan = useTierUsage(business.id)?.plan
  const options = settingsOptions
    .filter(option => option.id !== 'sms' && option.id !== 'scheduling' && canOpenSettingsSection(business, option.id))
    .flatMap(option => settingsOptionForPlan(option, plan) ?? [])
  const previews: {title:string;benefit:string;required:UpgradeTier;section:'calendar'|'documents'}[] = [
    {title:'Calendar connections',benefit:'Keep external calendar commitments alongside your scheduled work. Provider connection required.',required:'basic',section:'calendar'},
    {title:'Send email from Finviant',benefit:'Send customer documents without switching to your email app. Verified sender activation required.',required:'basic',section:'documents'},
    {title:'Customer booking and reminders',benefit:'Let customers select available times and follow up on overdue invoices. Setup and sending activation required.',required:'pro',section:'calendar'},
  ]
  const lockedPreviews = plan ? previews.filter(item=>tierRank[item.required]>tierRank[plan]&&canOpenSettingsSection(business,item.section)) : []
  const setup = options.filter(option => option.group === 'setup')
  const setupGroups=[{title:'Business & team',ids:['company','team']},{title:'Documents & delivery',ids:['documents','delivery','customer_reminders']},{title:'Connections',ids:['calendar']}];
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
    {setupGroups.map(group=>{const entries=setup.filter(option=>group.ids.includes(option.id));return entries.length?<section key={group.title} aria-label={group.title}><h3>{group.title}</h3><div className="more-navigation-grid">{entries.map(option=><a key={option.id} href={settingsHref(option.id)}><WorkspaceIcon kind={option.icon}/><span><strong>{option.title}</strong><small>{option.description}</small></span></a>)}</div></section>:null})}
    {plan && lockedPreviews.length>0 && <section aria-label="Additional plan features"><h3>More ways to run your business</h3><div className="plan-feature-previews">{lockedPreviews.map(item=><article className="plan-feature-preview" key={item.title}><span className="plan-availability-label">{planAvailabilityLabel(item.required)}</span><strong>{item.title}</strong><p>{item.benefit}</p><UpgradeLink plan={plan} required={item.required} canUpgrade={isPrimaryOwner(business)}/></article>)}</div></section>}
    <section className="more-navigation-account" aria-label="Account">
      <div><strong>{business.name}</strong><span>{business.role}</span></div>
      <div className="more-account-links">{account.map(option => <a key={option.id} href={settingsHref(option.id)}>{option.title}</a>)}<a href="/legal" target="_blank" rel="noopener noreferrer">Agreement & privacy</a><a href="/install" target="_blank" rel="noopener noreferrer">App icon</a></div>
      <button type="button" className="secondary-button" onClick={() => { if (confirmNavigation()) void supabase.auth.signOut() }}>Sign out</button>
    </section>
  </div>
}
