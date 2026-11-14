import type { CanonicalDocumentSnapshot } from '../../shared/documentPdf.ts'

export function documentPdfFixture(kind: CanonicalDocumentSnapshot['kind'] = 'invoice'): CanonicalDocumentSnapshot {
  return {
    schema_version: 1, document_id: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222', revision_number: 2,
    revision_created_at: '2026-11-08T12:00:00.000Z', kind,
    number: kind === 'invoice' ? 'INV-1042' : kind === 'estimate' ? 'EST-1042' : 'CO-1042',
    status: 'sent', issue_date: '2026-11-08', due_date: '2026-11-22', expires_on: '2026-12-08', currency: 'USD',
    company: { name: 'Harbor & Field Services', legal_name: 'Harbor & Field Services LLC', email: 'office@example.test', phone: '(757) 555-0142', website: 'https://example.test', address_line1: '104 Harbor Avenue', address_line2: 'Suite 200', city: 'Chesapeake', state: 'VA', postal_code: '23322', document_accent: '#15998f', document_footer: 'Thank you for trusting our team. Workmanship is covered for one year.' },
    customer: { name: 'José Álvarez', first_name: 'José', last_name: 'Álvarez', company: 'Álvarez Family Properties', email: 'customer@example.test', phone: '(757) 555-0158', address_line1: '23 Meadow Lane', city: 'Chesapeake', state: 'VA', postal_code: '23322' },
    service_address: '84 Waterside Drive\nChesapeake, VA 23322\nRear entrance; please keep the driveway clear.',
    items: [
      { id: 'item-1', sort_order: 1, description: 'Replace kitchen faucet and supply lines', quantity: 1, unit_price: 225, line_total: 225, tax_rate: 8 },
      { id: 'item-2', sort_order: 2, description: 'On-site installation and pressure testing\nIncludes cleanup and a walkthrough of the completed work.', quantity: 2, unit_price: 75, line_total: 150, tax_rate: 8 },
    ],
    subtotal: 375, tax_amount: 30, total: 305, deposit_credit: 100, amount_paid: 50, balance_due: 255,
    customer_message: kind === 'estimate' ? 'This estimate includes the work described above. Please approve before we schedule. Materials are subject to availability.' : 'Please reference the document number with your payment. Contact us with any questions about this work.',
    payment_instructions: 'Payment is due within 14 days. Checks may be made payable to Harbor & Field Services LLC.',
    payment_links: [{ provider: 'Stripe', url: 'https://payments.example.test/invoice/INV-1042' }],
    finviant_branding: true,
    ...(kind === 'change_order' ? {
      title: 'Replace corroded shutoff valves', description: 'Replace the existing shutoff valves exposed during the faucet installation. Includes approved materials and testing.',
      reason: 'Existing valves cannot be reused safely because of corrosion.', schedule_impact_days: 1, schedule_note: 'The additional work moves completion to the next business day.',
      change_totals: { current_total: 405, change_amount: 125, revised_total: 530, deposit_paid: 100, other_paid: 50 },
    } : {}),
  }
}
