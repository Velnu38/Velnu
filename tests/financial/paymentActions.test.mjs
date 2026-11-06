import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('src/components/InvoiceDetail.tsx','utf8');
test('invoice exposes a full settlement action separately from partial payments',()=>{
 assert.match(source,/>Mark Paid<\/button>/);
 assert.match(source,/>Record partial payment<\/button>/);
 assert.match(source,/setPartialPayment\(false\)/);
 assert.match(source,/readOnly=\{!partialPayment\}/);
 assert.match(source,/partialPayment&&value>=Number\(detail.invoice.balance_due\)/);
});
