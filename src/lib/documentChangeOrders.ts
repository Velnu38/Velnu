export type DocumentChangeOrderContext = {
  documentType: 'invoice' | 'estimate'
  documentId: string
  documentNumber: string
  customerId: string
  jobId?: string | null
  estimateId?: string | null
}

export function offersDocumentChangeOrders(kind: 'invoice' | 'estimate', status: string, workStatus?: string) {
  if(workStatus&&['completed','canceled'].includes(workStatus))return false
  return kind === 'invoice'
    ? ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue'].includes(status)
    : ['draft', 'sent', 'accepted', 'converted'].includes(status)
}

export function matchesChangeOrderContext(row: { customer_id: string; job_id?: string | null }, context?: DocumentChangeOrderContext) {
  return !context || (row.customer_id === context.customerId && (!context.jobId || row.job_id === context.jobId))
}

export function changeOrderStatusLabel(status: string, pendingSend = false) {
  switch (status) {
    case 'draft': return pendingSend ? 'Confirm sent' : 'Draft'
    case 'sent': return 'Awaiting customer approval'
    case 'approved': return 'Approved'
    case 'declined': return 'Declined'
    case 'void': return 'Void'
    default: return status
  }
}

export function isLinkedChangeOrder(row: {
  customer_id: string
  job_id?: string | null
  source_invoice_id?: string | null
  estimate_id?: string | null
}, context: DocumentChangeOrderContext) {
  if (row.customer_id !== context.customerId) return false
  if (row.source_invoice_id) return context.documentType === 'invoice' && row.source_invoice_id === context.documentId
  if (row.estimate_id) return context.documentType === 'estimate' && row.estimate_id === context.documentId
  return !!context.jobId && row.job_id === context.jobId
}
