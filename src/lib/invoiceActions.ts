export type InvoiceStatusSource = { status: string; balance_due: number; amount_paid?: number; due_date: string | null;job_id?:string|null;estimate_id?:string|null;journey_terms_review_required?:boolean }
export function invoiceIsOverdue(invoice: InvoiceStatusSource, today: string) {
  return ['sent','viewed','partial','overdue'].includes(invoice.status) && Number(invoice.balance_due) > 0 &&
    (invoice.status === 'overdue' || !!invoice.due_date && invoice.due_date < today)
}
/** Display deadlines consistently without turning zero-value drafts into paid invoices. */
export function invoiceDisplayStatus(invoice: InvoiceStatusSource, today: string) {
  if (invoice.status === 'draft') return 'Draft'
  if (invoice.status === 'void') return 'Void'
  if (invoice.status === 'paid' || Number(invoice.balance_due) <= 0) return 'Paid'
  if (invoiceIsOverdue(invoice, today)) return 'Overdue'
  if (invoice.status === 'partial') return 'Partly paid'
  if (invoice.status === 'viewed') return 'Viewed'
  if (invoice.status === 'sent') return 'Sent'
  return invoice.status.replaceAll('_', ' ')
}
export type InvoiceActionPolicy = {
  primary: 'send' | 'mark_paid' | 'reminder' | 'edit' | null
  secondary: 'edit' | 'mark_paid' | null
  canRecordPayment: boolean
  canRemind: boolean
  canVoid: boolean
  canSendCopy: boolean
}
export function invoiceActionPolicy(invoice: InvoiceStatusSource, input: {
  today: string; canManage: boolean; paymentState: 'clear' | 'pending' | 'review_required' | 'unavailable'; recovery: boolean
}): InvoiceActionPolicy {
  const canRecordPayment = input.canManage && ['sent','viewed','partial','overdue'].includes(invoice.status) &&
    Number(invoice.balance_due) > 0 && input.paymentState === 'clear'
  const canRemind = input.canManage && invoiceIsOverdue(invoice, input.today) && input.paymentState === 'clear'
  const needsDueDate=invoice.status==='draft'&&invoice.journey_terms_review_required===true&&!!invoice.job_id&&!!invoice.estimate_id&&!invoice.due_date
  const primary = !input.canManage || input.recovery ? null : invoice.status === 'draft' ? needsDueDate?'edit':'send' :
    canRemind ? 'reminder' : canRecordPayment ? 'mark_paid' : null
  return {
    primary,
    secondary: input.canManage && !input.recovery && invoice.status === 'draft' && primary!=='edit' ? 'edit' : primary === 'reminder' && canRecordPayment ? 'mark_paid' : null,
    canRecordPayment, canRemind,
    canVoid: input.canManage && ['draft','sent','viewed','partial','overdue'].includes(invoice.status) && Number(invoice.amount_paid || 0) === 0 && input.paymentState === 'clear',
    canSendCopy: input.canManage && ['sent','viewed','partial','paid','overdue'].includes(invoice.status),
  }
}
