import assert from 'node:assert/strict'
import test from 'node:test'
import {PDFDocument} from 'pdf-lib'
import {customerStatementPdf,type CustomerStatement} from '../../shared/customerStatementPdf.ts'
const base:CustomerStatement={as_of:'2026-11-09',company:{name:'Finviant Services'},customer:{id:'fixture',name:'José Example',email:'customer@example.test'},outstanding:100,invoice_count:0,limited:false,invoices:[]}
test('statement PDF supports empty and multipage accounts with large currency values',async()=>{for(const count of [0,40]){const doc={...base,invoice_count:count,invoices:Array.from({length:count},(_,n)=>({id:String(n),invoice_number:'INV-'+n,issue_date:'2026-11-01',due_date:'2026-11-30',total:100000000,amount_paid:50,balance_due:99999950,deposit_credit:0,status:'sent'}))};const bytes=await customerStatementPdf(doc),pdf=await PDFDocument.load(bytes);assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');assert.ok(pdf.getPageCount()>=(count?2:1));assert.equal(pdf.getAuthor(),'Finviant Services')}})
