import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCustomerCsv,csvCell} from '../../src/lib/customerCsv'
const id=()=>crypto.randomUUID()
test('customer CSV handles BOM, quotes, multiline fields, company, duplicates and last-name-only contacts',()=>{
 const result=parseCustomerCsv('\uFEFFFirst name,Last name,Company,Email,Phone\r\nAlex,Morgan,"Morgan, LLC",alex@example.test,+17575550123\r\nAlex,Morgan,"Morgan, LLC",alex@example.test,+17575550123\r\n,Smith,,,\r\nPat,Lee,"Line one\nLine two",,',id)
 assert.equal(result.contacts.length,3);assert.equal(result.ignored,1);assert.equal(result.contacts[0].company,'Morgan, LLC');assert.equal(result.contacts[1].last_name,'Smith');assert.equal(result.contacts[2].company,'Line one\nLine two')
})
test('malformed rows and invalid emails fail before any import is attempted',()=>{
 for(const input of ['Name,Email\nAlex,invalid','Name,Email\n"Alex,alex@example.test','Name,Email\nAlex,a@example.test,extra','Name,Name\nAlex,Other'])assert.throws(()=>parseCustomerCsv(input,id))
 assert.throws(()=>parseCustomerCsv('Name\n'+Array.from({length:2001},()=> 'Alex').join('\n'),id),/2,000/)
})
test('CSV export neutralizes formulas, quotes fields and preserves ordinary names',()=>{
 for(const value of ['=HYPERLINK("evil")','+17575550123','-1','@SUM(1)','  =SUM(1)'])assert.ok(csvCell(value).startsWith('"\''))
 assert.equal(csvCell('Morgan, "LLC"'),'"Morgan, ""LLC"""');assert.equal(csvCell('Alex Morgan'),'"Alex Morgan"')
})

test('Finviant customer exports round-trip protected international phone numbers',()=>{
 const csv=['First name,Last name,Company,Email,Phone',['Alex','Morgan','','alex@example.test','+17575550123'].map(csvCell).join(',')].join('\n')
 assert.equal(parseCustomerCsv(csv,id).contacts[0].phone,'+17575550123')
})
