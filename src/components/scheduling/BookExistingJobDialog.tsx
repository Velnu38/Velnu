import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../../lib/business'
import { customerDisplayName, type CustomerName } from '../../lib/customerRecords'
import { listJobs } from '../../services/jobs'
import FormDialog from '../FormDialog'
import DispatchJobDialog from './DispatchJobDialog'

type Job = { id: string; title: string; status: string; scheduled_start: string | null; scheduled_end: string | null; assigned_user_ids?: string[]; customers: CustomerName[] }
const jobLabel = (job: Job) => job.title + ' · ' + customerDisplayName(job.customers[0])

export default function BookExistingJobDialog({ business, day, onClose, onSaved }: {
  business: CurrentBusiness; day?: string; onClose: () => void; onSaved: () => void
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [selected, setSelected] = useState<Job | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void listJobs(business.id).then(rows => {
      if (active) setJobs(rows.filter(row => ['lead','scheduled','in_progress'].includes(row.status)))
    }).catch(() => { if (active) setError('Unable to load jobs.') })
    return () => { active = false }
  }, [business.id, version])

  if (selected) return <DispatchJobDialog business={business} job={selected} initialDay={day} onClose={()=>setSelected(null)} onSaved={()=>{onSaved();onClose()}} />
  const matches = jobs?.filter(job => jobLabel(job).toLowerCase().includes(search.trim().toLowerCase())) ?? []
  return <FormDialog label="Book existing job" onClose={onClose}>
    <div className="modal-head"><h2>Book existing job</h2><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></div>
    <label data-editor-independent>Find a job<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Job title or customer" /></label>
    {error ? <p role="alert">{error} <button className="text-button" type="button" onClick={() => setVersion(value => value + 1)}>Try again</button></p>
      : !jobs ? <p role="status">Loading jobs…</p>
      : !matches.length ? <p className="quiet">No matching active jobs.</p>
      : <div className="home-create-options">{matches.slice(0, 20).map(job => <button type="button" key={job.id} onClick={() => setSelected(job)}>
        <strong>{jobLabel(job)}</strong><small>{job.scheduled_start ? 'Reschedule appointment' : 'Needs an appointment'}</small>
      </button>)}{matches.length>20&&<p className="quiet">Narrow your search to see more matches.</p>}</div>}
    <p><a href={'/?view=work&new=1&schedule=1'+(day?'&day='+encodeURIComponent(day):'')}>Create scheduled job</a></p>
  </FormDialog>
}
