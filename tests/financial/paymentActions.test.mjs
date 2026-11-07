import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const invoice=readFileSync('src/components/InvoiceDetail.tsx','utf8');
const entry=readFileSync('src/components/FinancialEntryDialog.tsx','utf8');
const dialog=readFileSync('src/components/RecordPaymentDialog.tsx','utf8');
test('invoice and financial entry share one payment form with full and partial settlement',()=>{
 assert.match(invoice,/>Mark Paid<\/button>/);
 assert.match(invoice,/<RecordPaymentDialog/);
 assert.match(entry,/<RecordPaymentDialog/);
 assert.match(dialog,/String\(invoice\.balance_due\)/);
 assert.match(dialog,/'Record partial payment'/);
 assert.match(dialog,/value > Number\(selected\.balance_due\)/);
});
