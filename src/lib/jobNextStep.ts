export type JobNextStep = { label: string; detail: string; action: 'schedule' | 'crew' | 'start' | 'complete' | 'tasks' | 'materials' | 'changes' | 'visits' | 'invoice' | 'history' | 'overview' }
export function jobNextStep(p: {
  status: string; ready: boolean; canEdit: boolean; canSchedule: boolean; canBill: boolean;
  booked: boolean; crew: boolean; futureVisit: boolean; remainingVisits: boolean;
  tasks: number; materials: number; changes: number; invoice?: {status: string} | null;
}): JobNextStep {
  if (!p.ready) return {label:'Review work plan',detail:'Refresh the work plan before taking action.',action:'overview'}
  if (p.status==='canceled') return {label:'View history',detail:'This job is canceled.',action:'history'}
  if (p.status==='completed') {
    if (!p.canBill) return {label:'View history',detail:'Work is completed. Billing requires authorized access.',action:'history'}
    return {label:p.invoice?.status==='paid'?'View payment history':p.invoice?.status==='draft'?'Review invoice':p.invoice?'View invoice / balance':'Review charges',detail:'Work is completed. Review the linked billing record.',action:'invoice'}
  }
  if (!p.canEdit) return {label:'Review work plan',detail:'You have read-only access to this job.',action:'overview'}
  if (!p.booked && p.status!=='in_progress') return {label:p.canSchedule?'Schedule visit':'Review visits',detail:'This job needs a scheduled visit.',action:p.canSchedule?'schedule':'visits'}
  if (!p.crew && p.canSchedule) return {label:'Assign crew',detail:'Choose workers for the scheduled work.',action:'crew'}
  if (p.materials) return {label:'Review materials',detail:`${p.materials} ${p.materials===1?'material':'materials'} not received`,action:'materials'}
  if (p.changes && p.canBill) return {label:'Review changes',detail:`${p.changes} changes need review`,action:'changes'}
  if (p.status!=='in_progress') return p.futureVisit
    ? {label:'Review visit',detail:'Your next visit is scheduled for a future time.',action:'visits'}
    : {label:'Start job',detail:'The scheduled work is ready to begin.',action:'start'}
  if (p.tasks) return {label:'Review tasks',detail:`${p.tasks} ${p.tasks===1?'task':'tasks'} to finish`,action:'tasks'}
  if (p.remainingVisits) return {label:'Review next visit',detail:'Scheduled visits remain on this job.',action:'visits'}
  return {label:'Review completion',detail:'Review the checklist, materials and billing before completing.',action:'complete'}
}
