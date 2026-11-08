import { useState } from 'react'
import type { CurrentBusiness } from '../../lib/business'
import { isPrimaryOwner } from '../../lib/workspaceAccess'
import { useTierUsage } from '../../lib/useTierUsage'
import { confirmNavigation } from '../../lib/unsavedChanges'
import PlanRestriction from '../PlanRestriction'
import TeamSettings from './TeamSettings'
import WorkersSettings from './WorkersSettings'
import SchedulingSettings from '../scheduling/SchedulingSettings'
import './team-management.css'
export default function TeamManagement({business,initialAvailability=false}:{business:CurrentBusiness;initialAvailability?:boolean}){
  const owner=isPrimaryOwner(business),plan=useTierUsage(business.id)?.plan
  const [tab,setTab]=useState<'workers'|'availability'|'access'>(initialAvailability?'availability':'workers')
  return <div className="team-management">
    <nav className="team-tabs" aria-label="Team management sections">{([['workers','Workers'],['availability','Availability'],...(owner?[['access','Account Access']]:[])] as const).map(([id,label])=><button type="button" key={id} aria-current={tab===id?'page':undefined} onClick={()=>{if(tab!==id&&confirmNavigation())setTab(id as typeof tab)}}>{label}</button>)}</nav>
    {tab==='workers'?<WorkersSettings business={business}/>:tab==='availability'?<SchedulingSettings business={business}/>:plan==='pro'?<TeamSettings business={business}/>:<section className="settings-panel"><h2>Account Access</h2><p>Your plan includes one account user: the owner. Worker profiles do not use account seats.</p><p>Business Pro includes five account users, including the owner.</p><PlanRestriction plan={plan??'free'} required="pro" feature="Additional account users" benefit="Give authorized team members their own account access. Worker profiles remain separate." canUpgrade={owner}/></section>}
  </div>
}
