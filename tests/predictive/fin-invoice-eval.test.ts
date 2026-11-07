import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finInvoiceDraft, resolveFinInvoiceSeed } from '../../src/lib/voiceDocument'
import { uniqueCustomerName } from '../../src/lib/customerSuggestions'

const customers = [
  { id: 'mike', first_name: 'Mike', last_name: 'Brewer', company: null },
  { id: 'north', first_name: 'Alex', last_name: 'Smith', company: 'North Electric' },
  { id: 'south', first_name: 'Alex', last_name: 'Smith', company: 'South Electric' },
  { id: 'jose', first_name: 'José', last_name: 'Díaz', company: null },
]
const createPhrases = ['Create an invoice', 'Make a new invoice', 'Prepare an invoice', 'Start a new invoice', 'Open a new invoice', 'Open invoices and create a new invoice', 'Go to the invoices page, then create an invoice', 'Hey Fin, could you please create an invoice', 'I want a new invoice', 'Pull up invoices and create an invoice']
for (const phrase of createPhrases) {
  for (const [name, id] of [['Mike Brewer', 'mike'], ['Alex Smith', null], ['Jose Diaz', 'jose']]) {
    const request = phrase + ' for ' + name
    test(request, () => {
      const draft = finInvoiceDraft(request)
      assert.ok(draft, 'opens the invoice composer')
      const seed = resolveFinInvoiceSeed(draft, customers)
      assert.equal(seed.customerName, name)
      assert.equal(uniqueCustomerName(customers, seed.customerName)?.id ?? null, id)
      assert.ok(seed.lines.every(line => line.amount === ''))
    })
  }
}

const workflowRequests = [
  'Open Mike Brewer’s last invoice',
  'Open invoice INV-120',
  'Show unpaid invoices for Mike Brewer',
  'Create an invoice from approved estimate EST-7',
  'Create an invoice using Mike Brewer’s last estimate',
  'Create an invoice from the landscaping job',
  'Create an invoice and schedule a job',
  'Create an invoice for Mike Brewer and mark it paid',
  'Create an invoice for Mike Brewer and send it',
  'Create an invoice for Mike Brewer, then record a payment',
]
for (const request of workflowRequests) {
  test(request, () => assert.equal(finInvoiceDraft(request), null, 'leaves this request in the reviewed workflow'))
}

const lineRequests: Array<[string, string[], string | null]> = [
  ['mowing $100 and edging $40', ['100', '40'], null],
  ['mowing one hundred dollars and edging forty dollars', ['100', '40'], null],
  ['three shrubs and delivery $40', ['', '40'], null],
  ['3 shrubs at $25 each and planting $30', ['25', '30'], null],
  ['mowing $100, no tax', ['100'], '0'],
  ['mowing $100, tax at 5 percent', ['100'], '5'],
  ['mowing $100 and total $150', ['100'], null],
  ['total $150', [''], null],
  ['labor $100 and a deposit $40', ['', ''], null],
  ['labor $100 and edging', ['100', ''], null],
]
for (const [items, prices, tax] of lineRequests) {
  test(items, () => {
    const draft = finInvoiceDraft('Create an invoice for Mike Brewer: ' + items)
    assert.ok(draft)
    const seed = resolveFinInvoiceSeed(draft, customers)
    assert.equal(seed.customerName, 'Mike Brewer')
    assert.deepEqual(seed.lines.map(line => line.amount), prices)
    assert.equal(seed.taxRate, tax)
  })
}
