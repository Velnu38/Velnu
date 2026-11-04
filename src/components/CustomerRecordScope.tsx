import { customerDisplayName, customerRecordsHref, type CustomerName, type CustomerRecordView } from '../lib/customerRecords'

export default function CustomerRecordScope({ customerId, customers, view }: { customerId: string; customers: CustomerName[]; view: CustomerRecordView }) {
  if (!customerId) return null
  const title = view === 'work' ? 'jobs' : view
  return <div className="customer-record-scope" aria-label="Customer filter">
    <div><strong>{customerDisplayName(customers.find(c => c.id === customerId))}</strong><span>Showing this customer’s {title} only</span></div>
    <a className="secondary-button compact" href={'/?view=customers&document=' + encodeURIComponent(customerId)}>Back to customer</a>
    <a className="text-button" href={customerRecordsHref(view)}>View all {title}</a>
  </div>
}
