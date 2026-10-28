export type DocumentChangeOrderContext = {
  documentType: 'invoice' | 'estimate'
  documentId: string
  documentNumber: string
  customerId: string
  jobId?: string | null
  estimateId?: string | null
}

export function offersDocumentChangeOrders(kind: 'invoice' | 'estimate', status: string) {
  return kind === 'invoice'
    ? ['sent', 'viewed', 'partial', 'paid', 'overdue'].includes(status)
    : ['sent', 'accepted', 'converted'].includes(status)
}

export function matchesChangeOrderContext(row: { customer_id: string; job_id?: string | null }, context?: DocumentChangeOrderContext) {
  return !context || (row.customer_id === context.customerId && (!context.jobId || row.job_id === context.jobId))
}
