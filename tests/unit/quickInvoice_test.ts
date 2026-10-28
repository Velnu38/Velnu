import { parseQuickInvoice } from '../../src/lib/quickInvoice.ts'

for (const token of ['$1.999', '$1,2', '$12,34.56', '$100.2.3', '$1e3', '$100abc', '$-100', '-$100 dollars', '−$100 dollars', '-100 dollars', '($100)', '$100 and discount -$20', 'refund $100', 'credit $100', 'negative 100 dollars']) {
  Deno.test('invoice amount requires review: ' + token, () => {
    const result = parseQuickInvoice('Create invoice for Alex for work ' + token)
    if (result.amount !== '') throw new Error('Unsafe amount inferred: ' + JSON.stringify(result))
  })
}
for (const [token, amount] of [['$150', '150'], ['$1,234.56', '1234.56'], ['$100 dollars', '100'], ['100.25 dollars', '100.25'], ['$0.01', '0.01'], ['$100.', '100']]) {
  Deno.test('valid invoice amount stays exact: ' + token, () => {
    const result = parseQuickInvoice('Create invoice for Alex for work ' + token)
    if (result.amount !== amount || result.multipleAmounts) throw new Error(JSON.stringify(result))
  })
}
Deno.test('a negative mention cannot disappear beside a positive line', () => {
  const result = parseQuickInvoice('Create invoice for Alex for $100 labor and -$20 adjustment')
  if (result.amount !== '' || !result.multipleAmounts) throw new Error(JSON.stringify(result))
})
