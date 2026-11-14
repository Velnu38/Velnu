/** Work and money have independent lifecycles. Never infer settlement from a return URL. */
export type JourneyStage = 'approval'|'deposit'|'scheduling'|'booked'|'working'|'completion_review'|'work_complete'|'pricing'|'invoice_review'|'delivery'|'payment_pending'|'payment_review'|'payment'|'closed'|'canceled'
export type JourneyAction = 'estimate'|'deposit'|'schedule'|'visit'|'work'|'complete'|'invoice'|'delivery'|'payment'|'reconcile'|'history'
export type JourneyFacts = {
  workStatus: 'lead'|'scheduled'|'in_progress'|'completed'|'canceled'
  approval: 'not_required'|'pending'|'approved'|'declined'
  deposit: 'not_required'|'unpaid'|'pending'|'review'|'paid'
  hasVisit: boolean
  remainingVisits: number
  unfinishedTasks: number
  missingMaterials: number
  pendingChanges: number
  pricingAgreed: boolean
  billingVisible: boolean
  estimateId?: string|null
  depositInvoiceId?: string|null
  invoice: null|{id:string;status:'draft'|'sent'|'viewed'|'partial'|'paid'|'overdue'|'void';balanceDue:number}
  payment: 'none'|'pending'|'review'
  delivery: 'none'|'queued'|'sending'|'accepted'|'delivered'|'failed'|'uncertain'
}
export type JourneyState = {stage:JourneyStage;label:string;detail:string;action:JourneyAction;needsAttention:boolean;workComplete:boolean;financiallySettled:boolean}

export function jobJourney(f:JourneyFacts):JourneyState {
  const workComplete=f.workStatus==='completed'
  const financiallySettled=f.billingVisible&&f.payment==='none'&&f.invoice?.status==='paid'&&Number.isFinite(f.invoice.balanceDue)&&f.invoice.balanceDue<=0
  const state=(stage:JourneyStage,label:string,detail:string,action:JourneyAction,needsAttention=false):JourneyState=>({stage,label,detail,action,needsAttention,workComplete,financiallySettled})
  if(f.workStatus==='canceled')return state('canceled','Work canceled','Existing records remain available to authorized users.',f.billingVisible&&f.invoice?'invoice':'history',f.billingVisible&&!!f.invoice&&f.invoice.status!=='void'&&!financiallySettled)
  // A deposit, pending charge or paid invoice never changes the operational job status.
  if(!workComplete){
    if(f.approval==='declined')return state('approval','Scope declined','Review the customer’s decision before offering new work.','estimate',true)
    if(f.approval==='pending')return state('approval','Awaiting approval','The current scope still needs customer approval.','estimate')
    if(!f.hasVisit&&f.deposit!=='not_required'&&f.deposit!=='paid')return state('deposit',f.deposit==='pending'?'Deposit processing':f.deposit==='review'?'Deposit needs review':'Awaiting deposit','Confirm the required deposit before opening appointment booking.',f.deposit==='review'?'reconcile':'deposit',f.deposit==='review')
    if(!f.hasVisit&&f.workStatus!=='in_progress')return state('scheduling','Ready to schedule','Prepare appointment options from the agreed work.','schedule')
    if(f.workStatus!=='in_progress')return state('booked','Scheduled','Review the next visit and assigned crew.','visit')
    if(f.remainingVisits||f.unfinishedTasks||f.missingMaterials||f.pendingChanges)return state('working','Work in progress',f.remainingVisits?'Visits remain on this job.':f.missingMaterials?'Materials still need attention.':f.pendingChanges?'Scope changes still need a decision.':'Checklist items remain.','work',!!f.missingMaterials||!!f.pendingChanges)
    return state('completion_review','Ready for completion review','Confirm the current work before preparing final billing.','complete')
  }
  if(f.remainingVisits||f.pendingChanges)return state('completion_review','Completion needs review',f.remainingVisits?'This completed job still has unresolved visits.':'Review unresolved scope changes before final billing.','work',true)
  if(!f.billingVisible)return state('work_complete','Work complete','Billing is available to authorized office users.','history')
  if(f.payment==='review')return state('payment_review','Payment needs reconciliation','Review linked invoices and payment outcomes before requesting another payment.','reconcile',true)
  if(f.payment==='pending')return state('payment_pending','Payment pending','Automatic reminders are on hold while this payment is confirmed.','payment')
  if(financiallySettled)return state('closed','Closed · Paid','Work is complete and the final invoice is paid.','history')
  if(!f.invoice||f.invoice.status==='void')return state(f.pricingAgreed?'invoice_review':'pricing',f.pricingAgreed?'Ready to invoice':'Charges need review',f.pricingAgreed?'Prepare the final invoice from the agreed scope.':'Agree the customer charges; internal job costs are not billable prices.','invoice',true)
  if(f.invoice.status==='draft')return state('invoice_review','Invoice ready for review','Review the final charges, deposit credit and due date before sending.','invoice')
  if(f.delivery==='failed'||f.delivery==='uncertain')return state('delivery',f.delivery==='uncertain'?'Delivery needs reconciliation':'Delivery needs attention','Check this saved delivery before starting another send.','delivery',true)
  if(f.delivery==='queued'||f.delivery==='sending')return state('delivery','Invoice delivery pending','The saved message is processing; do not create another send.','delivery')
  if(!Number.isFinite(f.invoice.balanceDue)||f.invoice.balanceDue<=0)return state('payment_review','Balance needs reconciliation','The balance and invoice status need verification.','reconcile',true)
  return state('payment',f.invoice.status==='partial'?'Partially paid':f.invoice.status==='overdue'?'Payment overdue':'Awaiting payment','Follow up only on the verified remaining invoice balance.','payment',f.invoice.status==='overdue')
}

/** Treat malformed or partially deployed responses as unavailable, never as verified state. */
export function verifiedJourney(value:unknown):JourneyFacts|undefined {
  if(!value||typeof value!=='object')return undefined
  const f=value as JourneyFacts
  const uuid=(id:unknown)=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  if(!['lead','scheduled','in_progress','completed','canceled'].includes(f.workStatus)
    ||!['not_required','pending','approved','declined'].includes(f.approval)
    ||!['not_required','unpaid','pending','review','paid'].includes(f.deposit)
    ||!['none','pending','review'].includes(f.payment)
    ||!['none','queued','sending','accepted','delivered','failed','uncertain'].includes(f.delivery)
    ||[f.hasVisit,f.pricingAgreed,f.billingVisible].some(v=>typeof v!=='boolean')
    ||[f.remainingVisits,f.unfinishedTasks,f.missingMaterials,f.pendingChanges].some(v=>!Number.isSafeInteger(v)||v<0)
    ||[f.estimateId,f.depositInvoiceId].some(id=>id!=null&&!uuid(id))
    ||f.invoice!==null&&(!f.invoice||!uuid(f.invoice.id)||!['draft','sent','viewed','partial','paid','overdue','void'].includes(f.invoice.status)||!Number.isFinite(f.invoice.balanceDue)))return undefined
  return f
}
