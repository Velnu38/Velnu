import {useEffect, useState} from 'react'
import {DateTime} from 'luxon'
import type {CurrentBusiness} from '../lib/business'
import {canAccess, isPrimaryOwner} from '../lib/workspaceAccess'
import {hasActiveJobAppointment, jobNeedsStatusUpdate, jobStatusLabels, type JobStatus} from '../lib/jobActions'
import type {JobWorkflow} from '../services/jobs'
import type {Worker} from '../services/schedulingWorkflow'
import {getJobPlanSummaries, type JobPlanSummary} from '../services/operations'
import './jobs-overview.css'

export type JobsOverviewFilter = 'today' | 'active' | 'unscheduled' | 'in_progress' | 'billing' | 'attention' | 'unassigned' | 'history' | 'all' | 'scheduled' | 'completed'
type OverviewJob = JobWorkflow & {
  id: string; title: string; status: string; scheduled_start: string|null; scheduled_end?: string|null
  assigned_user_ids?: string[]; completed_at?: string|null; created_at?: string
  customers: {first_name: string|null; last_name: string|null; company: string|null} | {first_name: string|null; last_name: string|null; company: string|null}[] | null
}
type Props = {
  business: CurrentBusiness; jobs: OverviewJob[]; team: Worker[]; now: Date; revision: number
  canCreate: boolean; onCreate: () => void; onFilter: (filter: JobsOverviewFilter) => void
  onOpen: (id: string, plan?: boolean) => void
}
const money = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n)
function customer(job: OverviewJob) {
  const c = Array.isArray(job.customers) ? job.customers[0] : job.customers
  return c ? [c.first_name,c.last_name].filter(Boolean).join(' ') || c.company || 'Customer' : 'Customer'
}
export default function JobsOverview({business,jobs,team,now,revision,canCreate,onCreate,onFilter,onOpen}: Props) {
  const zone = business.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const day = DateTime.fromJSDate(now,{zone}).toISODate()
  const active = jobs.filter(j => !['completed','canceled'].includes(j.status))
  const today = active.filter(j => hasActiveJobAppointment(j) && DateTime.fromISO(j.scheduled_start!).setZone(zone).toISODate() === day)
    .sort((a,b) => Date.parse(a.scheduled_start!) - Date.parse(b.scheduled_start!))
  const scheduled = active.filter(hasActiveJobAppointment)
  const unscheduled = active.filter(j => j.status !== 'in_progress' && !hasActiveJobAppointment(j))
  const progressing = active.filter(j => j.status === 'in_progress')
  const late = active.filter(j => jobNeedsStatusUpdate(j,now,zone))
  const unassigned = active.filter(j => !(j.assigned_user_ids?.length))
  const completed = jobs.filter(j => j.status === 'completed')
  const billingAccess = canAccess(business,'billing')
  const toBill = billingAccess ? completed.filter(j => !j.invoice || ['draft','void'].includes(j.invoice.status)) : []
  const focus = [...active].sort((a,b) => Number(b.status==='in_progress')-Number(a.status==='in_progress') || (Date.parse(a.scheduled_start||'')||Infinity)-(Date.parse(b.scheduled_start||'')||Infinity) || a.id.localeCompare(b.id)).slice(0,4)
  const key = [business.id,business.role,business.access_modules?.join(','),day,...focus.map(j=>j.id)].join(':')
  const [plans,setPlans] = useState<{key:string;rows:Record<string,JobPlanSummary|null>}|null>(null)
  const [retry,setRetry] = useState(0)
  useEffect(() => {
    let current = true
    const ids = focus.map(j=>j.id)
    getJobPlanSummaries(business.id,ids)
      .then(rows => {
        if(current) setPlans({key,rows:Object.fromEntries(rows.map(row=>[row.job_id,row]))})
      })
      .catch(() => {
        if(current) setPlans({key,rows:Object.fromEntries(ids.map(id=>[id,null]))})
      })
    return () => {current=false}
  },[key,revision,retry])
  const agenda = today.length ? today : scheduled.filter(j=>Date.parse(j.scheduled_start!)>=now.getTime()).sort((a,b)=>Date.parse(a.scheduled_start!)-Date.parse(b.scheduled_start!)).slice(0,3)
  const priorities: {filter:JobsOverviewFilter;count:number;title:string;detail:string}[] = [
    {filter:'attention' as const,count:late.length,title:'Confirm past appointments',detail:'Update work that has not been closed out.'},
    {filter:'unscheduled' as const,count:unscheduled.length,title:'Book the next visit',detail:'Jobs waiting for an active appointment.'},
    {filter:'unassigned' as const,count:unassigned.length,title:'Assign the work',detail:'Active jobs without an assigned worker.'},
    ...(billingAccess?[{filter:'billing' as const,count:toBill.length,title:'Review completed work for billing',detail:'An invoice draft or charges need review.'}]:[]),
  ].filter(p=>p.count>0)
  const kpis = [
    {filter:'today' as const,title:'Today',count:today.length,detail:'scheduled jobs'},
    {filter:'in_progress' as const,title:'In progress',count:progressing.length,detail:'jobs underway'},
    {filter:'unscheduled' as const,title:'To schedule',count:unscheduled.length,detail:'appointments needed'},
    {filter:billingAccess?'billing' as const:'active' as const,title:billingAccess?'Ready for billing':'Active work',count:billingAccess?toBill.length:active.length,detail:billingAccess?'review before sending':'current & upcoming'},
  ]
  return <div className="jobs-overview" aria-label="Job management overview">
    <div className="jobs-pulse-heading"><p>{DateTime.fromJSDate(now,{zone}).toFormat('cccc, MMMM d')}</p><span>{active.length} active · {completed.length} completed</span></div>
    <section className="jobs-pulse" aria-label="Work at a glance">{kpis.map(k=><button type="button" key={k.filter} onClick={()=>onFilter(k.filter)}><span>{k.title}</span><strong>{k.count}</strong><small>{k.detail}</small><span className="pulse-arrow" aria-hidden="true">↗</span></button>)}</section>
    {!jobs.length && <section className="jobs-first-run"><div><p className="eyebrow">Your work, organized</p><h2>Build your first job.</h2><p>Add the customer and work. Then plan the visit, assign workers, track the checklist and costs, and prepare the invoice.</p></div>{canCreate&&<button type="button" className="primary-button compact" onClick={onCreate}>Create your first job</button>}<ol><li><span>1</span>Plan &amp; assign</li><li><span>2</span>Track work &amp; costs</li><li><span>3</span>Complete &amp; invoice</li></ol></section>}
    <div className="jobs-overview-columns">
      <section className="job-hub-panel jobs-agenda"><header><div><p className="eyebrow">Schedule</p><h2>{today.length?'Today’s work':'Next on the calendar'}</h2></div><button type="button" className="text-button" onClick={()=>onFilter('today')}>View today</button></header>
        {agenda.length ? <ol>{agenda.slice(0,4).map(j=><li key={j.id}><div className="agenda-time"><strong>{DateTime.fromISO(j.scheduled_start!).setZone(zone).toFormat('h:mm')}</strong><small>{DateTime.fromISO(j.scheduled_start!).setZone(zone).toFormat(today.length?'a':'MMM d')}</small></div><div className="agenda-copy"><button type="button" onClick={()=>onOpen(j.id)}>{j.title}</button><span>{customer(j)}</span><small>{team.filter(w=>j.assigned_user_ids?.includes(w.id)).map(w=>w.label).join(', ')||'Worker not assigned'}</small></div><span className={'hub-status '+(j.status==='in_progress'?'is-working':'')}>{jobStatusLabels[j.status as JobStatus]||j.status}</span></li>)}</ol> : <div className="hub-quiet-state"><strong>No upcoming appointments.</strong><p>{unscheduled.length?'Your unscheduled jobs are ready to plan.':'Your calendar is clear. Add a job or review your past work.'}</p><button type="button" className="text-button" onClick={()=>onFilter(unscheduled.length?'unscheduled':'all')}>{unscheduled.length?'Choose a job to schedule':'View all jobs'}</button></div>}
      </section>
      <section className="job-hub-panel jobs-priorities"><header><div><p className="eyebrow">Next actions</p><h2>Needs attention</h2></div><span className="hub-badge">{priorities.length} categories</span></header>{priorities.length?<ul>{priorities.map(p=><li key={p.filter}><button type="button" onClick={()=>onFilter(p.filter)}><span className="priority-count">{p.count}</span><span><strong>{p.title}</strong><small>{p.detail}</small></span><span aria-hidden="true">›</span></button></li>)}</ul>:<div className="hub-quiet-state"><strong>{jobs.length?'You’re caught up.':'A clear view of what comes next.'}</strong><p>Scheduling gaps, unassigned work, past appointments and billing reviews appear here.</p>{completed.length>0&&<button type="button" className="text-button" onClick={()=>onFilter('completed')}>Review completed jobs</button>}</div>}</section>
    </div>
    {!!focus.length&&<section className="jobs-focus" aria-label="Active work plans"><header><div><p className="eyebrow">Execution</p><h2>Work in focus</h2><p>Up to four active jobs · work underway appears first</p></div><button type="button" className="text-button" onClick={()=>onFilter('active')}>All active jobs</button></header><div className="jobs-focus-grid">{focus.map(j=>{
      const ready=plans?.key===key,plan=ready?plans.rows[j.id]:undefined
      const done=plan?.tasks_completed||0,total=plan?.tasks_total||0
      const due=plan?.due_tasks||0
      const hours=Number(plan?.hours||0)
      const cost=Number(plan?.tracked_cost||0)
      return <article className="job-focus-card" key={j.id}><div className="job-focus-top"><span className={'hub-status '+(j.status==='in_progress'?'is-working':'')}>{j.status!=='in_progress'&&!hasActiveJobAppointment(j)?'Needs scheduling':jobStatusLabels[j.status as JobStatus]||j.status}</span>{due>0&&<small className="task-due">{due} tasks due</small>}</div><h3><button type="button" onClick={()=>onOpen(j.id)}>{j.title}</button></h3><p>{customer(j)}</p>{plan?<><div className="focus-progress"><span>Checklist</span><strong>{done} / {total}</strong></div><progress max={total||1} value={done} aria-label={j.title+' checklist progress'}/>{!total&&<small>Add the steps for this job in its work plan.</small>}{plan.financial_access&&<div className="focus-costs"><span><small>Time recorded</small><strong>{hours.toFixed(1)} h</strong></span><span><small>Tracked cost</small><strong>{money(cost)}</strong></span>{Number(plan.budget_cost)>0&&<p>{money(cost)} of {money(Number(plan.budget_cost))} cost budget</p>}<p>Recorded costs only; excludes unrecorded labor and expenses.</p></div>}</>:<p className="hub-quiet-state" role="status">{ready?<>Work plan could not load. <button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Retry</button></>:'Loading work plan…'}</p>}<button type="button" className="secondary-button compact" onClick={()=>onOpen(j.id,true)}>Open work plan <span aria-hidden="true">→</span></button></article>
    })}</div></section>}
    <div className="jobs-overview-columns jobs-secondary-overview"><section className="job-hub-panel"><header><div><p className="eyebrow">Pipeline</p><h2>Every stage, connected</h2></div><button type="button" className="text-button" onClick={()=>onFilter('all')}>All jobs</button></header><div className="jobs-pipeline">{[{filter:'unscheduled' as const,label:'To schedule',count:unscheduled.length},{filter:'scheduled' as const,label:'Scheduled',count:scheduled.filter(j=>j.status!=='in_progress').length},{filter:'in_progress' as const,label:'In progress',count:progressing.length},{filter:'completed' as const,label:'Completed',count:completed.length}].map((s,i)=><button type="button" key={s.label} onClick={()=>onFilter(s.filter)}><span className={'pipeline-dot stage-'+i}/><strong>{s.count}</strong><span>{s.label}</span></button>)}</div><p className="hub-footnote">Complete a job to prepare its invoice for review. Nothing is sent without the existing sending workflow.</p></section>
    <section className="job-hub-panel"><header><div><p className="eyebrow">Crew</p><h2>Assignments today</h2></div>{isPrimaryOwner(business)&&<a href="/?view=settings&section=team" className="text-button">Manage team</a>}</header>{team.filter(w=>w.active!==false).length?<ul className="crew-today">{team.filter(w=>w.active!==false).slice(0,5).map(w=>{const count=today.filter(j=>j.assigned_user_ids?.includes(w.id)).length;return <li key={w.id}><span className="crew-avatar" aria-hidden="true">{w.label.trim().charAt(0)}</span><span><strong>{w.label}</strong><small>{count?`${count} scheduled ${count===1?'job':'jobs'}`:'No jobs scheduled today'}</small></span></li>})}</ul>:<p className="hub-quiet-state">Worker assignments will appear after your roster is loaded. Manage workers in Team Management.</p>}<p className="hub-footnote">Scheduled assignments, not a live availability or capacity guarantee.{team.filter(w=>w.active!==false).length>5?' Showing the first five active workers.':''}</p></section></div>
  </div>
}
