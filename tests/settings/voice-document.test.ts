import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseVoiceDocument,isVoiceDocumentCommand,finInvoiceDraft,resolveFinInvoiceSeed} from '../../src/lib/voiceDocument'
import {previewDocumentTotal} from '../../src/lib/financialValidation'
const sum=(s:ReturnType<typeof parseVoiceDocument>)=>previewDocumentTotal(s.lines.map(l=>({quantity:Number(l.quantity),unit_price:l.amount===''?NaN:Number(l.amount),tax_rate:Number(s.taxRate||0)})))
test('voice invoices and estimates retain each separate service charge and never add the spoken total as a line',()=>{
 for(const kind of ['invoice','estimate']){const s=parseVoiceDocument(`Create an ${kind} for Bob Smith for mowing $100 and edging $40, total $140`);assert.equal(s.kind,kind);assert.equal(s.customerName,'Bob Smith');assert.deepEqual(s.lines.map(l=>[l.description,l.amount,l.quantity]),[['mowing','100','1'],['edging','40','1']]);assert.equal(s.statedTotal,'140');assert.equal(sum(s),140)}
 const colon=parseVoiceDocument('Create an estimate for Bob Smith: mowing $100 and edging $40, total $140');assert.equal(colon.customerName,'Bob Smith');assert.equal(sum(colon),140)
 assert.equal(parseVoiceDocument('Create invoice for One Dollar Services for mowing $100').customerName,'One Dollar Services')
 const s=parseVoiceDocument('Make an invoice for Bob Smith for $300 labor and $200 materials');assert.deepEqual(s.lines.map(l=>[l.description,l.amount]),[['labor','300'],['materials','200']]);assert.equal(sum(s),500)
})
test('spoken number words, cents, explicit quantities and tax percentages are calculated deterministically',()=>{
 const words=parseVoiceDocument('Create estimate for Bob Smith for mowing one hundred dollars and cleanup fifty dollars, total one hundred fifty dollars');assert.equal(sum(words),150);assert.equal(words.statedTotal,'150')
 const cents=parseVoiceDocument('Create invoice for Bob Smith for mowing one hundred dollars and fifty cents');assert.equal(cents.lines[0].amount,'100.50')
 const units=parseVoiceDocument('Create estimate for Bob Smith for 3 shrubs at $25 each and planting $30, no tax');assert.equal(units.lines[0].quantity,'3');assert.equal(units.lines[0].description,'shrubs');assert.equal(sum(units),105)
 const tax=parseVoiceDocument('Create invoice for Bob Smith for mowing $100 and 5 percent tax');assert.equal(tax.taxRate,'5');assert.equal(sum(tax),105)
})
test('unsafe or ambiguous amounts stay unpriced; totals are checks, not guessed charges',()=>{
 for(const token of ['$1.999','$1,2','$100abc','$-100','-$100 dollars','refund $100','paid $100','deposit $100']){const s=parseVoiceDocument('Create invoice for Bob Smith for labor '+token);assert.ok(s.lines.every(l=>l.amount===''),JSON.stringify(s))}
 assert.equal(parseVoiceDocument('Create invoice for Bob Smith for labor $100 and 200 percent tax').taxRate,'')
 assert.equal(parseVoiceDocument('Create invoice for Bob Smith for labor $100 total $0').statedTotal,'0')
 const mismatch=parseVoiceDocument('Create estimate for Bob Smith for labor $100 and materials $50 total $175');assert.equal(sum(mismatch),150);assert.equal(mismatch.statedTotal,'175');assert.equal(mismatch.lines.length,2)
 const tooMany=parseVoiceDocument('Create invoice for Bob Smith for '+Array.from({length:51},(_,i)=>`service ${i+1} $10`).join(' and '));assert.equal(tooMany.lines.length,51);assert.equal(sum(tooMany),null)
 assert.equal(isVoiceDocumentCommand('Convert estimate to invoice'),false);assert.equal(isVoiceDocumentCommand('Create estimate for Bob for mowing $50'),true)
})
test('missing customers never consume currency; the reported failure totals all charges',()=>{
 for(const kind of ['invoice','estimate'])for(const money of ['$200','200 dollars','two hundred dollars']){
  const s=parseVoiceDocument(`Create ${kind} for ${money} for landscaping, $100 for painting`)
  assert.equal(s.customerName,'');assert.deepEqual(s.lines.map(l=>[l.description,l.amount]),[['landscaping','200'],['painting','100']]);assert.equal(s.statedTotal,null);assert.equal(sum(s),300)
 }
 const service=parseVoiceDocument('Create invoice for landscaping $200 and painting $100');assert.equal(service.customerName,'');assert.equal(sum(service),300)
 const equal=parseVoiceDocument('Create invoice for $100 landscaping and $100 painting');assert.equal(equal.customerName,'');assert.equal(sum(equal),200)
})

test('Fin opens ordinary invoice creation requests and keeps existing-record workflows separate', () => {
 const draft = finInvoiceDraft('Open invoice and create a new invoice for Mike Brewer.')
 assert.equal(draft?.seed.customerName, 'Mike Brewer')
 assert.deepEqual(draft?.seed.lines, [{description:'',amount:'',quantity:'1'}])
 assert.equal(finInvoiceDraft('Can you please create an invoice?')?.seed.kind, 'invoice')
 assert.equal(finInvoiceDraft('Open a new invoice for Mike Brewer')?.seed.customerName, 'Mike Brewer')
 for (const request of ['Open invoice INV-1','Show me the invoice for Mike Brewer','Create an invoice from an approved estimate','Create an invoice for Mike and schedule it for tomorrow','Create an estimate for Mike']) {
  assert.equal(finInvoiceDraft(request), null, request)
 }
})

test('a saved name separates dictated charges even when speech has no punctuation', () => {
 const draft = finInvoiceDraft('Create an invoice for Mike Brewer mowing $100 and trimming $40')!
 const seed = resolveFinInvoiceSeed(draft, [{id:'mike', first_name:'Mike', last_name:'Brewer', company:null}])
 assert.equal(seed.customerName, 'Mike Brewer')
 assert.deepEqual(seed.lines.map(line => [line.description,line.amount]), [['mowing','100'],['trimming','40']])
 assert.equal(resolveFinInvoiceSeed(draft, []).customerName, '')
})
