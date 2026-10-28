import { lazy, Suspense, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import type { ReminderJob } from '../services/reminders'

const SchedulePage = lazy(() => import('./SchedulePage'))
const JobsPage = lazy(() => import('./JobsPage'))
const RemindersPage = lazy(() => import('./RemindersPage'))
export type WorkView = 'schedule' | 'jobs' | 'reminders'

export default function JobsSchedulePage({ business, initialView = 'schedule' }: { business: CurrentBusiness; initialView?: WorkView }) {
  const [view, setView] = useState<WorkView>(initialView)
  const [reminderJob, setReminderJob] = useState<ReminderJob | undefined>()

  return <div className="page-stack work-hub">
    <div className="page-heading"><p className="eyebrow">Work management</p><h1>Jobs &amp; schedule</h1><p className="quiet">Plan your time, organize your jobs, and keep track of follow-ups.</p></div>
    <nav className="work-view-nav" aria-label="Jobs and schedule views">
      {(['schedule', 'jobs', 'reminders'] as const).map(item => <button key={item} type="button" aria-pressed={view === item} onClick={() => { setReminderJob(undefined); setView(item) }}>{item === 'schedule' ? 'Schedule' : item === 'jobs' ? 'Jobs' : 'Reminders'}</button>)}
    </nav>
    <div className="work-hub-content"><Suspense fallback={<p role="status">Loading {view}…</p>}>
      {view === 'schedule' && <SchedulePage business={business} embedded />}
      {view === 'jobs' && <JobsPage business={business} embedded onCreateReminder={job => { setReminderJob(job); setView('reminders') }} />}
      {view === 'reminders' && <RemindersPage business={business} initialJob={reminderJob} />}
    </Suspense></div>
  </div>
}
