import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchingCustomers, uniqueCustomerName } from '../../src/lib/customerSuggestions'
const customers = [
  {id:'one',first_name:'Mike',last_name:'Brown',company:null,email:'mike@one.test',phone:'(757) 555-1234'},
  {id:'two',first_name:'Mike',last_name:'Brown',company:'Brown Electric',email:'office@two.test',phone:null},
  {id:'three',first_name:'José',last_name:'Smith',company:null,email:null,phone:null},
]
test('duplicate full names require an explicit choice', () => {
  assert.equal(uniqueCustomerName(customers,'Mike Brown'),undefined)
  assert.equal(matchingCustomers(customers,'Mike Bro').length,2)
})
test('contact details distinguish customers and formatted phone numbers match digits', () => {
  assert.equal(matchingCustomers(customers,'office@two')[0]?.id,'two')
  assert.equal(matchingCustomers(customers,'757555')[0]?.id,'one')
  assert.equal(matchingCustomers(customers,'Brown Electric')[0]?.id,'two')
})
test('accent and whitespace normalization preserve unique name matching', () => {
  assert.equal(uniqueCustomerName(customers,'  JOSE  Smith ')?.id,'three')
  assert.equal(matchingCustomers(customers,'Smith Jose')[0]?.id,'three')
  assert.equal(uniqueCustomerName(customers,''),undefined)
})
