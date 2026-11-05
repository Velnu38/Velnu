import {test} from 'node:test'
import assert from 'node:assert/strict'
import {documentEndDate,previewAmounts} from '../../src/lib/documentPreview'
import {validateDocumentInput} from '../../src/lib/financialValidation'
test('estimates default to 30 calendar days across month, year and leap-day boundaries',()=>{
 for(const [issued,expected] of [['2026-11-05','2026-12-05'],['2026-12-15','2027-01-14'],['2028-02-01','2028-03-02'],['2026-03-01','2026-03-31']])assert.equal(documentEndDate(issued,'estimate'),expected)
})
test('invoice defaults to issued date; explicit valid estimate expiry stays valid',()=>{
 assert.equal(documentEndDate('2026-11-05','invoice'),'2026-11-05')
 assert.doesNotThrow(()=>validateDocumentInput({customer_id:'c',issue_date:'2026-11-05',expires_on:'2026-11-12',items:[{description:'Work',quantity:1,unit_price:20}]}))
 assert.throws(()=>validateDocumentInput({customer_id:'c',issue_date:'2026-11-05',expires_on:'2026-11-04',items:[{description:'Work',quantity:1,unit_price:20}]}),/precede/)
})
test('preview follows per-line rounding and per-line tax rather than taxing the subtotal',()=>{
 const items=[{quantity:1,unit_price:0.05,tax_rate:10},{quantity:1,unit_price:0.05,tax_rate:10}]
 assert.deepEqual(previewAmounts(items),{subtotal:0.1,tax:0.02,total:0.12})
 assert.deepEqual(previewAmounts([{quantity:1.5,unit_price:10.01,tax_rate:7.25}]),{subtotal:15.02,tax:1.09,total:16.11})
})
test('zero tax, multiple work lines and large valid totals retain exact values',()=>{
 assert.deepEqual(previewAmounts([{quantity:1,unit_price:150},{quantity:1,unit_price:100},{quantity:1,unit_price:250}]),{subtotal:500,tax:0,total:500})
 assert.deepEqual(previewAmounts([{quantity:100000,unit_price:10000000}]),{subtotal:1000000000000,tax:0,total:1000000000000})
})
